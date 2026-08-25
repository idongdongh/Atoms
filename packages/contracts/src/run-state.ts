import { z } from "zod";

export const agentRunStatusSchema = z.enum([
  "queued",
  "preparing",
  "running",
  "waiting_approval",
  "validating",
  "committing",
  "succeeded",
  "failed",
  "cancelled",
]);

export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

const transitions: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> =
  {
    queued: ["preparing", "cancelled", "failed"],
    preparing: ["running", "cancelled", "failed"],
    running: ["waiting_approval", "validating", "cancelled", "failed"],
    waiting_approval: ["running", "cancelled", "failed"],
    validating: ["running", "committing", "cancelled", "failed"],
    committing: ["succeeded", "failed"],
    succeeded: [],
    failed: [],
    cancelled: [],
  };

export function canTransitionAgentRun(
  from: AgentRunStatus,
  to: AgentRunStatus,
): boolean {
  return transitions[from].includes(to);
}
