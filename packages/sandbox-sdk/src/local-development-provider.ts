import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import type { SandboxStatus } from "@atoms/contracts";

export type PreviewProcess = {
  sandboxId: string;
  projectId: string;
  workspaceRoot: string;
  status: Extract<
    SandboxStatus,
    "starting" | "running" | "stopping" | "stopped" | "failed"
  >;
  url?: string;
  port?: number;
};

export interface PreviewProvider {
  start(input: {
    projectId: string;
    workspaceRoot: string;
  }): Promise<PreviewProcess>;
  stop(projectId: string): Promise<void>;
}

/**
 * Development-only execution adapter. Production must replace this with a
 * remote, resource-limited SandboxProvider before accepting untrusted code.
 */

// The preview child runs agent-written code (including vite.config.ts), so it
// must never inherit platform secrets such as model API keys.
const allowedChildEnvKeys = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
] as const;

export function controlledChildEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string> = { BROWSER: "none" };
  for (const key of allowedChildEnvKeys) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function terminateProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) {
    child.kill("SIGTERM");
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

export class LocalDevelopmentSandboxProvider implements PreviewProvider {
  readonly #processes = new Map<
    string,
    { process: ChildProcess; preview: PreviewProcess }
  >();

  async start(input: {
    projectId: string;
    workspaceRoot: string;
  }): Promise<PreviewProcess> {
    await this.stop(input.projectId);
    const port = await getAvailablePort();
    const sandboxId = `local-${input.projectId}`;
    if (process.env.ATOMS_PREVIEW_SKIP_INSTALL !== "true") {
      const installArgs = [
        "install",
        "--ignore-workspace",
        "--ignore-scripts",
        "--no-frozen-lockfile",
        ...(process.env.ATOMS_PREVIEW_OFFLINE === "true" ? ["--offline"] : []),
      ];
      await runCommand("pnpm", installArgs, input.workspaceRoot);
    }
    const child = spawn(
      "pnpm",
      ["run", "dev", "--host", "127.0.0.1", "--port", String(port)],
      {
        cwd: input.workspaceRoot,
        env: controlledChildEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );
    const preview: PreviewProcess = {
      sandboxId,
      projectId: input.projectId,
      workspaceRoot: input.workspaceRoot,
      status: "starting",
      port,
      url: `http://127.0.0.1:${port}`,
    };
    this.#processes.set(input.projectId, { process: child, preview });
    try {
      await waitForPreview(preview.url!);
      preview.status = "running";
      return { ...preview };
    } catch (error) {
      preview.status = "failed";
      terminateProcessTree(child);
      this.#processes.delete(input.projectId);
      const output = await collectOutput(child);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${output ? `: ${output}` : ""}`,
      );
    }
  }

  async stop(projectId: string): Promise<void> {
    const current = this.#processes.get(projectId);
    if (!current) return;
    current.preview.status = "stopping";
    terminateProcessTree(current.process);
    await once(current.process, "exit").catch(() => undefined);
    this.#processes.delete(projectId);
  }
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await once(server, "close").catch(() => undefined);
  if (!port) throw new Error("Could not allocate a preview port");
  return port;
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: controlledChildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Command failed (${code ?? "unknown"}): ${output.slice(-1000)}`,
          ),
        );
    });
  });
}

async function waitForPreview(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError = "Preview did not become ready";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `Preview returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(lastError);
}

async function collectOutput(child: ChildProcess): Promise<string> {
  const chunks: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  return chunks.join("").slice(-1000);
}
