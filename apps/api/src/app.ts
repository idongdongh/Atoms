import { randomUUID } from "node:crypto";
import http from "node:http";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  agentRunStatusSchema,
  createProjectInputSchema,
  createRunInputSchema,
  restoreProjectInputSchema,
  type ProjectPreview,
} from "@atoms/contracts";
import { ControlPlaneStore } from "@atoms/db";
import {
  createProjectWorkspace,
  LocalGitWorkspace,
  WorkspaceWriteLock,
} from "@atoms/workspace-sdk";
import Fastify, { type FastifyInstance } from "fastify";

export type AppOptions = {
  databasePath?: string | undefined;
  workspaceRoot?: string | undefined;
  templateRoot?: string | undefined;
  logger?: boolean | undefined;
};

function slugify(name: string, id: string): string {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
  return `${base || "project"}-${id.slice(0, 8)}`;
}

function notFound(reply: { code(statusCode: number): unknown }) {
  reply.code(404);
  return { error: "not_found", message: "Project was not found" };
}

function isTerminalRun(status: string): boolean {
  const parsed = agentRunStatusSchema.parse(status);
  return (
    parsed === "succeeded" || parsed === "failed" || parsed === "cancelled"
  );
}

export function createApp(options: AppOptions = {}): FastifyInstance {
  const dataRoot = path.resolve(
    options.workspaceRoot ?? ".atoms-data/workspaces",
  );
  const templateRoot = path.resolve(
    options.templateRoot ?? "templates/react-vite",
  );
  const store = new ControlPlaneStore(
    options.databasePath ?? path.resolve(".atoms-data/control-plane.sqlite"),
  );
  const userId = store.ensureDevelopmentUser();
  const app = Fastify({ logger: options.logger ?? true, trustProxy: true });

  app.addHook("onClose", async () => store.close());
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof Error && error.name === "ZodError") {
      reply.code(400).send({
        error: "invalid_request",
        message: "The request contains an invalid value",
      });
      return;
    }
    app.log.error(error);
    reply.code(500).send({
      error: "internal_error",
      message: "The request could not be completed",
    });
  });

  app.get("/health", async () => ({ service: "api", status: "ok" }));

  app.get("/projects", async () => ({ projects: store.listProjects(userId) }));

  app.post("/projects", async (request, reply) => {
    const input = createProjectInputSchema.safeParse(request.body);
    if (!input.success) {
      reply.code(400);
      return {
        error: "invalid_request",
        message: "Project name is required and must be 80 characters or fewer",
      };
    }
    const projectId = randomUUID();
    const chatId = randomUUID();
    const workspacePath = path.join(dataRoot, projectId);
    const createdAt = new Date().toISOString();
    try {
      const workspace = await createProjectWorkspace({
        workspaceRoot: workspacePath,
        templateRoot,
      });
      const project = store.createProject({
        id: projectId,
        userId,
        name: input.data.name,
        slug: slugify(input.data.name, projectId),
        templateId: "react-vite",
        defaultBranch: "main",
        currentCommit: workspace.initialCommitHash,
        chatId,
        createdAt,
      });
      reply.code(201);
      return { project };
    } catch (error) {
      await rm(workspacePath, { recursive: true, force: true });
      throw error;
    }
  });

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId",
    async (request, reply) => {
      try {
        return { project: store.getProject(request.params.projectId) };
      } catch {
        return notFound(reply);
      }
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/files",
    async (request, reply) => {
      try {
        store.getProject(request.params.projectId);
        const workspace = await LocalGitWorkspace.open(
          path.join(dataRoot, request.params.projectId),
        );
        return { files: await workspace.listFiles() };
      } catch (error) {
        if ((error as Error).message === "Project not found")
          return notFound(reply);
        throw error;
      }
    },
  );

  app.get<{
    Params: { projectId: string };
    Querystring: { path?: string };
  }>("/projects/:projectId/files/content", async (request, reply) => {
    if (!request.query.path) {
      reply.code(400);
      return { error: "invalid_request", message: "File path is required" };
    }
    try {
      store.getProject(request.params.projectId);
      const workspace = await LocalGitWorkspace.open(
        path.join(dataRoot, request.params.projectId),
      );
      return { file: await workspace.readFile(request.query.path) };
    } catch (error) {
      if ((error as Error).message === "Project not found")
        return notFound(reply);
      throw error;
    }
  });

  app.get<{
    Params: { projectId: string };
    Querystring: { q?: string };
  }>("/projects/:projectId/search", async (request, reply) => {
    if (!request.query.q?.trim()) {
      reply.code(400);
      return { error: "invalid_request", message: "Search query is required" };
    }
    try {
      store.getProject(request.params.projectId);
      const workspace = await LocalGitWorkspace.open(
        path.join(dataRoot, request.params.projectId),
      );
      return { matches: await workspace.searchFiles(request.query.q) };
    } catch (error) {
      if ((error as Error).message === "Project not found")
        return notFound(reply);
      throw error;
    }
  });

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/versions",
    async (request, reply) => {
      try {
        store.getProject(request.params.projectId);
        return { versions: store.listVersions(request.params.projectId) };
      } catch {
        return notFound(reply);
      }
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/preview",
    async (request, reply) => {
      let preview: ProjectPreview | null;
      try {
        store.getProject(request.params.projectId);
        preview = store.getProjectPreview(request.params.projectId);
      } catch {
        return notFound(reply);
      }
      // The preview child only listens on 127.0.0.1; the browser-facing URL
      // is the API proxy route, derived from the requesting host.
      const publicUrl =
        preview?.status === "running" && preview.port
          ? `${request.protocol}://${request.headers.host}/api/projects/${request.params.projectId}/preview/proxy/`
          : null;
      return {
        preview: preview
          ? { ...preview, url: publicUrl ?? preview.url }
          : null,
      };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/preview/proxy/*",
    async (request, reply) => {
      try {
        store.getProject(request.params.projectId);
      } catch {
        return notFound(reply);
      }
      const preview = store.getProjectPreview(request.params.projectId);
      if (!preview || preview.status !== "running" || !preview.port) {
        reply.code(503);
        return { error: "preview_unavailable", message: "Preview is not running" };
      }
      const marker = "/preview/proxy/";
      const markerIndex = request.url.indexOf(marker);
      const tailPath =
        markerIndex === -1
          ? "/"
          : request.url.slice(markerIndex + marker.length - 1);
      const headers = { ...request.headers };
      delete headers.host;
      delete headers.connection;
      headers.host = `127.0.0.1:${preview.port}`;
      reply.hijack();
      const upstream = http.request(
        `http://127.0.0.1:${preview.port}${tailPath}`,
        { method: request.method, headers },
        (upstreamResponse) => {
          reply.raw.writeHead(
            upstreamResponse.statusCode ?? 502,
            upstreamResponse.headers,
          );
          upstreamResponse.pipe(reply.raw);
        },
      );
      upstream.on("error", () => {
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(502, { "content-type": "text/plain" });
        }
        reply.raw.end("Preview upstream is unreachable");
      });
      request.raw.pipe(upstream);
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/restore",
    async (request, reply) => {
      const input = restoreProjectInputSchema.safeParse(request.body);
      if (!input.success) {
        reply.code(400);
        return {
          error: "invalid_request",
          message: "A valid commit hash is required",
        };
      }
      let project;
      try {
        project = store.getProject(request.params.projectId);
      } catch {
        return notFound(reply);
      }
      const workspacePath = path.join(dataRoot, project.id);
      const workspace = await LocalGitWorkspace.open(workspacePath);
      const commitHash = await new WorkspaceWriteLock(
        workspacePath,
      ).runExclusive(randomUUID(), () =>
        workspace.restore(
          input.data.commitHash,
          `Restore ${input.data.commitHash.slice(0, 8)}`,
        ),
      );
      const version = store.addVersion({
        projectId: project.id,
        commitHash,
        parentCommitHash: project.currentCommit,
        message: `Restore ${input.data.commitHash.slice(0, 8)}`,
      });
      return { project: store.getProject(project.id), version };
    },
  );

  app.get<{ Params: { chatId: string } }>(
    "/chats/:chatId/messages",
    async (request, reply) => {
      try {
        store.getProjectIdForChat(request.params.chatId);
        return { messages: store.listMessages(request.params.chatId) };
      } catch {
        return notFound(reply);
      }
    },
  );

  app.get<{ Params: { chatId: string } }>(
    "/chats/:chatId/runs",
    async (request, reply) => {
      try {
        store.getProjectIdForChat(request.params.chatId);
        return { runs: store.listRuns(request.params.chatId) };
      } catch {
        return notFound(reply);
      }
    },
  );

  app.post<{ Params: { chatId: string } }>(
    "/chats/:chatId/runs",
    async (request, reply) => {
      const input = createRunInputSchema.safeParse(request.body);
      if (!input.success) {
        reply.code(400);
        return {
          error: "invalid_request",
          message: "prompt and idempotencyKey are required",
        };
      }
      let projectId: string;
      try {
        projectId = store.getProjectIdForChat(request.params.chatId);
      } catch {
        return notFound(reply);
      }
      try {
        const run = store.createRun({
          id: randomUUID(),
          projectId,
          chatId: request.params.chatId,
          prompt: input.data.prompt,
          idempotencyKey: input.data.idempotencyKey,
          model: input.data.model,
        });
        reply.code(202);
        return { run };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("Idempotency key")
        ) {
          reply.code(409);
          return { error: "idempotency_conflict", message: error.message };
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { runId: string } }>(
    "/runs/:runId",
    async (request, reply) => {
      try {
        const run = store.getRun(request.params.runId);
        return {
          run,
          messages: store.listMessages(run.chatId),
          toolCalls: store.listToolCalls(run.id),
        };
      } catch {
        reply.code(404);
        return { error: "not_found", message: "Run was not found" };
      }
    },
  );

  app.post<{ Params: { runId: string } }>(
    "/runs/:runId/cancel",
    async (request, reply) => {
      try {
        const run = store.getRun(request.params.runId);
        if (!isTerminalRun(run.status)) {
          try {
            store.transitionRun(run.id, "cancelled");
          } catch (error) {
            reply.code(409);
            return {
              error: "run_not_cancellable",
              message:
                error instanceof Error
                  ? error.message
                  : "Run cannot be cancelled",
            };
          }
          store.appendAgentEvent({ type: "run.cancelled", runId: run.id });
        }
        return { run: store.getRun(run.id) };
      } catch {
        reply.code(404);
        return { error: "not_found", message: "Run was not found" };
      }
    },
  );

  app.post<{ Params: { runId: string } }>(
    "/runs/:runId/retry",
    async (request, reply) => {
      try {
        const run = store.getRun(request.params.runId);
        if (run.status !== "failed" && run.status !== "cancelled") {
          reply.code(409);
          return {
            error: "run_not_retryable",
            message: "Only failed or cancelled runs can be retried",
          };
        }
        const userMessage = store
          .listMessages(run.chatId)
          .find((message) => message.id === run.userMessageId);
        if (!userMessage) throw new Error("User message for run was not found");
        const retry = store.createRun({
          id: randomUUID(),
          projectId: run.projectId,
          chatId: run.chatId,
          prompt: userMessage.content,
          idempotencyKey: `${run.id}:retry:${randomUUID()}`,
          model: run.model ?? undefined,
        });
        reply.code(202);
        return { run: retry };
      } catch (error) {
        if (error instanceof Error && error.message === "Run not found") {
          reply.code(404);
          return { error: "not_found", message: "Run was not found" };
        }
        throw error;
      }
    },
  );

  app.get<{
    Params: { runId: string };
    Querystring: { after?: string };
  }>("/runs/:runId/events", async (request, reply) => {
    const after =
      request.query.after === undefined ? -1 : Number(request.query.after);
    if (!Number.isInteger(after) || after < -1) {
      reply.code(400);
      return { error: "invalid_request", message: "after must be an integer" };
    }
    return { events: store.listAgentEvents(request.params.runId, after) };
  });

  app.get<{
    Params: { runId: string };
    Querystring: { after?: string };
  }>("/runs/:runId/events/stream", async (request, reply) => {
    let run;
    try {
      run = store.getRun(request.params.runId);
    } catch {
      reply.code(404);
      return { error: "not_found", message: "Run was not found" };
    }
    const lastEventId = request.headers["last-event-id"];
    const headerAfter = Array.isArray(lastEventId)
      ? lastEventId[0]
      : lastEventId;
    const afterValue = request.query.after ?? headerAfter;
    let sequence = afterValue === undefined ? -1 : Number(afterValue);
    if (!Number.isInteger(sequence) || sequence < -1) {
      reply.code(400);
      return { error: "invalid_request", message: "after must be an integer" };
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    });
    const startedAt = Date.now();
    let lastWriteAt = Date.now();
    while (Date.now() - startedAt < 60_000) {
      const events = store.listAgentEvents(run.id, sequence);
      for (const event of events) {
        reply.raw.write(
          `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
        sequence = event.sequence;
        lastWriteAt = Date.now();
      }
      if (events.length === 0) {
        let current;
        try {
          current = store.getRun(run.id);
        } catch {
          break;
        }
        if (isTerminalRun(current.status)) break;
        if (Date.now() - lastWriteAt > 15_000) {
          reply.raw.write(": ping\n\n");
          lastWriteAt = Date.now();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    reply.raw.end();
  });

  return app;
}
