import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BuildProvider } from "@atoms/sandbox-sdk";
import { ControlPlaneStore } from "@atoms/db";
import { createApp } from "./app.js";

const apps: ReturnType<typeof createApp>[] = [];
const clientHeader = { "x-atoms-client": "web" };
type Session = Record<string, string>;

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function registerUser(
  app: ReturnType<typeof createApp>,
  email: string,
): Promise<Session> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { name: "Tester", email, password: "password-123" },
  });
  expect(response.statusCode).toBe(201);
  const cookie = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"].join(";")
    : (response.headers["set-cookie"] ?? "");
  const token = /atoms_session=([^;]+)/.exec(cookie)?.[1];
  if (!token) throw new Error("No session cookie returned");
  return { atoms_session: token };
}

async function fixture(buildProvider?: BuildProvider): Promise<{
  app: ReturnType<typeof createApp>;
  root: string;
  session: Session;
  email: string;
  project: { id: string; chatId: string; currentCommit: string };
}> {
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
    releasesRoot: path.join(root, "published"),
    ...(buildProvider ? { buildProvider } : {}),
    logger: false,
  });
  apps.push(app);
  const email = `tester-${randomUUID()}@atoms.test`;
  const session = await registerUser(app, email);
  const created = await app.inject({
    method: "POST",
    url: "/projects",
    cookies: session,
    headers: clientHeader,
    payload: { name: "Fixture project" },
  });
  expect(created.statusCode).toBe(201);
  return { app, root, session, email, project: created.json().project };
}

class FakeBuildProvider implements BuildProvider {
  #builds = 0;

  async build(input: {
    projectId: string;
    workspaceRoot: string;
  }): Promise<{ distPath: string }> {
    this.#builds += 1;
    const distPath = path.join(input.workspaceRoot, "dist");
    await mkdir(distPath, { recursive: true });
    await writeFile(
      path.join(distPath, "index.html"),
      `<html>build-${this.#builds}</html>`,
    );
    await mkdir(path.join(distPath, "assets"), { recursive: true });
    await writeFile(
      path.join(distPath, "assets", "app.js"),
      `console.log("build-${this.#builds}")`,
    );
    return { distPath };
  }
}

