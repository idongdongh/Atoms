import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const apps: ReturnType<typeof createApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "atoms-api-test-"));
  const templateRoot = path.join(root, "template");
  await mkdir(path.join(templateRoot, "src"), { recursive: true });
  await writeFile(
    path.join(templateRoot, "package.json"),
    '{"name":"fixture"}\n',
  );
  await writeFile(
    path.join(templateRoot, "src", "main.ts"),
    "export const ready = true;\n",
  );
  const app = createApp({
    databasePath: path.join(root, "control-plane.sqlite"),
    workspaceRoot: path.join(root, "workspaces"),
    templateRoot,
    logger: false,
  });
  apps.push(app);
  return { app, root };
}

describe("Control Plane API", () => {
  it("reports a healthy control plane", async () => {
    const { app } = await fixture();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: "api", status: "ok" });
  });

  it("creates a persistent project with files and an initial version", async () => {
    const { app, root } = await fixture();
    const created = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "Task board" },
    });
    expect(created.statusCode).toBe(201);
    const project = created.json().project;

    const files = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/files`,
    });
    expect(files.json().files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src/main.ts" }),
      ]),
    );

    const search = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/search?q=ready`,
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().matches).toMatchObject([
      { path: "src/main.ts", line: 1 },
    ]);

    const versions = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/versions`,
    });
    expect(versions.json().versions).toMatchObject([
      { commitHash: project.currentCommit, message: "Initialize project" },
    ]);

    await app.close();
    apps.splice(apps.indexOf(app), 1);
    const restarted = createApp({
      databasePath: path.join(root, "control-plane.sqlite"),
      workspaceRoot: path.join(root, "workspaces"),
      templateRoot: path.join(root, "template"),
      logger: false,
    });
    apps.push(restarted);
    const loaded = await restarted.inject({
      method: "GET",
      url: `/projects/${project.id}`,
    });
    expect(loaded.json().project).toMatchObject({
      id: project.id,
      name: "Task board",
    });
  });

  it("rejects unsafe file paths without returning file content", async () => {
    const { app } = await fixture();
    const created = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "Safe project" },
    });
    const projectId = created.json().project.id;
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/files/content?path=../secret`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("secret file contents");
  });

  it("creates an idempotent run and exposes its replayable lifecycle", async () => {
    const { app } = await fixture();
    const created = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "Agent workflow" },
    });
    const project = created.json().project;
    const first = await app.inject({
      method: "POST",
      url: `/chats/${project.chatId}/runs`,
      payload: {
        prompt: "Add a feedback form",
        idempotencyKey: "workflow-1",
      },
    });
    expect(first.statusCode).toBe(202);
    const run = first.json().run;
    const second = await app.inject({
      method: "POST",
      url: `/chats/${project.chatId}/runs`,
      payload: {
        prompt: "Add a feedback form",
        idempotencyKey: "workflow-1",
      },
    });
    expect(second.json().run.id).toBe(run.id);

    const cancelled = await app.inject({
      method: "POST",
      url: `/runs/${run.id}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().run.status).toBe("cancelled");
    const events = await app.inject({
      method: "GET",
      url: `/runs/${run.id}/events`,
    });
    expect(events.json().events).toMatchObject([
      { type: "run.cancelled", sequence: 0 },
    ]);
  });
});
