import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalGitWorkspace } from "./local-git-workspace.js";
import { createProjectWorkspace } from "./project-workspace.js";
import { WorkspaceWriteLock } from "./write-lock.js";
import { runGit } from "./git.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "atoms-workspace-test-"));
  const templateRoot = path.join(root, "template");
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(path.join(templateRoot, "src"), { recursive: true });
  await writeFile(path.join(templateRoot, ".gitignore"), ".atoms/\n");
  await writeFile(
    path.join(templateRoot, "src", "main.ts"),
    "export const value = 1;\n",
  );
  const created = await createProjectWorkspace({ workspaceRoot, templateRoot });
  return {
    root,
    workspaceRoot,
    created,
    workspace: await LocalGitWorkspace.open(workspaceRoot),
  };
}

describe("LocalGitWorkspace", () => {
  it("creates versions and restores an earlier version without deleting history", async () => {
    const { created, workspace } = await fixture();
    await workspace.writeFile("src/main.ts", "export const value = 2;\n");
    expect(await workspace.getDiff()).toContain("value = 2");
    const secondCommit = await workspace.commit("Update value");
    expect(secondCommit).not.toBe(created.initialCommitHash);

    await workspace.writeFile("src/main.ts", "export const value = 3;\n");
    await workspace.commit("Update value again");
    const restoreCommit = await workspace.restore(
      created.initialCommitHash,
      "Restore initial version",
    );

    expect(restoreCommit).not.toBe(created.initialCommitHash);
    expect((await workspace.readFile("src/main.ts")).content).toContain(
      "value = 1",
    );
  });

  it("rejects symbolic links that leave the workspace", async () => {
    const { root, workspaceRoot, workspace } = await fixture();
    const outside = path.join(root, "outside.txt");
    await writeFile(outside, "secret");
    await symlink(outside, path.join(workspaceRoot, "escape.txt"));

    await expect(workspace.readFile("escape.txt")).rejects.toThrow(
      "Symbolic links are not allowed",
    );
    expect(await readFile(outside, "utf8")).toBe("secret");
  });

  it("serializes write runs with an exclusive lock", async () => {
    const { workspaceRoot } = await fixture();
    const lock = new WorkspaceWriteLock(workspaceRoot);
    let releaseFirst!: () => void;
    const wait = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const first = lock.runExclusive("run-1", async () => {
      firstStarted();
      await wait;
      return "done";
    });
    await started;

    await expect(lock.runExclusive("run-2", async () => "no")).rejects.toThrow(
      "already locked",
    );
    releaseFirst();
    await expect(first).resolves.toBe("done");
    await expect(access(path.join(workspaceRoot, ".atoms"))).rejects.toThrow();
  });

  it("does not expose repository metadata, secrets, or dependencies", async () => {
    const { workspaceRoot, workspace } = await fixture();
    await writeFile(path.join(workspaceRoot, ".env"), "TOKEN=secret\n");
    await mkdir(path.join(workspaceRoot, "node_modules", "pkg"), {
      recursive: true,
    });
    await writeFile(
      path.join(workspaceRoot, "node_modules", "pkg", "index.js"),
      "x",
    );

    await expect(workspace.readFile(".git/HEAD")).rejects.toThrow();
    await expect(workspace.readFile(".env")).rejects.toThrow();
    expect(
      (await workspace.listFiles()).map((entry) => entry.path),
    ).not.toEqual(expect.arrayContaining([".env", "node_modules"]));
  });

  it("searches text without traversing reserved files", async () => {
    const { workspaceRoot, workspace } = await fixture();
    await writeFile(path.join(workspaceRoot, ".env"), "TOKEN=secret\n");
    const matches = await workspace.searchFiles("value");
    expect(matches).toMatchObject([
      { path: "src/main.ts", line: 1, column: 14 },
    ]);
    expect(await workspace.searchFiles("secret")).toEqual([]);
  });

  it("discards managed changes after a failed run", async () => {
    const { workspace } = await fixture();
    await workspace.writeFile(
      "src/generated.ts",
      "export const broken = true;\n",
    );
    await workspace.writeFile("src/main.ts", "export const value = 2;\n");
    await workspace.discardChanges();
    await expect(workspace.readFile("src/generated.ts")).rejects.toThrow();
    await expect(workspace.readFile("src/main.ts")).resolves.toMatchObject({
      content: "export const value = 1;\n",
    });
  });

  it("commits only mutations made through the workspace API", async () => {
    const { workspaceRoot, workspace } = await fixture();
    await writeFile(path.join(workspaceRoot, ".env"), "TOKEN=secret\n");
    await writeFile(path.join(workspaceRoot, "unrelated.txt"), "outside api\n");
    await workspace.writeFile("src/main.ts", "export const value = 2;\n");

    await workspace.commit("Managed update");

    const committed = await runGit(workspaceRoot, [
      "ls-tree",
      "-r",
      "--name-only",
      "HEAD",
    ]);
    expect(committed).not.toContain(".env");
    expect(committed).not.toContain("unrelated.txt");
    expect(await readFile(path.join(workspaceRoot, ".env"), "utf8")).toContain(
      "secret",
    );
  });

  it("refuses to restore over modifications to tracked files", async () => {
    const { created, workspaceRoot, workspace } = await fixture();
    await workspace.writeFile("src/main.ts", "export const value = 2;\n");
    await workspace.commit("Update value");
    await workspace.writeFile("src/main.ts", "export const value = 3;\n");

    await expect(
      workspace.restore(created.initialCommitHash, "Restore initial version"),
    ).rejects.toThrow("must be clean");
  });

  it("restores despite untracked files like node_modules", async () => {
    const { created, workspaceRoot, workspace } = await fixture();
    await workspace.writeFile("src/main.ts", "export const value = 2;\n");
    await workspace.commit("Update value");
    await writeFile(path.join(workspaceRoot, "unrelated.txt"), "keep me\n");
    await mkdir(path.join(workspaceRoot, "node_modules/pkg"), {
      recursive: true,
    });
    await writeFile(
      path.join(workspaceRoot, "node_modules/pkg/index.js"),
      "// installed\n",
    );

    await workspace.restore(
      created.initialCommitHash,
      "Restore initial version",
    );
    expect(
      await readFile(path.join(workspaceRoot, "unrelated.txt"), "utf8"),
    ).toBe("keep me\n");
    expect(
      await readFile(path.join(workspaceRoot, "src/main.ts"), "utf8"),
    ).toContain("value = 1");
  });
});

describe("createProjectWorkspace", () => {
  it("rejects template Git hooks without executing them", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "atoms-template-attack-"),
    );
    const templateRoot = path.join(root, "template");
    const workspaceRoot = path.join(root, "workspace");
    const marker = path.join(root, "hook-executed");
    await mkdir(path.join(templateRoot, ".git", "hooks"), { recursive: true });
    await writeFile(
      path.join(templateRoot, ".git", "hooks", "pre-commit"),
      `#!/bin/sh\ntouch '${marker}'\n`,
      { mode: 0o755 },
    );

    await expect(
      createProjectWorkspace({ workspaceRoot, templateRoot }),
    ).rejects.toThrow("reserved entry");
    await expect(access(marker)).rejects.toThrow();
  });
});
