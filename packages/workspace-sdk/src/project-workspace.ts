import { cp, lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { runGit } from "./git.js";

const forbiddenTemplateEntries = new Set([".git", ".atoms", "node_modules"]);

async function validateTemplate(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      forbiddenTemplateEntries.has(entry.name) ||
      entry.name === ".env" ||
      (entry.name.startsWith(".env.") && entry.name !== ".env.example")
    ) {
      throw new Error(`Template contains reserved entry: ${entry.name}`);
    }
    const entryPath = path.join(directory, entry.name);
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) {
      throw new Error(`Template symbolic links are not allowed: ${entry.name}`);
    }
    if (stats.isDirectory()) {
      await validateTemplate(entryPath);
    } else if (!stats.isFile()) {
      throw new Error(`Template contains an unsupported entry: ${entry.name}`);
    }
  }
}

export async function createProjectWorkspace(input: {
  workspaceRoot: string;
  templateRoot: string;
  initialCommitMessage?: string;
}): Promise<{ workspaceRoot: string; initialCommitHash: string }> {
  const existing = await readdir(input.workspaceRoot).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  if (existing.length > 0) {
    throw new Error("Workspace root must be empty");
  }
  await mkdir(input.workspaceRoot, { recursive: true });
  const templateRoot = await realpath(input.templateRoot);
  await validateTemplate(templateRoot);
  for (const entry of await readdir(templateRoot)) {
    await cp(
      path.join(templateRoot, entry),
      path.join(input.workspaceRoot, entry),
      {
        recursive: true,
        errorOnExist: true,
      },
    );
  }

  await runGit(input.workspaceRoot, ["init", "--initial-branch", "main"]);
  await runGit(input.workspaceRoot, ["config", "user.name", "Atoms Agent"]);
  await runGit(input.workspaceRoot, [
    "config",
    "user.email",
    "agent@atoms.local",
  ]);
  await runGit(input.workspaceRoot, ["add", "--all", "--", "."]);
  await runGit(input.workspaceRoot, [
    "commit",
    "--message",
    input.initialCommitMessage ?? "Initialize project",
  ]);
  return {
    workspaceRoot: await realpath(input.workspaceRoot),
    initialCommitHash: await runGit(input.workspaceRoot, ["rev-parse", "HEAD"]),
  };
}
