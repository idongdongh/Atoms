import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentModel } from "./model.js";
import { AgentRunner } from "./agent.js";
import { ControlPlaneStore } from "@atoms/db";
import { createProjectWorkspace } from "@atoms/workspace-sdk";

class ScriptedModel implements AgentModel {
  #calls = 0;

  async complete(): Promise<{
    content: string;
    toolCalls: Array<{ id: string; name: string; arguments: string }>;
  }> {
    if (this.#calls++ === 0) {
      return {
        content: "我会先添加一个入口标记。",
        toolCalls: [
          {
            id: "model-call-1",
            name: "write_file",
            arguments: JSON.stringify({
              path: "src/generated.ts",
              content: "export const generated = true;\n",
            }),
          },
        ],
      };
    }
    return { content: "文件已经更新。", toolCalls: [] };
  }
}

class ChattyModel implements AgentModel {
  async complete(): Promise<{
    content: string;
    toolCalls: Array<{ id: string; name: string; arguments: string }>;
  }> {
    return {
      content: "你好！告诉我你想构建什么，我来帮你实现。",
      toolCalls: [],
    };
  }
}

describe("AgentRunner", () => {
  it("executes structured workspace tools and records a version", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atoms-agent-test-"));
    const workspaceRoot = path.join(root, "workspaces");
    const projectId = randomUUID();
    const projectRoot = path.join(workspaceRoot, projectId);
    const workspace = await createProjectWorkspace({
      workspaceRoot: projectRoot,
      templateRoot: path.resolve("../../templates/react-vite"),
    });
    const store = new ControlPlaneStore(":memory:");
    const userId = store.ensureDevelopmentUser();
    const project = store.createProject({
      id: projectId,
      userId,
      name: "Runner test",
      slug: "runner-test",
      templateId: "react-vite",
      defaultBranch: "main",
      currentCommit: workspace.initialCommitHash,
      chatId: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    const run = store.createRun({
      id: randomUUID(),
      projectId: project.id,
      chatId: project.chatId,
      prompt: "Add an entry marker",
      idempotencyKey: "runner-test-1",
    });
    const claimed = store.claimNextRun();
    expect(claimed?.id).toBe(run.id);

    await new AgentRunner({
      store,
      workspaceRoot,
      model: new ScriptedModel(),
    }).run(claimed!);

    expect(store.getRun(run.id).status).toBe("succeeded");
    expect(store.listVersions(project.id)).toHaveLength(2);
    expect(store.listToolCalls(run.id)).toMatchObject([
      { toolName: "write_file", status: "completed" },
    ]);
    expect(store.listAgentEvents(run.id).map((event) => event.type)).toEqual([
      "run.started",
      "message.delta",
      "tool.started",
      "tool.completed",
      "message.delta",
      "files.changed",
      "run.completed",
    ]);
    await expect(
      readFile(path.join(projectRoot, "src/generated.ts"), "utf8"),
    ).resolves.toBe("export const generated = true;\n");
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  it("treats a text-only reply as a successful conversational turn", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atoms-agent-test-"));
    const workspaceRoot = path.join(root, "workspaces");
    const projectId = randomUUID();
    const workspace = await createProjectWorkspace({
      workspaceRoot: path.join(workspaceRoot, projectId),
      templateRoot: path.resolve("../../templates/react-vite"),
    });
    const store = new ControlPlaneStore(":memory:");
    const userId = store.ensureDevelopmentUser();
    const project = store.createProject({
      id: projectId,
      userId,
      name: "Chatty test",
      slug: "chatty-test",
      templateId: "react-vite",
      defaultBranch: "main",
      currentCommit: workspace.initialCommitHash,
      chatId: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    const run = store.createRun({
      id: randomUUID(),
      projectId: project.id,
      chatId: project.chatId,
      prompt: "你好",
      idempotencyKey: "chatty-test-1",
    });
    const claimed = store.claimNextRun();

    await new AgentRunner({
      store,
      workspaceRoot,
      model: new ChattyModel(),
    }).run(claimed!);

    const finished = store.getRun(run.id);
    expect(finished.status).toBe("succeeded");
    expect(finished.resultCommit).toBe(workspace.initialCommitHash);
    // No new version: the model replied without changing files.
    expect(store.listVersions(project.id)).toHaveLength(1);
    const messages = store.listMessages(project.chatId);
    expect(messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "你好！告诉我你想构建什么，我来帮你实现。",
    });
    store.close();
    await rm(root, { recursive: true, force: true });
  });
});
