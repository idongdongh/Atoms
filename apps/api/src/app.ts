import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import http from "node:http";
import { cp, lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import {
  agentRunStatusSchema,
  createProjectInputSchema,
  createRunInputSchema,
  loginInputSchema,
  registerInputSchema,
  restoreProjectInputSchema,
  type AgentRun,
  type Project,
  type ProjectPublication,
  type ProjectPreview,
  type User,
} from "@atoms/contracts";
import { ControlPlaneStore } from "@atoms/db";
import type { BuildProvider } from "@atoms/sandbox-sdk";
import { LocalViteBuildProvider } from "@atoms/sandbox-sdk";
import {
  createProjectWorkspace,
  LocalGitWorkspace,
  WorkspaceWriteLock,
} from "@atoms/workspace-sdk";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";

export type AppOptions = {
  databasePath?: string | undefined;
  workspaceRoot?: string | undefined;
  templateRoot?: string | undefined;
  releasesRoot?: string | undefined;
  buildProvider?: BuildProvider | undefined;
  logger?: boolean | undefined;
};

const staticContentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function publicationView(
  request: FastifyRequest,
  publication: ProjectPublication,
): ProjectPublication & { baseUrl: string } {
  const host = request.headers.host ?? request.hostname;
  return {
    ...publication,
    baseUrl: `${request.protocol}://${host}/published/${publication.projectId}/`,
  };
}

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

const sessionCookieName = "atoms_session";
const sessionMaxAgeSeconds = 7 * 24 * 60 * 60;

function readSessionToken(request: FastifyRequest): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === sessionCookieName) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, "hex");
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
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
  const releasesRoot = path.resolve(
    options.releasesRoot ?? ".atoms-data/published",
  );
  const buildProvider = options.buildProvider ?? new LocalViteBuildProvider();
  const store = new ControlPlaneStore(
    options.databasePath ?? path.resolve(".atoms-data/control-plane.sqlite"),
  );
  const app = Fastify({ logger: options.logger ?? true, trustProxy: true });

  const requestUsers = new WeakMap<FastifyRequest, User>();
  const currentUser = (request: FastifyRequest): User | undefined =>
    requestUsers.get(request);

  const findOwnedProject = (
    request: FastifyRequest,
    projectId: string,
  ): Project | null => {
    try {
      const project = store.getProject(projectId);
      return project.userId === currentUser(request)?.id ? project : null;
    } catch {
      return null;
    }
  };

  const findOwnedRun = (
    request: FastifyRequest,
    runId: string,
  ): AgentRun | null => {
    try {
      const run = store.getRun(runId);
      const project = store.getProject(run.projectId);
      return project.userId === currentUser(request)?.id ? run : null;
    } catch {
      return null;
    }
  };

  const findOwnedChat = (
    request: FastifyRequest,
    chatId: string,
  ): string | null => {
    try {
      const projectId = store.getProjectIdForChat(chatId);
      return findOwnedProject(request, projectId) ? projectId : null;
    } catch {
      return null;
    }
  };

  app.addHook("onRequest", async (request, reply) => {
    const token = readSessionToken(request);
    if (token) {
      const user = store.getSessionUser(token);
      if (user) requestUsers.set(request, user);
    }
    const path = (request.url.split("?")[0] ?? request.url) as string;
    const isPublicPath =
      path === "/health" ||
      path.startsWith("/auth/") ||
      path.startsWith("/published/");
    if (!isPublicPath && !requestUsers.has(request)) {
      reply.code(401);
      return reply.send({
        error: "unauthorized",
        message: "Sign in to continue",
      });
    }
    // Published apps share the builder origin, so mutating requests require
    // an explicit client header: generated code cannot drive the control
    // plane with the visitor's session cookie.
    const isMutating = request.method !== "GET" && request.method !== "HEAD";
    if (
      isMutating &&
      !path.startsWith("/auth/") &&
      request.headers["x-atoms-client"] !== "web"
    ) {
      reply.code(403);
      return reply.send({
        error: "missing_client_header",
        message: "Mutating requests must carry the x-atoms-client header",
      });
    }
  });

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

  app.post("/auth/register", async (request, reply) => {
    const input = registerInputSchema.safeParse(request.body);
    if (!input.success) {
      reply.code(400);
      return {
        error: "invalid_request",
        message: "名称、邮箱或密码不合法（密码至少 8 位）",
      };
    }
    if (store.getUserByEmail(input.data.email)) {
      reply.code(409);
      return { error: "email_taken", message: "该邮箱已注册" };
    }
    const user = store.createUser({
      id: randomUUID(),
      email: input.data.email,
      name: input.data.name,
      passwordHash: hashPassword(input.data.password),
    });
    const token = randomBytes(32).toString("hex");
    store.createSession({
      token,
      userId: user.id,
      expiresAt: new Date(
        Date.now() + sessionMaxAgeSeconds * 1000,
      ).toISOString(),
    });
    reply.header(
      "set-cookie",
      `${sessionCookieName}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${sessionMaxAgeSeconds}`,
    );
    reply.code(201);
    return { user };
  });

  app.post("/auth/login", async (request, reply) => {
    const input = loginInputSchema.safeParse(request.body);
    if (!input.success) {
      reply.code(400);
      return { error: "invalid_request", message: "邮箱或密码不合法" };
    }
    const record = store.getUserByEmail(input.data.email);
    if (
      !record ||
      !record.passwordHash ||
      !verifyPassword(input.data.password, record.passwordHash)
    ) {
      reply.code(401);
      return { error: "invalid_credentials", message: "邮箱或密码不正确" };
    }
    const token = randomBytes(32).toString("hex");
    store.createSession({
      token,
      userId: record.id,
      expiresAt: new Date(
        Date.now() + sessionMaxAgeSeconds * 1000,
      ).toISOString(),
    });
    reply.header(
      "set-cookie",
      `${sessionCookieName}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${sessionMaxAgeSeconds}`,
    );
    return {
      user: {
        id: record.id,
        email: record.email,
        name: record.name,
        createdAt: record.createdAt,
      },
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = readSessionToken(request);
    if (token) store.deleteSession(token);
    reply.header(
      "set-cookie",
      `${sessionCookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
    );
    return { ok: true };
  });

  app.get("/auth/me", async (request, reply) => {
    const user = currentUser(request);
    if (!user) {
      reply.code(401);
      return { error: "unauthorized", message: "Not signed in" };
    }
    return { user };
  });

  app.get("/projects", async (request) => ({
    projects: store.listProjects(currentUser(request)!.id),
  }));

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
        userId: currentUser(request)!.id,
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
      const project = findOwnedProject(request, request.params.projectId);
      if (!project) return notFound(reply);
      return { project };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/files",
    async (request, reply) => {
      if (!findOwnedProject(request, request.params.projectId)) {
        return notFound(reply);
      }
      const workspace = await LocalGitWorkspace.open(
        path.join(dataRoot, request.params.projectId),
      );
      return { files: await workspace.listFiles() };
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
    if (!findOwnedProject(request, request.params.projectId)) {
      return notFound(reply);
    }
    const workspace = await LocalGitWorkspace.open(
      path.join(dataRoot, request.params.projectId),
    );
    return { file: await workspace.readFile(request.query.path) };
  });

  app.get<{
    Params: { projectId: string };
    Querystring: { q?: string };
  }>("/projects/:projectId/search", async (request, reply) => {
    if (!request.query.q?.trim()) {
      reply.code(400);
      return { error: "invalid_request", message: "Search query is required" };
    }
    if (!findOwnedProject(request, request.params.projectId)) {
      return notFound(reply);
    }
    const workspace = await LocalGitWorkspace.open(
      path.join(dataRoot, request.params.projectId),
    );
    return { matches: await workspace.searchFiles(request.query.q) };
  });

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/versions",
    async (request, reply) => {
      if (!findOwnedProject(request, request.params.projectId)) {
        return notFound(reply);
      }
      return { versions: store.listVersions(request.params.projectId) };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/preview",
    async (request, reply) => {
      if (!findOwnedProject(request, request.params.projectId)) {
        return notFound(reply);
      }
      let preview: ProjectPreview | null;
      preview = store.getProjectPreview(request.params.projectId);
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
      if (!findOwnedProject(request, request.params.projectId)) {
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
    "/projects/:projectId/releases",
    async (request, reply) => {
      const project = findOwnedProject(request, request.params.projectId);
      if (!project) return notFound(reply);
      const workspacePath = path.join(dataRoot, project.id);
      const release = store.createRelease({
        id: randomUUID(),
        projectId: project.id,
        commitHash: project.currentCommit,
      });
      try {
        const { distPath } = await new WorkspaceWriteLock(
          workspacePath,
        ).runExclusive(`release-${release.id}`, () =>
          buildProvider.build({
            projectId: project.id,
            workspaceRoot: workspacePath,
          }),
        );
        const releaseDir = path.join(releasesRoot, project.id, release.id);
        await mkdir(releaseDir, { recursive: true });
        await cp(distPath, releaseDir, { recursive: true });
        store.completeRelease(release.id, { status: "ready" });
        const publication = store.setPublication({
          projectId: project.id,
          releaseId: release.id,
        });
        reply.code(201);
        return {
          release: store.getRelease(release.id),
          publication: publicationView(request, publication),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        store.completeRelease(release.id, {
          status: "failed",
          errorMessage: message.slice(0, 500) || "Build failed",
        });
        reply.code(502);
        return {
          error: "release_failed",
          message,
          release: store.getRelease(release.id),
        };
      }
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/releases",
    async (request, reply) => {
      if (!findOwnedProject(request, request.params.projectId)) {
        return notFound(reply);
      }
      const publication = store.getPublication(request.params.projectId);
      return {
        releases: store.listReleases(request.params.projectId),
        publication: publication
          ? publicationView(request, publication)
          : null,
      };
    },
  );

  app.post<{ Params: { projectId: string; releaseId: string } }>(
    "/projects/:projectId/releases/:releaseId/activate",
    async (request, reply) => {
      const project = findOwnedProject(request, request.params.projectId);
      if (!project) return notFound(reply);
      let release;
      try {
        release = store.getRelease(request.params.releaseId);
      } catch {
        reply.code(404);
        return { error: "not_found", message: "Release was not found" };
      }
      if (release.projectId !== project.id) {
        reply.code(404);
        return { error: "not_found", message: "Release was not found" };
      }
      if (release.status !== "ready") {
        reply.code(409);
        return {
          error: "release_not_ready",
          message: "Only ready releases can be activated",
        };
      }
      const publication = store.setPublication({
        projectId: project.id,
        releaseId: release.id,
      });
      return { publication: publicationView(request, publication) };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/published/:projectId/*",
    async (request, reply) => {
      let publication: ProjectPublication | null;
      try {
        store.getProject(request.params.projectId);
        publication = store.getPublication(request.params.projectId);
      } catch {
        return notFound(reply);
      }
      if (!publication?.currentReleaseId) return notFound(reply);
      let root: string;
      try {
        root = await realpath(
          path.join(
            releasesRoot,
            request.params.projectId,
            publication.currentReleaseId,
          ),
        );
      } catch {
        return notFound(reply);
      }
      const wildcard =
        (request.params as Record<string, string | undefined>)["*"] ?? "";
      let requested: string;
      try {
        const normalized = wildcard.startsWith("/") ? wildcard : `/${wildcard}`;
        requested = decodeURIComponent(normalized).split("?")[0] ?? "/";
      } catch {
        reply.code(400);
        return { error: "invalid_request", message: "Invalid path encoding" };
      }
      if (requested.endsWith("/")) requested += "index.html";
      const target = path.resolve(root, `.${requested}`);
      if (!target.startsWith(`${root}${path.sep}`)) return notFound(reply);
      let stats;
      try {
        stats = await lstat(target);
      } catch {
        return notFound(reply);
      }
      if (stats.isSymbolicLink()) return notFound(reply);
      if (stats.isDirectory()) {
        return notFound(reply);
      }
      if (!stats.isFile()) return notFound(reply);
      const body = await readFile(target);
      const contentType =
        staticContentTypes[path.extname(target).toLowerCase()] ??
        "application/octet-stream";
      reply.header("content-type", contentType);
      reply.header(
        "cache-control",
        target.includes(`${path.sep}assets${path.sep}`)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
      return body;
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
      const project = findOwnedProject(request, request.params.projectId);
      if (!project) return notFound(reply);
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
      if (!findOwnedChat(request, request.params.chatId)) {
        return notFound(reply);
      }
      return { messages: store.listMessages(request.params.chatId) };
    },
  );

  app.get<{ Params: { chatId: string } }>(
    "/chats/:chatId/runs",
    async (request, reply) => {
      if (!findOwnedChat(request, request.params.chatId)) {
        return notFound(reply);
      }
      return { runs: store.listRuns(request.params.chatId) };
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
      const projectId = findOwnedChat(request, request.params.chatId);
      if (!projectId) return notFound(reply);
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
      const run = findOwnedRun(request, request.params.runId);
      if (!run) {
        reply.code(404);
        return { error: "not_found", message: "Run was not found" };
      }
      return {
        run,
        messages: store.listMessages(run.chatId),
        toolCalls: store.listToolCalls(run.id),
      };
    },
  );

  app.post<{ Params: { runId: string } }>(
    "/runs/:runId/cancel",
    async (request, reply) => {
      const run = findOwnedRun(request, request.params.runId);
      if (!run) {
        reply.code(404);
        return { error: "not_found", message: "Run was not found" };
      }
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
    },
  );

  app.post<{ Params: { runId: string } }>(
    "/runs/:runId/retry",
    async (request, reply) => {
      const run = findOwnedRun(request, request.params.runId);
      if (!run) {
        reply.code(404);
        return { error: "not_found", message: "Run was not found" };
      }
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
    },
  );

  app.get<{
    Params: { runId: string };
    Querystring: { after?: string };
  }>("/runs/:runId/events", async (request, reply) => {
    if (!findOwnedRun(request, request.params.runId)) {
      reply.code(404);
      return { error: "not_found", message: "Run was not found" };
    }
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
    const run = findOwnedRun(request, request.params.runId);
    if (!run) {
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
