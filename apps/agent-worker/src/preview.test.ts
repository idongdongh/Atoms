import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ControlPlaneStore } from "@atoms/db";
import type { PreviewProcess, PreviewProvider } from "@atoms/sandbox-sdk";
import {
  isProjectPreviewStarting,
  reconcileProjectPreviews,
  startProjectPreview,
} from "./preview.js";

class FakePreviewProvider implements PreviewProvider {
  readonly starts: string[] = [];
  readonly stops: string[] = [];
  #failuresRemaining: number;
  #gate: (() => Promise<void>) | null;

  constructor(failStarts = 0, gate: (() => Promise<void>) | null = null) {
    this.#failuresRemaining = failStarts;
    this.#gate = gate;
  }

  async start(input: {
    projectId: string;
    workspaceRoot: string;
  }): Promise<PreviewProcess> {
    if (this.#gate) await this.#gate();
    this.starts.push(input.projectId);
    if (this.#failuresRemaining-- > 0) {
      throw new Error("dev server crashed");
    }
    return {
      sandboxId: `fake-${input.projectId}`,
      projectId: input.projectId,
      workspaceRoot: input.workspaceRoot,
      status: "running",
      url: "http://127.0.0.1:4200/",
      port: 4200,
    };
  }

  async stop(projectId: string): Promise<void> {
    this.stops.push(projectId);
  }
}

function seedProject(store: ControlPlaneStore): string {
  const userId = store.ensureDevelopmentUser();
  const projectId = randomUUID();
  store.createProject({
    id: projectId,
    userId,
    name: "Preview test",
    slug: `preview-test-${projectId.slice(0, 8)}`,
    templateId: "react-vite",
    defaultBranch: "main",
    currentCommit: "a".repeat(40),
    chatId: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  return projectId;
}

describe("startProjectPreview", () => {
  it("retries a failed start once before succeeding", async () => {
    const store = new ControlPlaneStore(":memory:");
    const projectId = seedProject(store);
    const provider = new FakePreviewProvider(1);
    const events: string[] = [];

    await startProjectPreview({
      store,
      previewProvider: provider,
      projectId,
      workspaceRoot: `/tmp/workspaces/${projectId}`,
      emit: (event) => events.push(event.type),
    });

    expect(provider.starts).toHaveLength(2);
    expect(store.getProjectPreview(projectId)).toMatchObject({
      status: "running",
      port: 4200,
    });
    expect(events).toEqual(["preview.starting", "preview.ready"]);
    store.close();
  });

  it("serializes concurrent starts for the same project", async () => {
    const store = new ControlPlaneStore(":memory:");
    const projectId = seedProject(store);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = new FakePreviewProvider(0, () => gate);
    const events: string[] = [];
    const track = (event: { type: string }) => events.push(event.type);

    const first = startProjectPreview({
      store,
      previewProvider: provider,
      projectId,
      workspaceRoot: `/tmp/workspaces/${projectId}`,
      emit: track,
    });
    const second = startProjectPreview({
      store,
      previewProvider: provider,
      projectId,
      workspaceRoot: `/tmp/workspaces/${projectId}`,
      emit: track,
    });

    expect(isProjectPreviewStarting(projectId)).toBe(true);
    release();
    await Promise.all([first, second]);

    // The second start may only begin once the first fully finished; with
    // interleaving the order would be starting/starting/ready/ready.
    expect(events).toEqual([
      "preview.starting",
      "preview.ready",
      "preview.starting",
      "preview.ready",
    ]);
    expect(provider.starts).toEqual([projectId, projectId]);
    expect(store.getProjectPreview(projectId)).toMatchObject({
      status: "running",
      port: 4200,
    });
    expect(isProjectPreviewStarting(projectId)).toBe(false);
    store.close();
  });

  it("marks the preview failed after two failed attempts", async () => {
    const store = new ControlPlaneStore(":memory:");
    const projectId = seedProject(store);
    const provider = new FakePreviewProvider(2);
    const events: string[] = [];

    await startProjectPreview({
      store,
      previewProvider: provider,
      projectId,
      workspaceRoot: `/tmp/workspaces/${projectId}`,
      emit: (event) => events.push(event.type),
    });

    expect(provider.starts).toHaveLength(2);
    expect(store.getProjectPreview(projectId)).toMatchObject({
      status: "failed",
      errorMessage: "dev server crashed",
    });
    expect(events).toEqual(["preview.starting", "preview.failed"]);
    store.close();
  });
});

describe("reconcileProjectPreviews", () => {
  it("stops previews that were not accessed within the idle window", async () => {
    const store = new ControlPlaneStore(":memory:");
    const projectId = seedProject(store);
    store.setProjectPreview({
      projectId,
      status: "running",
      url: "http://127.0.0.1:4200/",
      port: 4200,
    });
    const provider = new FakePreviewProvider();

    // A negative window forces the just-started preview to count as idle.
    await reconcileProjectPreviews({
      store,
      previewProvider: provider,
      workspaceRoot: "/tmp/workspaces",
      idleMs: -1_000,
    });

    expect(provider.stops).toEqual([projectId]);
    expect(store.getProjectPreview(projectId)).toMatchObject({
      status: "stopped",
    });
    store.close();
  });

  it("keeps previews alive while the project has an active run", async () => {
    const store = new ControlPlaneStore(":memory:");
    const projectId = seedProject(store);
    store.setProjectPreview({ projectId, status: "running", port: 4200 });
    store.createRun({
      id: randomUUID(),
      projectId,
      chatId: store.getProject(projectId).chatId,
      prompt: "Keep the preview alive",
      idempotencyKey: "reconcile-1",
    });
    const provider = new FakePreviewProvider();

    // Forced-idle window proves the active run is what keeps the preview.
    await reconcileProjectPreviews({
      store,
      previewProvider: provider,
      workspaceRoot: "/tmp/workspaces",
      idleMs: -1_000,
    });

    expect(provider.stops).toEqual([]);
    expect(store.getProjectPreview(projectId)?.status).toBe("running");
    store.close();
  });

  it("restarts sleeping previews when the API requested a wake", async () => {
    const store = new ControlPlaneStore(":memory:");
    const projectId = seedProject(store);
    store.setProjectPreview({ projectId, status: "stopped" });
    expect(store.requestProjectPreviewWake(projectId)).toBe(true);
    const provider = new FakePreviewProvider();

    await reconcileProjectPreviews({
      store,
      previewProvider: provider,
      workspaceRoot: "/tmp/workspaces",
      idleMs: 600_000,
    });

    // The wake start is queued without blocking reconciliation, so the
    // running row only appears once the boot settles.
    await vi.waitFor(() =>
      expect(store.getProjectPreview(projectId)).toMatchObject({
        status: "running",
        port: 4200,
      }),
    );
    expect(provider.starts).toEqual([projectId]);
    // With a threshold a second in the past the freshly-woken preview is
    // neither wake-flagged nor idle, so nothing is left to reconcile.
    expect(
      store.listProjectPreviewsForReconcile(
        new Date(Date.now() - 1_000).toISOString(),
      ),
    ).toEqual([]);
    store.close();
  });

  it("wakes without blocking on slow boots and skips duplicate wake requests", async () => {
    const store = new ControlPlaneStore(":memory:");
    const projectId = seedProject(store);
    store.setProjectPreview({ projectId, status: "stopped" });
    store.requestProjectPreviewWake(projectId);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = new FakePreviewProvider(0, () => gate);

    // Reconcile returns immediately even though the boot is parked in the
    // provider; a second pass (forced-idle so every running row would be
    // reaped) must neither enqueue a duplicate start nor stop the row the
    // in-flight start just wrote.
    await reconcileProjectPreviews({
      store,
      previewProvider: provider,
      workspaceRoot: "/tmp/workspaces",
      idleMs: 600_000,
    });
    await reconcileProjectPreviews({
      store,
      previewProvider: provider,
      workspaceRoot: "/tmp/workspaces",
      idleMs: -1_000,
    });

    expect(isProjectPreviewStarting(projectId)).toBe(true);
    expect(store.getProjectPreview(projectId)).toMatchObject({
      status: "starting",
    });

    release();
    await vi.waitFor(() =>
      expect(isProjectPreviewStarting(projectId)).toBe(false),
    );
    expect(provider.starts).toEqual([projectId]);
    expect(provider.stops).toEqual([]);
    expect(store.getProjectPreview(projectId)).toMatchObject({
      status: "running",
      port: 4200,
    });
    store.close();
  });

  it("restarts stale running rows that carry a wake request", async () => {
    const store = new ControlPlaneStore(":memory:");
    const projectId = seedProject(store);
    store.setProjectPreview({ projectId, status: "running", port: 4200 });
    store.requestProjectPreviewWake(projectId);
    const provider = new FakePreviewProvider();

    await reconcileProjectPreviews({
      store,
      previewProvider: provider,
      workspaceRoot: "/tmp/workspaces",
      idleMs: 600_000,
    });

    await vi.waitFor(() =>
      expect(store.getProjectPreview(projectId)?.status).toBe("running"),
    );
    expect(provider.starts).toEqual([projectId]);
    store.close();
  });
});
