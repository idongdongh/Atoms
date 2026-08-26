import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  FileContent,
  FileEntry,
  FileSearchMatch,
  FileMutationResult,
} from "@atoms/contracts";
import type { ApplyPatchInput, Workspace } from "./index.js";
import { runGit } from "./git.js";
import { resolveSafeWorkspacePath } from "./path-safety.js";

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const maxFileSize = 1024 * 1024;
const maxListedFiles = 10_000;
const maxListDepth = 20;
const ignoredDirectories = new Set([
  ".git",
  ".atoms",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
]);

function isSensitiveFile(name: string): boolean {
  return (
    name === ".env" || (name.startsWith(".env.") && name !== ".env.example")
  );
}

export class LocalGitWorkspace implements Workspace {
  readonly #pendingPaths = new Set<string>();

  private constructor(readonly root: string) {}

  static async open(root: string): Promise<LocalGitWorkspace> {
    const safeRoot = await realpath(root);
    const repositoryMetadata = await lstat(path.join(safeRoot, ".git"));
    if (
      !repositoryMetadata.isDirectory() ||
      repositoryMetadata.isSymbolicLink()
    ) {
      throw new Error("Workspace must contain a local Git repository");
    }
    await runGit(safeRoot, ["rev-parse", "--is-inside-work-tree"]);
    return new LocalGitWorkspace(safeRoot);
  }

