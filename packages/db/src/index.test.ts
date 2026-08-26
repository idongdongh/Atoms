import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ControlPlaneStore } from "./index.js";

describe("ControlPlaneStore", () => {
  it("persists a project, default chat, and initial version", () => {
    const store = new ControlPlaneStore(":memory:");
    const userId = store.ensureDevelopmentUser();
    const project = store.createProject({
      id: randomUUID(),
      userId,
      name: "Task board",
      slug: "task-board-test",
      templateId: "react-vite",
      defaultBranch: "main",
      currentCommit: "a".repeat(40),
      chatId: randomUUID(),
      createdAt: "2026-08-26T02:00:00.000Z",
    });

    expect(store.getProject(project.id)).toEqual(project);
    expect(store.listProjects(userId)).toHaveLength(1);
    expect(store.listVersions(project.id)).toMatchObject([
      { commitHash: "a".repeat(40), message: "Initialize project" },
    ]);
    store.close();
  });

  it("replays events strictly after a sequence", () => {
    const store = new ControlPlaneStore(":memory:");
    const runId = randomUUID();
    store.appendAgentEvent({ type: "run.started", runId });
    store.appendAgentEvent({
      type: "message.delta",
      runId,
      delta: "Building",
    });

    const events = store.listAgentEvents(runId);
    expect(events.map((event) => event.sequence)).toEqual([0, 1]);
    expect(store.listAgentEvents(runId, 0)).toMatchObject([
      { type: "message.delta", sequence: 1 },
    ]);
    store.close();
  });

  it("creates an idempotent run and transitions it through the queue", () => {
    const store = new ControlPlaneStore(":memory:");
    const userId = store.ensureDevelopmentUser();
    const project = store.createProject({
      id: randomUUID(),
      userId,
      name: "Agent project",
      slug: "agent-project-test",
      templateId: "react-vite",
      defaultBranch: "main",
      currentCommit: "b".repeat(40),
      chatId: randomUUID(),
      createdAt: "2026-08-26T02:00:00.000Z",
    });
    const runId = randomUUID();
    const queued = store.createRun({
      id: runId,
      projectId: project.id,
      chatId: project.chatId,
      prompt: "Create a landing page",
      idempotencyKey: "request-1",
    });
    expect(queued.status).toBe("queued");
    expect(
      store.createRun({
        id: randomUUID(),
        projectId: project.id,
        chatId: project.chatId,
        prompt: "Create a landing page",
        idempotencyKey: "request-1",
      }).id,
    ).toBe(runId);
    expect(store.claimNextRun()?.status).toBe("preparing");
    expect(store.transitionRun(runId, "running").status).toBe("running");
    expect(
      store.transitionRun(runId, "failed", {
        errorCode: "model_unavailable",
        errorMessage: "Model provider is not configured",
      }).errorCode,
    ).toBe("model_unavailable");
    store.close();
  });

  it("marks interrupted worker runs as explicit failures", () => {
    const store = new ControlPlaneStore(":memory:");
    const userId = store.ensureDevelopmentUser();
    const project = store.createProject({
      id: randomUUID(),
      userId,
      name: "Recovery project",
      slug: "recovery-project-test",
      templateId: "react-vite",
      defaultBranch: "main",
      currentCommit: "c".repeat(40),
      chatId: randomUUID(),
      createdAt: "2026-08-26T02:00:00.000Z",
    });
    const run = store.createRun({
      id: randomUUID(),
      projectId: project.id,
      chatId: project.chatId,
      prompt: "Recover this run",
      idempotencyKey: "recovery-1",
    });
    store.claimNextRun();
    store.transitionRun(run.id, "running");
    const recovered = store.recoverInterruptedRuns();
    expect(recovered).toMatchObject([
      { id: run.id, status: "failed", errorCode: "worker_interrupted" },
    ]);
    store.close();
  });

  it("tracks preview access, wake requests, and idle reconcile candidates", () => {
    const store = new ControlPlaneStore(":memory:");
    const userId = store.ensureDevelopmentUser();
    const project = store.createProject({
      id: randomUUID(),
      userId,
      name: "Preview project",
      slug: "preview-project-test",
      templateId: "react-vite",
      defaultBranch: "main",
      currentCommit: "d".repeat(40),
      chatId: randomUUID(),
      createdAt: "2026-08-26T02:00:00.000Z",
    });
    store.setProjectPreview({
      projectId: project.id,
      status: "running",
      url: "http://127.0.0.1:4100/",
      port: 4100,
    });
    store.touchProjectPreview(project.id);

    // Recently accessed previews are not idle; previews untouched since the
    // cutoff are returned for the worker to stop.
    const minuteAgo = new Date(Date.now() - 60_000).toISOString();
    expect(store.listProjectPreviewsForReconcile(minuteAgo)).toHaveLength(0);
    const secondAhead = new Date(Date.now() + 1_000).toISOString();
    expect(store.listProjectPreviewsForReconcile(secondAhead)).toMatchObject([
      { project_id: project.id, status: "running" },
    ]);

    // Wake requests flag any existing row and are cleared on the next start.
    expect(store.requestProjectPreviewWake(project.id)).toBe(true);
    expect(store.requestProjectPreviewWake(randomUUID())).toBe(false);
    store.setProjectPreview({ projectId: project.id, status: "running" });
    expect(store.listProjectPreviewsForReconcile(secondAhead)).toMatchObject([
      { project_id: project.id, wake_requested_at: null },
    ]);
    store.close();
  });

  it("reports active runs so the idle reaper can skip busy projects", () => {
    const store = new ControlPlaneStore(":memory:");
    const userId = store.ensureDevelopmentUser();
    const project = store.createProject({
      id: randomUUID(),
      userId,
      name: "Busy project",
      slug: "busy-project-test",
      templateId: "react-vite",
      defaultBranch: "main",
      currentCommit: "e".repeat(40),
      chatId: randomUUID(),
      createdAt: "2026-08-26T02:00:00.000Z",
    });
    expect(store.hasActiveRun(project.id)).toBe(false);
    const run = store.createRun({
      id: randomUUID(),
      projectId: project.id,
      chatId: project.chatId,
      prompt: "Keep the worker busy",
      idempotencyKey: "busy-1",
    });
    expect(store.hasActiveRun(project.id)).toBe(true);
    store.claimNextRun();
    store.transitionRun(run.id, "failed");
    expect(store.hasActiveRun(project.id)).toBe(false);
    store.close();
  });

  it("deletes a project with all dependent rows", () => {
    const store = new ControlPlaneStore(":memory:");
    const userId = store.ensureDevelopmentUser();
    const projectId = randomUUID();
    const chatId = randomUUID();
    const runId = randomUUID();
    store.createProject({
      id: projectId,
      userId,
      name: "Doomed",
      slug: "doomed-test",
      templateId: "react-vite",
      defaultBranch: "main",
      currentCommit: "a".repeat(40),
      chatId,
      createdAt: new Date().toISOString(),
    });
    store.createRun({
      id: runId,
      projectId,
      chatId,
      prompt: "doomed run",
      idempotencyKey: "delete-test-1",
    });
    store.appendAgentEvent({
      runId,
      type: "run.started",
    });
    store.setProjectPreview({ projectId, status: "running", port: 4200 });
    const releaseId = randomUUID();
    store.createRelease({
      id: releaseId,
      projectId,
      commitHash: "b".repeat(40),
    });
    store.setPublication({ projectId, releaseId });

    store.deleteProject(projectId);

    expect(() => store.getProject(projectId)).toThrow("Project not found");
    expect(store.listProjects(userId).some((p) => p.id === projectId)).toBe(
      false,
    );
    expect(store.listVersions(projectId)).toHaveLength(0);
    expect(store.listAgentEvents(runId)).toHaveLength(0);
    expect(store.getProjectPreview(projectId)).toBeNull();
    store.close();
  });
});
