import { createHash } from "node:crypto";
import type {
  FileContent,
  FileEntry,
  FileMutationResult,
} from "@atoms/contracts";
import { workspacePathSchema } from "@atoms/contracts";

export { LocalGitWorkspace } from "./local-git-workspace.js";
export { createProjectWorkspace } from "./project-workspace.js";
export { WorkspaceWriteLock } from "./write-lock.js";

export interface Workspace {
  listFiles(): Promise<FileEntry[]>;
  readFile(path: string): Promise<FileContent>;
  writeFile(path: string, content: string): Promise<FileMutationResult>;
  applyPatch(input: ApplyPatchInput): Promise<FileMutationResult>;
  deleteFile(path: string): Promise<FileMutationResult>;
  getDiff(): Promise<string>;
  commit(message: string): Promise<string>;
  restore(commitHash: string, message: string): Promise<string>;
}

export type ApplyPatchInput = {
  path: string;
  expectedHash: string;
  search: string;
  replacement: string;
};

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export class FakeWorkspace implements Workspace {
  readonly #files = new Map<string, string>();

  constructor(initialFiles: Readonly<Record<string, string>> = {}) {
    for (const [path, content] of Object.entries(initialFiles)) {
      this.#files.set(workspacePathSchema.parse(path), content);
    }
  }

  async listFiles(): Promise<FileEntry[]> {
    return [...this.#files.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, content]) => ({
        path,
        kind: "file" as const,
        size: Buffer.byteLength(content),
      }));
  }

  async readFile(path: string): Promise<FileContent> {
    const safePath = workspacePathSchema.parse(path);
    const content = this.#files.get(safePath);
    if (content === undefined) {
      throw new Error(`File not found: ${safePath}`);
    }
    return { path: safePath, content, contentHash: hash(content) };
  }

  async writeFile(path: string, content: string): Promise<FileMutationResult> {
    const safePath = workspacePathSchema.parse(path);
    const changed = this.#files.get(safePath) !== content;
    this.#files.set(safePath, content);
    return { path: safePath, contentHash: hash(content), changed };
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

  async deleteFile(path: string): Promise<FileMutationResult> {
    const safePath = workspacePathSchema.parse(path);
    return { path: safePath, changed: this.#files.delete(safePath) };
  }

  async getDiff(): Promise<string> {
    throw new Error("FakeWorkspace does not implement Git diff");
  }

  async commit(): Promise<string> {
    throw new Error("FakeWorkspace does not implement Git commits");
  }

  async restore(): Promise<string> {
    throw new Error("FakeWorkspace does not implement Git restore");
  }
}
