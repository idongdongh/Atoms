import { describe, expect, it } from "vitest";
import {
  agentEventSchema,
  canTransitionAgentRun,
  canTransitionSandbox,
  createProjectInputSchema,
  projectSchema,
  sandboxInfoSchema,
  workspacePathSchema,
} from "./index.js";

describe("contracts", () => {
  it("accepts a resumable agent event", () => {
    const event = agentEventSchema.parse({
      type: "message.delta",
      runId: "run-1",
      sequence: 4,
      timestamp: "2026-08-25T10:00:00.000Z",
      delta: "Building",
    });

    expect(event.sequence).toBe(4);
  });

  it.each([
    "/etc/passwd",
    "C:\\Windows\\system.ini",
    "../secret",
    "src/../../secret",
    ".git/HEAD",
    "src/.atoms/write.lock",
    "node_modules/pkg/index.js",
    ".env",
    "config/.env.production",
    "src//main.ts",
    "./src/main.ts",
  ])("rejects unsafe workspace path %s", (path) => {
    expect(workspacePathSchema.safeParse(path).success).toBe(false);
  });

  it("allows a documented environment example", () => {
    expect(workspacePathSchema.parse(".env.example")).toBe(".env.example");
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://a:b@example.com",
  ])("rejects unsafe preview URL %s", (previewUrl) => {
    expect(
      sandboxInfoSchema.safeParse({
        id: "sandbox-1",
        status: "running",
        previewUrl,
      }).success,
    ).toBe(false);
  });

  it("accepts an HTTP preview URL", () => {
    expect(
      sandboxInfoSchema.safeParse({
        id: "sandbox-1",
        status: "running",
        previewUrl: "https://preview.example.test/session",
      }).success,
    ).toBe(true);
  });

  it("allows only declared state transitions", () => {
    expect(canTransitionAgentRun("queued", "preparing")).toBe(true);
    expect(canTransitionAgentRun("succeeded", "running")).toBe(false);
    expect(canTransitionSandbox("starting", "running")).toBe(true);
    expect(canTransitionSandbox("running", "installing")).toBe(false);
  });

  it("validates project API payloads", () => {
    expect(createProjectInputSchema.parse({ name: "  Task board  " })).toEqual({
      name: "Task board",
    });
    expect(
      projectSchema.safeParse({
        id: "bad-id",
        name: "Task board",
      }).success,
    ).toBe(false);
  });
});
