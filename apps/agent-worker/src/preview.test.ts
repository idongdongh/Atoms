import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ControlPlaneStore } from "@atoms/db";
import type { PreviewProcess, PreviewProvider } from "@atoms/sandbox-sdk";
import { reconcileProjectPreviews, startProjectPreview } from "./preview.js";

class FakePreviewProvider implements PreviewProvider {
  readonly starts: string[] = [];
  readonly stops: string[] = [];
  #failuresRemaining: number;

  constructor(failStarts = 0) {
    this.#failuresRemaining = failStarts;
  }

  async start(input: {
    projectId: string;
    workspaceRoot: string;
  }): Promise<PreviewProcess> {
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

    expect(provider.starts).toEqual([projectId]);
    expect(store.getProjectPreview(projectId)).toMatchObject({
      status: "running",
      port: 4200,
    });
    expect(
      store.listProjectPreviewsForReconcile(new Date().toISOString()),
    ).toEqual([]);
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

    expect(provider.starts).toEqual([projectId]);
    expect(store.getProjectPreview(projectId)?.status).toBe("running");
    store.close();
  });
});
