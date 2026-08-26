import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  AgentEvent,
  AgentRun,
  FileContent,
  FileEntry,
  FileMutationResult,
} from "@atoms/contracts";
import { workspacePathSchema } from "@atoms/contracts";
import type { ControlPlaneStore } from "@atoms/db";
import {
  LocalGitWorkspace,
  WorkspaceWriteLock,
  type Workspace,
} from "@atoms/workspace-sdk";
import type { PreviewProvider } from "@atoms/sandbox-sdk";
import type {
  AgentChatMessage,
  AgentModel,
  ModelToolCall,
  ModelToolDefinition,
} from "./model.js";
import { startProjectPreview } from "./preview.js";

const listFilesArgs = z.object({}).passthrough();
const emptyArgs = z.object({}).passthrough();
const pathArgs = z.object({ path: z.string().min(1) });
const searchArgs = z.object({ query: z.string().trim().min(1).max(200) });
const writeFileArgs = z.object({
  path: z.string().min(1),
  content: z.string(),
});
const patchArgs = z.object({
  path: z.string().min(1),
  expectedHash: z.string().regex(/^[0-9a-f]{64}$/i),
  search: z.string().min(1),
  replacement: z.string(),
});

const toolDefinitions: ModelToolDefinition[] = [
  {
    name: "list_files",
    description: "List the files in the current project workspace.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_file",
    description: "Read one text file from the current project workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "search_files",
    description: "Search text in project files without reading secret files.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", minLength: 1 } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description:
      "Create or replace one text file in the current project workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "apply_patch",
    description: "Apply one exact, hash-guarded replacement to a text file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        expectedHash: { type: "string" },
        search: { type: "string" },
        replacement: { type: "string" },
      },
      required: ["path", "expectedHash", "search", "replacement"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_file",
    description: "Delete one regular file from the current project workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "get_diff",
    description: "Show the current uncommitted Git diff for the workspace.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];

const systemPrompt = `You are the Atoms project agent. Work only through the provided workspace tools. Never invent file contents: read a file before patching it, and prefer small exact changes. Do not use shell commands or touch files outside the project. When the requested work is complete, briefly explain what changed.`;

type EventInput = AgentEvent extends infer Event
  ? Event extends AgentEvent
    ? Omit<Event, "runId" | "sequence" | "timestamp">
    : never
  : never;

export type AgentRunnerOptions = {
  store: ControlPlaneStore;
  workspaceRoot: string;
  model: AgentModel;
  previewProvider?: PreviewProvider;
  maxSteps?: number;
};

export class AgentRunner {
  readonly #store: ControlPlaneStore;
  readonly #workspaceRoot: string;
  readonly #model: AgentModel;
  readonly #previewProvider: PreviewProvider | undefined;
  readonly #maxSteps: number;

  constructor(options: AgentRunnerOptions) {
    this.#store = options.store;
    this.#workspaceRoot = options.workspaceRoot;
    this.#model = options.model;
    this.#previewProvider = options.previewProvider;
    this.#maxSteps = options.maxSteps ?? 12;
  }

  async run(run: AgentRun): Promise<void> {
    const workspaceRoot = `${this.#workspaceRoot}/${run.projectId}`;
    await new WorkspaceWriteLock(workspaceRoot).runExclusive(
      run.id,
      async () => {
        const emit = this.#eventEmitter(run.id);
        let workspace: LocalGitWorkspace | undefined;
        try {
          if (this.#store.isRunCancelled(run.id)) {
            emit({ type: "run.cancelled" });
            return;
          }
          this.#store.transitionRun(run.id, "running");
          emit({ type: "run.started" });
          workspace = await LocalGitWorkspace.open(workspaceRoot);
          const userMessage = this.#store
            .listMessages(run.chatId)
            .find((message) => message.id === run.userMessageId);
          if (!userMessage)
            throw new Error("User message for run was not found");

          const chatHistory = this.#store
            .listMessages(run.chatId)
            .filter(
              (message) =>
                message.id !== userMessage.id && message.role !== "system",
            )
            .slice(-8)
            .map((message) => ({
              role: message.role as "user" | "assistant",
              content: message.content.slice(0, 2000),
            }));
          const messages: AgentChatMessage[] = [
            { role: "system", content: systemPrompt },
            ...chatHistory,
            { role: "user", content: userMessage.content },
          ];
          const changedPaths = new Set<string>();
          const responseParts: string[] = [];
          let modelFinished = false;

          for (let step = 0; step < this.#maxSteps; step += 1) {
            if (this.#store.isRunCancelled(run.id)) {
              emit({ type: "run.cancelled" });
              return;
            }
            const turn = await this.#model.complete({
              messages,
              tools: toolDefinitions,
              model: run.model ?? undefined,
            });
            if (turn.content) {
              responseParts.push(turn.content);
              emit({ type: "message.delta", delta: turn.content });
            }
            if (turn.toolCalls.length === 0) {
              modelFinished = true;
              break;
            }

            messages.push({
              role: "assistant",
              content: turn.content,
              toolCalls: turn.toolCalls,
            });
            for (let index = 0; index < turn.toolCalls.length; index += 1) {
              const toolCall = turn.toolCalls[index]!;
              const toolId = randomUUID();
              this.#store.createToolCall({
                id: toolId,
                runId: run.id,
                sequence: index + step * 100,
                toolName: toolCall.name,
                inputJson: toolCall.arguments,
              });
              emit({
                type: "tool.started",
                toolCallId: toolId,
                toolName: toolCall.name,
              });
              try {
                const output = await executeTool(
                  workspace,
                  toolCall,
                  changedPaths,
                );
                this.#store.completeToolCall(
                  toolId,
                  JSON.stringify(output),
                  "completed",
                );
                emit({ type: "tool.completed", toolCallId: toolId });
                messages.push({
                  role: "tool",
                  content: JSON.stringify(output),
                  toolCallId: toolCall.id,
                });
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : String(error);
                this.#store.completeToolCall(
                  toolId,
                  JSON.stringify({ error: message }),
                  "failed",
                );
                emit({
                  type: "tool.failed",
                  toolCallId: toolId,
                  error: message,
                });
                messages.push({
                  role: "tool",
                  content: JSON.stringify({ error: message }),
                  toolCallId: toolCall.id,
                });
              }
            }
          }

          if (!modelFinished) {
            throw new RunFailure(
              "max_steps",
              "The agent reached the maximum tool-call steps",
            );
          }
          if (changedPaths.size === 0) {
            throw new RunFailure(
              "no_changes",
              "The agent completed without changing any project files",
            );
          }
          if (this.#store.isRunCancelled(run.id)) {
            emit({ type: "run.cancelled" });
            return;
          }
          this.#store.transitionRun(run.id, "validating");
          this.#store.transitionRun(run.id, "committing");
          const commitHash = await workspace.commit(
            `Agent: ${userMessage.content.slice(0, 72).replaceAll("\n", " ")}`,
          );
          emit({ type: "files.changed", paths: [...changedPaths].sort() });
          const content = responseParts.join("\n\n") || "已完成项目文件更新。";
          this.#store.addAssistantMessage({
            chatId: run.chatId,
            content,
            sourceCommit: run.baseCommit,
            resultCommit: commitHash,
            model: run.model,
            runId: run.id,
          });
          this.#store.addVersion({
            projectId: run.projectId,
            commitHash,
            parentCommitHash: run.baseCommit,
            message: `Agent: ${userMessage.content.slice(0, 72).replaceAll("\n", " ")}`,
            runId: run.id,
          });
          this.#store.transitionRun(run.id, "succeeded", {
            resultCommit: commitHash,
          });
          emit({ type: "run.completed", commitHash });
          if (this.#previewProvider) {
            void startProjectPreview({
              store: this.#store,
              previewProvider: this.#previewProvider,
              projectId: run.projectId,
              workspaceRoot,
              emit,
            });
          }
        } catch (error) {
          if (this.#store.isRunCancelled(run.id)) {
            emit({ type: "run.cancelled" });
            return;
          }
          const failure =
            error instanceof RunFailure
              ? error
              : new RunFailure(
                  "agent_failed",
                  error instanceof Error ? error.message : String(error),
                );
          await workspace?.discardChanges().catch(() => undefined);
          this.#store.transitionRun(run.id, "failed", {
            errorCode: failure.code,
            errorMessage: failure.message,
          });
          emit({
            type: "run.failed",
            errorCode: failure.code,
            message: failure.message,
          });
        }
      },
    );
  }

  #eventEmitter(runId: string): (event: EventInput) => void {
    return (event) => {
      this.#store.appendAgentEvent({ ...event, runId });
    };
  }
}

class RunFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function executeTool(
  workspace: Workspace,
  toolCall: ModelToolCall,
  changedPaths: Set<string>,
): Promise<unknown> {
  const raw: unknown = JSON.parse(toolCall.arguments);
  switch (toolCall.name) {
    case "list_files": {
      listFilesArgs.parse(raw);
      return (await workspace.listFiles()).filter(
        (entry) => entry.kind === "file",
      );
    }
    case "read_file": {
      const input = pathArgs.parse(raw);
      return await workspace.readFile(workspacePathSchema.parse(input.path));
    }
    case "search_files": {
      const input = searchArgs.parse(raw);
      return await workspace.searchFiles(input.query);
    }
    case "write_file": {
      const input = writeFileArgs.parse(raw);
      const result = await workspace.writeFile(
        workspacePathSchema.parse(input.path),
        input.content,
      );
      if (result.changed) changedPaths.add(result.path);
      return result;
    }
    case "apply_patch": {
      const input = patchArgs.parse(raw);
      const result = await workspace.applyPatch({
        ...input,
        path: workspacePathSchema.parse(input.path),
      });
      if (result.changed) changedPaths.add(result.path);
      return result;
    }
    case "delete_file": {
      const input = pathArgs.parse(raw);
      const result = await workspace.deleteFile(
        workspacePathSchema.parse(input.path),
      );
      if (result.changed) changedPaths.add(result.path);
      return result;
    }
    case "get_diff": {
      emptyArgs.parse(raw);
      return { diff: await workspace.getDiff() };
    }
    default:
      throw new Error(`Unknown workspace tool: ${toolCall.name}`);
  }
}