describe("Control Plane API", () => {
  it("reports a healthy control plane without authentication", async () => {
    const { app } = await fixture();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: "api", status: "ok" });
  });

  it("gates accounts behind sessions and isolates projects per user", async () => {
    const { app, session, email, project } = await fixture();

    expect(
      (await app.inject({ method: "GET", url: "/projects" })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: `/projects/${project.id}` }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/projects",
          cookies: session,
          payload: { name: "No header" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email, password: "wrong-password" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({ method: "GET", url: "/auth/me", cookies: session })
      ).json().user,
    ).toMatchObject({ email });

    const otherSession = await registerUser(
      app,
      `other-${randomUUID()}@atoms.test`,
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/projects/${project.id}`,
          cookies: otherSession,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/projects",
          cookies: otherSession,
        })
      ).json().projects,
    ).toHaveLength(0);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/projects/${project.id}`,
          cookies: session,
        })
      ).statusCode,
    ).toBe(200);

    // Published URLs are public: they must never leak the control plane.
    expect(
      (await app.inject({ method: "GET", url: `/published/${project.id}/` }))
        .statusCode,
    ).toBe(404);

    await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: session,
    });
    expect(
      (await app.inject({ method: "GET", url: "/projects", cookies: session }))
        .statusCode,
    ).toBe(401);
  });

  it("creates a persistent project with files and an initial version", async () => {
    const first = await fixture();
    const { app, root, session, project } = first;

    const files = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/files`,
      cookies: session,
    });
    expect(files.json().files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src/main.ts" }),
      ]),
    );

    const search = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/search?q=ready`,
      cookies: session,
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().matches).toMatchObject([
      { path: "src/main.ts", line: 1 },
    ]);

    const versions = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/versions`,
      cookies: session,
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
      releasesRoot: path.join(root, "published"),
      logger: false,
    });
    apps.push(restarted);
    const loaded = await restarted.inject({
      method: "GET",
      url: `/projects/${project.id}`,
      cookies: session,
    });
    expect(loaded.json().project).toMatchObject({
      id: project.id,
      name: "Fixture project",
    });
  });

  it("rejects unsafe file paths without returning file content", async () => {
    const { app, session, project } = await fixture();
    const response = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/files/content?path=../secret`,
      cookies: session,
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("secret file contents");
  });

  it("creates an idempotent run and exposes its replayable lifecycle", async () => {
    const { app, session, project } = await fixture();
    const first = await app.inject({
      method: "POST",
      url: `/chats/${project.chatId}/runs`,
      cookies: session,
      headers: clientHeader,
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
      cookies: session,
      headers: clientHeader,
      payload: {
        prompt: "Add a feedback form",
        idempotencyKey: "workflow-1",
      },
    });
    expect(second.json().run.id).toBe(run.id);

    const cancelled = await app.inject({
      method: "POST",
      url: `/runs/${run.id}/cancel`,
      cookies: session,
      headers: clientHeader,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().run.status).toBe("cancelled");
    const events = await app.inject({
      method: "GET",
      url: `/runs/${run.id}/events`,
      cookies: session,
    });
    expect(events.json().events).toMatchObject([
      { type: "run.cancelled", sequence: 0 },
    ]);
  });

  it("publishes a project, serves it publicly, and rolls back by activation", async () => {
    const buildProvider = new FakeBuildProvider();
    const { app, session, project } = await fixture(buildProvider);

    const first = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/releases`,
      cookies: session,
      headers: clientHeader,
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json();
    expect(firstBody.release.status).toBe("ready");
    expect(firstBody.publication.currentReleaseId).toBe(firstBody.release.id);
    expect(firstBody.publication.baseUrl).toContain(
      `/published/${project.id}/`,
    );

    const served = await app.inject({
      method: "GET",
      url: `/published/${project.id}/`,
    });
    expect(served.statusCode).toBe(200);
    expect(served.body).toContain("build-1");
    expect(served.headers["content-type"]).toContain("text/html");

    const asset = await app.inject({
      method: "GET",
      url: `/published/${project.id}/assets/app.js`,
    });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");

    const traversal = await app.inject({
      method: "GET",
      url: `/published/${project.id}/%2e%2e/%2e%2e/control-plane.sqlite`,
    });
    // Encoded dot segments normalize away from the public prefix and are
    // rejected before any file lookup happens.
    expect([401, 404]).toContain(traversal.statusCode);
    expect(traversal.body).not.toContain("projects");

    const second = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/releases`,
      cookies: session,
      headers: clientHeader,
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().release.id).not.toBe(firstBody.release.id);
    expect(
      (await app.inject({ method: "GET", url: `/published/${project.id}/` }))
        .body,
    ).toContain("build-2");

    const rolledBack = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/releases/${firstBody.release.id}/activate`,
      cookies: session,
      headers: clientHeader,
    });
    expect(rolledBack.statusCode).toBe(200);
    expect(rolledBack.json().publication.currentReleaseId).toBe(
      firstBody.release.id,
    );
    expect(
      (await app.inject({ method: "GET", url: `/published/${project.id}/` }))
        .body,
    ).toContain("build-1");

    const list = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/releases`,
      cookies: session,
    });
    expect(list.json().releases).toHaveLength(2);
    expect(list.json().publication.currentReleaseId).toBe(firstBody.release.id);
  });
  it("wakes a sleeping preview on view and reports it as starting", async () => {
    const { app, root, session, project } = await fixture();
    const store = new ControlPlaneStore(
      path.join(root, "control-plane.sqlite"),
    );
    try {
      store.setProjectPreview({ projectId: project.id, status: "stopped" });
      const sleeping = await app.inject({
        method: "GET",
        url: `/projects/${project.id}/preview`,
        cookies: session,
      });
      expect(sleeping.json().preview).toMatchObject({
        status: "starting",
        url: null,
      });

      store.setProjectPreview({
        projectId: project.id,
        status: "running",
        url: "http://127.0.0.1:4321/",
        port: 4321,
      });
      const running = await app.inject({
        method: "GET",
        url: `/projects/${project.id}/preview`,
        cookies: session,
      });
      expect(running.json().preview).toMatchObject({
        status: "running",
        port: 4321,
      });
    } finally {
      store.close();
    }
  });
});
