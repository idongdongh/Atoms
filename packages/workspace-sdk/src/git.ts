import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runGit(
  workspaceRoot: string,
  args: readonly string[],
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-c", `core.hooksPath=${os.devNull}`, ...args],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: os.devNull,
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  return stdout.trimEnd();
}
