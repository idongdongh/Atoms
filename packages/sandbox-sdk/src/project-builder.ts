import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { controlledChildEnv } from "./local-development-provider.js";

export interface BuildProvider {
  build(input: {
    projectId: string;
    workspaceRoot: string;
  }): Promise<{ distPath: string }>;
}

const installTimeoutMs = 180_000;
const buildTimeoutMs = 120_000;

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function runControlledCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: controlledChildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(
        new Error(
          `Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`,
        ),
      );
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Command failed (${code ?? "unknown"}): ${command} ${args.join(" ")}\n${output.slice(-1000)}`,
          ),
        );
    });
  });
}

/**
 * Runs the project's own `pnpm run build` script as a controlled child
 * process. The command allowlist is the template's fixed script set; no
 * arbitrary shell is exposed to the agent or the browser.
 */
export class LocalViteBuildProvider implements BuildProvider {
  async build(input: {
    projectId: string;
    workspaceRoot: string;
  }): Promise<{ distPath: string }> {
    if (!(await pathExists(path.join(input.workspaceRoot, "node_modules")))) {
      await runControlledCommand(
        "pnpm",
        [
          "install",
          "--ignore-workspace",
          "--ignore-scripts",
          "--no-frozen-lockfile",
          ...(process.env.ATOMS_PREVIEW_OFFLINE === "true"
            ? ["--offline"]
            : []),
        ],
        input.workspaceRoot,
        installTimeoutMs,
      );
    }
    await runControlledCommand(
      "pnpm",
      ["run", "build", `--base=/published/${input.projectId}/`],
      input.workspaceRoot,
      buildTimeoutMs,
    );
    const distPath = path.join(input.workspaceRoot, "dist");
    if (!(await pathExists(distPath))) {
      throw new Error("Build did not produce a dist directory");
    }
    return { distPath };
  }
}
