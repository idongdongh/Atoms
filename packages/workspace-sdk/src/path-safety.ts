import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { workspacePathSchema } from "@atoms/contracts";

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function resolveSafeWorkspacePath(
  workspaceRoot: string,
  unsafeRelativePath: string,
  options: { createParent?: boolean } = {},
): Promise<{ root: string; relativePath: string; absolutePath: string }> {
  const relativePath = workspacePathSchema.parse(
    unsafeRelativePath.replaceAll("\\", "/"),
  );
  const root = await realpath(workspaceRoot);
  const absolutePath = path.resolve(root, relativePath);
  const rootPrefix = `${root}${path.sep}`;

  if (!absolutePath.startsWith(rootPrefix)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }

  const segments = relativePath.split("/");
  let cursor = root;
  for (const segment of segments.slice(0, -1)) {
    cursor = path.join(cursor, segment);
    if (!(await exists(cursor))) {
      if (options.createParent) {
        await mkdir(cursor);
      } else {
        break;
      }
    }
    const stats = await lstat(cursor);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Symbolic links are not allowed in workspace paths: ${relativePath}`,
      );
    }
    if (!stats.isDirectory()) {
      throw new Error(`Workspace parent is not a directory: ${relativePath}`);
    }
  }

  if (await exists(absolutePath)) {
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Symbolic links are not allowed in workspace paths: ${relativePath}`,
      );
    }
  }

  return { root, relativePath, absolutePath };
}
