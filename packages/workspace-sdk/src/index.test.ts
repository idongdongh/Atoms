import { describe, expect, it } from "vitest";
import { FakeWorkspace } from "./index.js";

describe("FakeWorkspace", () => {
  it("stores, lists, and deletes project-relative files", async () => {
    const workspace = new FakeWorkspace({ "src/main.ts": "first" });

    const result = await workspace.writeFile("src/main.ts", "second");

    expect(result.changed).toBe(true);
    expect((await workspace.readFile("src/main.ts")).content).toBe("second");
    expect(await workspace.listFiles()).toHaveLength(1);
    expect((await workspace.deleteFile("src/main.ts")).changed).toBe(true);
  });

  it("rejects paths outside the project", async () => {
    const workspace = new FakeWorkspace();
    await expect(workspace.writeFile("../secret", "nope")).rejects.toThrow();
  });
});
