import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  agentRunSchema,
  agentEventSchema,
  chatMessageSchema,
  projectSchema,
  projectPreviewSchema,
  projectVersionSchema,
  toolCallSchema,
  canTransitionAgentRun,
  type AgentEvent,
  type AgentRun,
  type ChatMessage,
  type Project,
  type ProjectPreview,
  type ProjectVersion,
  type AgentRunStatus,
  type ToolCall,
} from "@atoms/contracts";

type ProjectRecord = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  template_id: string;
  default_branch: string;
  current_commit: string;
  status: string;
  chat_id: string;
  created_at: string;
  updated_at: string;
};

type VersionRecord = {
  id: string;
  project_id: string;
  commit_hash: string;
  parent_commit_hash: string | null;
  message: string;
  run_id: string | null;
  created_at: string;
};

type EventRecord = { payload_json: string };

type AgentEventInput = AgentEvent extends infer Event
  ? Event extends AgentEvent
    ? Omit<Event, "sequence" | "timestamp">
    : never
  : never;

type MessageRecord = {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  source_commit: string | null;
  result_commit: string | null;
  model: string | null;
  run_id: string | null;
  created_at: string;
};

type RunRecord = {
  id: string;
  project_id: string;
  chat_id: string;
  user_message_id: string;
  status: string;
  idempotency_key: string;
  base_commit: string;
  result_commit: string | null;
  model: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type ToolCallRecord = {
  id: string;
  run_id: string;
  sequence: number;
  tool_name: string;
  input_json: string;
  output_json: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
};

type PreviewRecord = {
  project_id: string;
  status: string;
  url: string | null;
  port: number | null;
  error_message: string | null;
  updated_at: string;
};

function mapProject(record: ProjectRecord): Project {
  return projectSchema.parse({
    id: record.id,
    userId: record.user_id,
    name: record.name,
    slug: record.slug,
    templateId: record.template_id,
    defaultBranch: record.default_branch,
    currentCommit: record.current_commit,
    status: record.status,
    chatId: record.chat_id,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
}

function mapVersion(record: VersionRecord): ProjectVersion {
  return projectVersionSchema.parse({
    id: record.id,
    projectId: record.project_id,
    commitHash: record.commit_hash,
    parentCommitHash: record.parent_commit_hash,
    message: record.message,
    runId: record.run_id,
    createdAt: record.created_at,
  });
}

function mapMessage(record: MessageRecord): ChatMessage {
  return chatMessageSchema.parse({
    id: record.id,
    chatId: record.chat_id,
    role: record.role,
    content: record.content,
    sourceCommit: record.source_commit,
    resultCommit: record.result_commit,
    model: record.model,
    runId: record.run_id,
    createdAt: record.created_at,
  });
}

function mapRun(record: RunRecord): AgentRun {
  return agentRunSchema.parse({
    id: record.id,
    projectId: record.project_id,
    chatId: record.chat_id,
    userMessageId: record.user_message_id,
    status: record.status,
    idempotencyKey: record.idempotency_key,
    baseCommit: record.base_commit,
    resultCommit: record.result_commit,
    model: record.model,
    errorCode: record.error_code,
    errorMessage: record.error_message,
    createdAt: record.created_at,
    startedAt: record.started_at,
    completedAt: record.completed_at,
  });
}

function mapToolCall(record: ToolCallRecord): ToolCall {
  return toolCallSchema.parse({
    id: record.id,
    runId: record.run_id,
    sequence: record.sequence,
    toolName: record.tool_name,
    inputJson: record.input_json,
    outputJson: record.output_json,
    status: record.status,
    startedAt: record.started_at,
    completedAt: record.completed_at,
  });
}

function mapPreview(record: PreviewRecord): ProjectPreview {
  return projectPreviewSchema.parse({
    projectId: record.project_id,
    status: record.status,
    url: record.url,
    port: record.port,
    errorMessage: record.error_message,
    updatedAt: record.updated_at,
  });
}

export type CreateProjectRecord = {
  id: string;
  userId: string;
  name: string;
  slug: string;
  templateId: string;
  defaultBranch: string;
  currentCommit: string;
  chatId: string;
  createdAt: string;
};

export class ControlPlaneStore {
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.#migrate();
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        template_id TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        current_commit TEXT NOT NULL,
        status TEXT NOT NULL,
        chat_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_versions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        commit_hash TEXT NOT NULL,
        parent_commit_hash TEXT,
        message TEXT NOT NULL,
        run_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(project_id, commit_hash)
      );
      CREATE TABLE IF NOT EXISTS agent_events (
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(run_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        source_commit TEXT,
        result_commit TEXT,
        model TEXT,
        run_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        user_message_id TEXT NOT NULL REFERENCES messages(id),
        status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        base_commit TEXT NOT NULL,
        result_commit TEXT,
        model TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        UNIQUE(project_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output_json TEXT,
        status TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        UNIQUE(run_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS project_previews (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        url TEXT,
        port INTEGER,
        error_message TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  }

  ensureDevelopmentUser(): string {
    const id = "development-user";
    this.#database
      .prepare(
        "INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        id,
        "developer@atoms.local",
        "Atoms Developer",
        new Date().toISOString(),
      );
    return id;
  }

  createProject(input: CreateProjectRecord): Project {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(
          `INSERT INTO projects
            (id, user_id, name, slug, template_id, default_branch, current_commit, status, chat_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`,
        )
        .run(
          input.id,
          input.userId,
          input.name,
          input.slug,
          input.templateId,
          input.defaultBranch,
          input.currentCommit,
          input.chatId,
          input.createdAt,
          input.createdAt,
        );
      this.#database
        .prepare(
          "INSERT INTO chats (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          input.chatId,
          input.id,
          "Build conversation",
          input.createdAt,
          input.createdAt,
        );
      this.#database
        .prepare(
          `INSERT INTO project_versions
            (id, project_id, commit_hash, parent_commit_hash, message, run_id, created_at)
           VALUES (?, ?, ?, NULL, ?, NULL, ?)`,
        )
        .run(
          randomUUID(),
          input.id,
          input.currentCommit,
          "Initialize project",
          input.createdAt,
        );
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getProject(input.id);
  }

  getProject(projectId: string): Project {
    const record = this.#database
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(projectId) as ProjectRecord | undefined;
    if (!record) throw new Error("Project not found");
    return mapProject(record);
  }

  listProjects(userId: string): Project[] {
    const records = this.#database
      .prepare(
        "SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC",
      )
      .all(userId) as unknown as ProjectRecord[];
    return records.map(mapProject);
  }

  addVersion(input: {
    projectId: string;
    commitHash: string;
    parentCommitHash: string;
    message: string;
    runId?: string;
  }): ProjectVersion {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(
          `INSERT INTO project_versions
            (id, project_id, commit_hash, parent_commit_hash, message, run_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.commitHash,
          input.parentCommitHash,
          input.message,
          input.runId ?? null,
          createdAt,
        );
      this.#database
        .prepare(
          "UPDATE projects SET current_commit = ?, updated_at = ? WHERE id = ?",
        )
        .run(input.commitHash, createdAt, input.projectId);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.listVersions(input.projectId).find(
      (version) => version.id === id,
    )!;
  }

  listVersions(projectId: string): ProjectVersion[] {
    const records = this.#database
      .prepare(
        "SELECT * FROM project_versions WHERE project_id = ? ORDER BY created_at DESC",
      )
      .all(projectId) as unknown as VersionRecord[];
    return records.map(mapVersion);
  }

  getProjectIdForChat(chatId: string): string {
    const record = this.#database
      .prepare("SELECT project_id FROM chats WHERE id = ?")
      .get(chatId) as { project_id: string } | undefined;
    if (!record) throw new Error("Chat not found");
    return record.project_id;
  }

  listMessages(chatId: string): ChatMessage[] {
    const records = this.#database
      .prepare(
        "SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC",
      )
      .all(chatId) as unknown as MessageRecord[];
    return records.map(mapMessage);
  }

  createRun(input: {
    id: string;
    projectId: string;
    chatId: string;
    prompt: string;
    idempotencyKey: string;
    model?: string | undefined;
  }): AgentRun {
    const existing = this.#database
      .prepare(
        "SELECT * FROM agent_runs WHERE project_id = ? AND idempotency_key = ?",
      )
      .get(input.projectId, input.idempotencyKey) as RunRecord | undefined;
    if (existing) {
      const message = this.#database
        .prepare("SELECT content FROM messages WHERE id = ?")
        .get(existing.user_message_id) as { content: string } | undefined;
      if (message?.content !== input.prompt) {
        throw new Error("Idempotency key is already used for another prompt");
      }
      return mapRun(existing);
    }

    const project = this.getProject(input.projectId);
    const createdAt = new Date().toISOString();
    const messageId = randomUUID();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(
          `INSERT INTO messages
            (id, chat_id, role, content, source_commit, result_commit, model, run_id, created_at)
           VALUES (?, ?, 'user', ?, ?, NULL, ?, ?, ?)`,
        )
        .run(
          messageId,
          input.chatId,
          input.prompt,
          project.currentCommit,
          input.model ?? null,
          input.id,
          createdAt,
        );
      this.#database
        .prepare(
          `INSERT INTO agent_runs
            (id, project_id, chat_id, user_message_id, status, idempotency_key, base_commit, result_commit, model, error_code, error_message, created_at, started_at, completed_at)
           VALUES (?, ?, ?, ?, 'queued', ?, ?, NULL, ?, NULL, NULL, ?, NULL, NULL)`,
        )
        .run(
          input.id,
          input.projectId,
          input.chatId,
          messageId,
          input.idempotencyKey,
          project.currentCommit,
          input.model ?? null,
          createdAt,
        );
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      const raced = this.#database
        .prepare(
          "SELECT * FROM agent_runs WHERE project_id = ? AND idempotency_key = ?",
        )
        .get(input.projectId, input.idempotencyKey) as RunRecord | undefined;
      if (raced) {
        const message = this.#database
          .prepare("SELECT content FROM messages WHERE id = ?")
          .get(raced.user_message_id) as { content: string } | undefined;
        if (message?.content !== input.prompt) {
          throw new Error("Idempotency key is already used for another prompt");
        }
        return mapRun(raced);
      }
      throw error;
    }
    return this.getRun(input.id);
  }

  getRun(runId: string): AgentRun {
    const record = this.#database
      .prepare("SELECT * FROM agent_runs WHERE id = ?")
      .get(runId) as RunRecord | undefined;
    if (!record) throw new Error("Run not found");
    return mapRun(record);
  }

  listRuns(chatId: string): AgentRun[] {
    const records = this.#database
      .prepare(
        "SELECT * FROM agent_runs WHERE chat_id = ? ORDER BY created_at DESC",
      )
      .all(chatId) as unknown as RunRecord[];
    return records.map(mapRun);
  }

  recoverInterruptedRuns(): AgentRun[] {
    const records = this.#database
      .prepare(
        `SELECT * FROM agent_runs
         WHERE status IN ('preparing', 'running', 'waiting_approval', 'validating', 'committing')`,
      )
      .all() as unknown as RunRecord[];
    if (records.length === 0) return [];
    const completedAt = new Date().toISOString();
    this.#database
      .prepare(
        `UPDATE agent_runs
         SET status = 'failed', error_code = 'worker_interrupted',
             error_message = 'The worker stopped before the run completed', completed_at = ?
         WHERE status IN ('preparing', 'running', 'waiting_approval', 'validating', 'committing')`,
      )
      .run(completedAt);
    return records.map((record) => this.getRun(record.id));
  }

  claimNextRun(): AgentRun | null {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const record = this.#database
        .prepare(
          "SELECT * FROM agent_runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1",
        )
        .get() as RunRecord | undefined;
      if (!record) {
        this.#database.exec("COMMIT");
        return null;
      }
      const startedAt = new Date().toISOString();
      this.#database
        .prepare(
          "UPDATE agent_runs SET status = 'preparing', started_at = ? WHERE id = ? AND status = 'queued'",
        )
        .run(startedAt, record.id);
      this.#database.exec("COMMIT");
      return this.getRun(record.id);
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  transitionRun(
    runId: string,
    status: AgentRunStatus,
    updates: {
      resultCommit?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    } = {},
  ): AgentRun {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getRun(runId);
      if (
        current.status !== status &&
        !canTransitionAgentRun(current.status, status)
      ) {
        throw new Error(`Invalid run transition: ${current.status} -> ${status}`);
      }
      const completedAt = ["succeeded", "failed", "cancelled"].includes(status)
        ? new Date().toISOString()
        : null;
      this.#database
        .prepare(
          `UPDATE agent_runs
           SET status = ?, result_commit = COALESCE(?, result_commit),
               error_code = COALESCE(?, error_code), error_message = COALESCE(?, error_message),
               completed_at = COALESCE(?, completed_at)
           WHERE id = ?`,
        )
        .run(
          status,
          updates.resultCommit ?? null,
          updates.errorCode ?? null,
          updates.errorMessage ?? null,
          completedAt,
          runId,
        );
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getRun(runId);
  }

  isRunCancelled(runId: string): boolean {
    return this.getRun(runId).status === "cancelled";
  }

  addAssistantMessage(input: {
    chatId: string;
    content: string;
    sourceCommit: string;
    resultCommit?: string | null;
    model?: string | null;
    runId: string;
  }): ChatMessage {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.#database
      .prepare(
        `INSERT INTO messages
          (id, chat_id, role, content, source_commit, result_commit, model, run_id, created_at)
         VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.chatId,
        input.content,
        input.sourceCommit,
        input.resultCommit ?? null,
        input.model ?? null,
        input.runId,
        createdAt,
      );
    return mapMessage(
      this.#database
        .prepare("SELECT * FROM messages WHERE id = ?")
        .get(id) as MessageRecord,
    );
  }

  updateProjectCommit(projectId: string, commitHash: string): Project {
    this.#database
      .prepare(
        "UPDATE projects SET current_commit = ?, updated_at = ? WHERE id = ?",
      )
      .run(commitHash, new Date().toISOString(), projectId);
    return this.getProject(projectId);
  }

  createToolCall(input: {
    id: string;
    runId: string;
    sequence: number;
    toolName: string;
    inputJson: string;
  }): ToolCall {
    const startedAt = new Date().toISOString();
    this.#database
      .prepare(
        `INSERT INTO tool_calls
          (id, run_id, sequence, tool_name, input_json, output_json, status, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'running', ?, NULL)`,
      )
      .run(
        input.id,
        input.runId,
        input.sequence,
        input.toolName,
        input.inputJson,
        startedAt,
      );
    return this.getToolCall(input.id);
  }

  completeToolCall(
    toolCallId: string,
    outputJson: string,
    status: "completed" | "failed",
  ): ToolCall {
    this.#database
      .prepare(
        "UPDATE tool_calls SET output_json = ?, status = ?, completed_at = ? WHERE id = ?",
      )
      .run(outputJson, status, new Date().toISOString(), toolCallId);
    return this.getToolCall(toolCallId);
  }

  getToolCall(toolCallId: string): ToolCall {
    const record = this.#database
      .prepare("SELECT * FROM tool_calls WHERE id = ?")
      .get(toolCallId) as ToolCallRecord | undefined;
    if (!record) throw new Error("Tool call not found");
    return mapToolCall(record);
  }

  listToolCalls(runId: string): ToolCall[] {
    const records = this.#database
      .prepare(
        "SELECT * FROM tool_calls WHERE run_id = ? ORDER BY sequence ASC",
      )
      .all(runId) as unknown as ToolCallRecord[];
    return records.map(mapToolCall);
  }

  getProjectPreview(projectId: string): ProjectPreview | null {
    const record = this.#database
      .prepare("SELECT * FROM project_previews WHERE project_id = ?")
      .get(projectId) as PreviewRecord | undefined;
    return record ? mapPreview(record) : null;
  }

  setProjectPreview(input: {
    projectId: string;
    status: ProjectPreview["status"];
    url?: string | null;
    port?: number | null;
    errorMessage?: string | null;
  }): ProjectPreview {
    const updatedAt = new Date().toISOString();
    this.#database
      .prepare(
        `INSERT INTO project_previews (project_id, status, url, port, error_message, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           status = excluded.status,
           url = excluded.url,
           port = excluded.port,
           error_message = excluded.error_message,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.projectId,
        input.status,
        input.url ?? null,
        input.port ?? null,
        input.errorMessage ?? null,
        updatedAt,
      );
    return this.getProjectPreview(input.projectId)!;
  }

  appendAgentEvent(event: AgentEventInput): void {
    this.#database.exec("BEGIN IMMEDIATE");
    let validated: AgentEvent;
    try {
      const last = this.#database
        .prepare(
          "SELECT COALESCE(MAX(sequence), -1) AS last FROM agent_events WHERE run_id = ?",
        )
        .get(event.runId) as { last: number };
      validated = agentEventSchema.parse({
        ...event,
        sequence: last.last + 1,
        timestamp: new Date().toISOString(),
      });
      this.#database
        .prepare(
          `INSERT INTO agent_events (run_id, sequence, type, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          validated.runId,
          validated.sequence,
          validated.type,
          JSON.stringify(validated),
          validated.timestamp,
        );
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  listAgentEvents(runId: string, afterSequence = -1): AgentEvent[] {
    const records = this.#database
      .prepare(
        `SELECT payload_json FROM agent_events
         WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC`,
      )
      .all(runId, afterSequence) as unknown as EventRecord[];
    return records.map((record) =>
      agentEventSchema.parse(JSON.parse(record.payload_json)),
    );
  }

  close(): void {
    this.#database.close();
  }
}
