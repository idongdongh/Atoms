import { describe, expect, it } from "vitest";
import { getWorkerIdentity } from "./index.js";

describe("getWorkerIdentity", () => {
  it("reports the worker as ready", () => {
    expect(getWorkerIdentity()).toEqual({
      service: "agent-worker",
      status: "ready",
    });
  });
});
