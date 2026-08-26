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
});
