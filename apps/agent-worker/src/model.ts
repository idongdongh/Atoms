export type AgentChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ModelToolCall[];
};

export type ModelToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ModelTurn = {
  content: string;
  toolCalls: ModelToolCall[];
};

export type ModelToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export interface AgentModel {
  complete(input: {
    messages: AgentChatMessage[];
    tools: ModelToolDefinition[];
    model?: string | undefined;
  }): Promise<ModelTurn>;
}

type OpenAIResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
};

export class OpenAICompatibleModel implements AgentModel {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #defaultModel: string;
  readonly #timeoutMs: number;

  constructor(input: {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs?: number;
  }) {
    this.#baseUrl = input.baseUrl.replace(/\/$/, "");
    this.#apiKey = input.apiKey;
    this.#defaultModel = input.model;
    this.#timeoutMs = input.timeoutMs ?? 120_000;
  }

  async complete(input: {
    messages: AgentChatMessage[];
    tools: ModelToolDefinition[];
    model?: string | undefined;
  }): Promise<ModelTurn> {
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model ?? this.#defaultModel,
          temperature: 0.2,
          messages: input.messages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
            ...(message.toolCalls
              ? {
                  tool_calls: message.toolCalls.map((toolCall) => ({
                    id: toolCall.id,
                    type: "function",
                    function: {
                      name: toolCall.name,
                      arguments: toolCall.arguments,
                    },
                  })),
                }
              : {}),
          })),
          tools: input.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(
          `Model request timed out after ${this.#timeoutMs}ms`,
        );
      }
      throw error;
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Model request failed (${response.status}): ${detail}`);
    }
    const payload = (await response.json()) as OpenAIResponse;
    const message = payload.choices?.[0]?.message;
    if (!message) throw new Error("Model returned no assistant message");
    return {
      content: message.content ?? "",
      toolCalls: (message.tool_calls ?? []).flatMap((toolCall) => {
        const id = toolCall.id;
        const name = toolCall.function?.name;
        if (!id || !name) return [];
        return [
          {
            id,
            name,
            arguments: toolCall.function?.arguments ?? "{}",
          },
        ];
      }),
    };
  }
}

export class DemoModel implements AgentModel {
  async complete(input: {
    messages: AgentChatMessage[];
    tools: ModelToolDefinition[];
  }): Promise<ModelTurn> {
    const last = input.messages.at(-1);
    if (last?.role === "tool") {
      return {
        content: "已根据你的描述更新了项目文件，下一步可以继续提出修改要求。",
        toolCalls: [],
      };
    }
    const prompt =
      input.messages
        .filter((message) => message.role === "user")
        .at(-1)?.content ?? "你的产品";
    const writeTool = input.tools.find((tool) => tool.name === "write_file");
    if (!writeTool) throw new Error("write_file tool is not available");
    return {
      content: "我先把启动页替换成一个可继续迭代的产品入口。",
      toolCalls: [
        {
          id: `demo-${Date.now()}`,
          name: writeTool.name,
          arguments: JSON.stringify({
            path: "src/App.tsx",
            content: `export function App() {\n  return (\n    <main>\n      <p className="label">Generated with Atoms</p>\n      <h1>${escapeJsx(prompt.slice(0, 80))}</h1>\n      <p className="lead">这是一个由 Atoms Agent 生成的可运行起点。你可以继续描述页面、数据和交互，我会通过版本化文件变更逐步实现。</p>\n      <button type="button">开始体验</button>\n    </main>\n  );\n}\n`,
          }),
        },
      ],
    };
  }
}

function escapeJsx(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createConfiguredModel(
  env: NodeJS.ProcessEnv = process.env,
): AgentModel {
  if (env.ATOMS_MODEL_PROVIDER === "demo") return new DemoModel();
  const apiKey = env.ATOMS_MODEL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "model_not_configured: set ATOMS_MODEL_PROVIDER=demo for local development or provide ATOMS_MODEL_API_KEY",
    );
  }
  return new OpenAICompatibleModel({
    baseUrl: env.ATOMS_MODEL_BASE_URL ?? "https://api.openai.com/v1",
    apiKey,
    model: env.ATOMS_MODEL_NAME ?? "gpt-4o-mini",
  });
}
