import { createHash, randomUUID } from "node:crypto";
import { open, mkdir, readFile, realpath, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const staleAfterMs = 30 * 60 * 1000;

type LockMetadata = {
  token: string;
  runId: string;
  processId: number;
  hostname: string;
  acquiredAt: string;
};

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function isStale(lockPath: string): Promise<boolean> {
  try {
    const metadata = JSON.parse(
      await readFile(lockPath, "utf8"),
    ) as LockMetadata;
    const age = Date.now() - Date.parse(metadata.acquiredAt);
    if (!Number.isFinite(age) || age > staleAfterMs) return true;
    return (
      metadata.hostname === os.hostname() && !processIsAlive(metadata.processId)
    );
  } catch {
    return true;
  }
}

export class WorkspaceWriteLock {
  constructor(private readonly workspaceRoot: string) {}

  async runExclusive<T>(
    runId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!runId.trim()) {
      throw new Error("Run ID is required for a workspace lock");
    }
    const canonicalRoot = await realpath(this.workspaceRoot);
    const workspaceKey = createHash("sha256")
      .update(canonicalRoot)
      .digest("hex");
    const stateDirectory = path.join(
      path.dirname(canonicalRoot),
      ".atoms-locks",
    );
    const lockPath = path.join(stateDirectory, `${workspaceKey}.lock`);
    await mkdir(stateDirectory, { recursive: true });

    let handle;
    const token = randomUUID();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        handle = await open(lockPath, "wx");
        await handle.writeFile(
          JSON.stringify({
            token,
            runId,
            processId: process.pid,
            hostname: os.hostname(),
            acquiredAt: new Date().toISOString(),
          } satisfies LockMetadata),
        );
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (attempt === 0 && (await isStale(lockPath))) {
          try {
            await rename(lockPath, `${lockPath}.stale-${randomUUID()}`);
            continue;
          } catch (renameError) {
            if ((renameError as NodeJS.ErrnoException).code === "ENOENT")
              continue;
          }
        }
        throw new Error("Workspace is already locked by another run");
      }
    }
    if (!handle) throw new Error("Failed to acquire workspace lock");

    try {
      return await operation();
    } finally {
      await handle.close();
      try {
        const metadata = JSON.parse(
          await readFile(lockPath, "utf8"),
        ) as LockMetadata;
        if (metadata.token === token) await rm(lockPath, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}