  async listFiles(): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    const visit = async (directory: string, prefix = "", depth = 0) => {
      if (depth > maxListDepth) {
        throw new Error("Workspace file tree exceeds the maximum depth");
      }
      const children = await readdir(directory, { withFileTypes: true });
      for (const child of children.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (ignoredDirectories.has(child.name) || isSensitiveFile(child.name)) {
          continue;
        }
        if (child.isSymbolicLink()) {
          continue;
        }
        const relativePath = prefix ? `${prefix}/${child.name}` : child.name;
        const absolutePath = path.join(directory, child.name);
        if (child.isDirectory()) {
          entries.push({ path: relativePath, kind: "directory" });
          await visit(absolutePath, relativePath, depth + 1);
        } else if (child.isFile()) {
          const stats = await lstat(absolutePath);
          entries.push({ path: relativePath, kind: "file", size: stats.size });
        }
        if (entries.length > maxListedFiles) {
          throw new Error(
            "Workspace file tree exceeds the maximum entry count",
          );
        }
      }
    };
    await visit(this.root);
    return entries;
  }

  async readFile(unsafePath: string): Promise<FileContent> {
    const { relativePath, absolutePath } = await resolveSafeWorkspacePath(
      this.root,
      unsafePath,
    );
    const stats = await lstat(absolutePath);
    if (!stats.isFile()) {
      throw new Error(`Only regular files can be read: ${relativePath}`);
    }
    if (stats.size > maxFileSize) {
      throw new Error(
        `File exceeds the maximum readable size: ${relativePath}`,
      );
    }
    const content = await readFile(absolutePath, "utf8");
    return { path: relativePath, content, contentHash: hash(content) };
  }

  async searchFiles(query: string): Promise<FileSearchMatch[]> {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) throw new Error("Search query is required");
    const matches: FileSearchMatch[] = [];
    for (const entry of await this.listFiles()) {
      if (entry.kind !== "file") continue;
      try {
        const content = (await this.readFile(entry.path)).content;
        for (const [index, line] of content.split("\n").entries()) {
          const column = line.toLocaleLowerCase().indexOf(needle);
          if (column !== -1) {
            matches.push({
              path: entry.path,
              line: index + 1,
              column: column + 1,
              snippet: line.slice(0, 500),
            });
          }
        }
      } catch {
        // Binary and oversized files are intentionally skipped from text search.
      }
    }
    return matches;
  }

  async writeFile(
    unsafePath: string,
    content: string,
  ): Promise<FileMutationResult> {
    if (Buffer.byteLength(content, "utf8") > maxFileSize) {
      throw new Error("File exceeds the maximum writable size");
    }
    const { relativePath, absolutePath } = await resolveSafeWorkspacePath(
      this.root,
      unsafePath,
      { createParent: true },
    );
    let previous: string | undefined;
    let previousMode: number | undefined;
    try {
      const stats = await lstat(absolutePath);
      if (!stats.isFile()) {
        throw new Error(`Only regular files can be written: ${relativePath}`);
      }
      previousMode = stats.mode;
      previous = await readFile(absolutePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    if (previous === content) {
      return { path: relativePath, contentHash: hash(content), changed: false };
    }

    const temporaryPath = path.join(
      path.dirname(absolutePath),
      `.atoms-${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
      if (previousMode !== undefined) {
        await chmod(temporaryPath, previousMode);
      }
      await rename(temporaryPath, absolutePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    this.#pendingPaths.add(relativePath);
    return { path: relativePath, contentHash: hash(content), changed: true };
  }

  async applyPatch(input: ApplyPatchInput): Promise<FileMutationResult> {
    const current = await this.readFile(input.path);
    if (current.contentHash !== input.expectedHash) {
      throw new Error(`File changed before patch: ${current.path}`);
    }
    const firstIndex = current.content.indexOf(input.search);
    if (firstIndex === -1) {
      throw new Error(`Patch search text was not found: ${current.path}`);
    }
    if (
      current.content.indexOf(
        input.search,
        firstIndex + input.search.length,
      ) !== -1
    ) {
      throw new Error(`Patch search text is not unique: ${current.path}`);
    }
    return this.writeFile(
      current.path,
      current.content.replace(input.search, input.replacement),
    );
  }

  async deleteFile(unsafePath: string): Promise<FileMutationResult> {
    const { relativePath, absolutePath } = await resolveSafeWorkspacePath(
      this.root,
      unsafePath,
    );
    try {
      const stats = await lstat(absolutePath);
      if (!stats.isFile()) {
        throw new Error(`Only regular files can be deleted: ${relativePath}`);
      }
      await rm(absolutePath);
      this.#pendingPaths.add(relativePath);
      return { path: relativePath, changed: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { path: relativePath, changed: false };
      }
      throw error;
    }
  }

  async getDiff(): Promise<string> {
    return runGit(this.root, ["diff", "--no-ext-diff", "--", "."]);
  }

  async discardChanges(): Promise<void> {
    const paths = [...this.#pendingPaths].sort();
    if (paths.length === 0) return;
    const trackedPaths: string[] = [];
    for (const relativePath of paths) {
      const tracked = await runGit(this.root, [
        "cat-file",
        "-e",
        `HEAD:${relativePath}`,
      ]).then(
        () => true,
        () => false,
      );
      if (tracked) {
        trackedPaths.push(relativePath);
      } else {
        const { absolutePath } = await resolveSafeWorkspacePath(
          this.root,
          relativePath,
        );
        await rm(absolutePath, { force: true });
      }
    }
    if (trackedPaths.length > 0) {
      await runGit(this.root, [
        "restore",
        "--staged",
        "--worktree",
        "--",
        ...trackedPaths,
      ]);
    }
    this.#pendingPaths.clear();
  }

  async commit(message: string): Promise<string> {
    if (!message.trim()) {
      throw new Error("Commit message is required");
    }
    if (this.#pendingPaths.size === 0) {
      throw new Error("Workspace has no managed changes to commit");
    }
    const alreadyStaged = await runGit(this.root, [
      "diff",
      "--cached",
      "--quiet",
    ]).then(
      () => false,
      () => true,
    );
    if (alreadyStaged) {
      throw new Error(
        "Workspace contains changes staged outside the managed API",
      );
    }
    const paths = [...this.#pendingPaths].sort();
    await runGit(this.root, ["add", "--all", "--", ...paths]);
    const staged = await runGit(this.root, [
      "diff",
      "--cached",
      "--quiet",
    ]).then(
      () => false,
      () => true,
    );
    if (!staged) {
      throw new Error("Workspace has no changes to commit");
    }
    await runGit(this.root, ["commit", "--message", message]);
    this.#pendingPaths.clear();
    return runGit(this.root, ["rev-parse", "HEAD"]);
  }

  async restore(commitHash: string, message: string): Promise<string> {
    if (!/^[0-9a-f]{7,64}$/i.test(commitHash)) {
      throw new Error("Invalid commit hash");
    }
    await runGit(this.root, ["cat-file", "-e", `${commitHash}^{commit}`]);
    const status = await runGit(this.root, [
      "status",
      "--porcelain",
      "--untracked-files=all",
    ]);
    if (status) {
      throw new Error("Workspace must be clean before restoring a version");
    }
    await runGit(this.root, [
      "restore",
      "--source",
      commitHash,
      "--staged",
      "--worktree",
      "--",
      ".",
    ]);
    const staged = await runGit(this.root, [
      "diff",
      "--cached",
      "--quiet",
    ]).then(
      () => false,
      () => true,
    );
    if (!staged) {
      throw new Error("Restore target is already the current version");
    }
    await runGit(this.root, ["commit", "--message", message]);
    this.#pendingPaths.clear();
    return runGit(this.root, ["rev-parse", "HEAD"]);
  }
}
