import { describe, expect, it } from "vitest";
import { FakeSandboxProvider } from "./index.js";

describe("FakeSandboxProvider", () => {
  it("follows the declared lifecycle", async () => {
    const provider = new FakeSandboxProvider();
    const sandbox = await provider.create();

    await provider.transition(sandbox.id, "syncing");
    await provider.transition(sandbox.id, "installing");
    await provider.transition(sandbox.id, "starting");
    const running = await provider.transition(sandbox.id, "running");

    expect(running.status).toBe("running");
  });

  it("rejects skipped lifecycle states", async () => {
    const provider = new FakeSandboxProvider();
    const sandbox = await provider.create();

    await expect(provider.transition(sandbox.id, "running")).rejects.toThrow(
      "Invalid sandbox transition",
    );
  });

  it("does not expose mutable lifecycle state", async () => {
    const provider = new FakeSandboxProvider();
    const created = await provider.create();

    created.status = "running";

    expect((await provider.get(created.id)).status).toBe("provisioning");
    await expect(provider.transition(created.id, "running")).rejects.toThrow(
      "Invalid sandbox transition",
    );
  });
});
