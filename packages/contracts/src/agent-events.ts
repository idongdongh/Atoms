import { z } from "zod";
import { previewUrlSchema } from "./sandbox.js";

const baseEventShape = {
  runId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  timestamp: z.iso.datetime(),
};

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ ...baseEventShape, type: z.literal("run.started") }),
  z.object({
    ...baseEventShape,
    type: z.literal("message.delta"),
    delta: z.string(),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("tool.started"),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("tool.progress"),
    toolCallId: z.string().min(1),
    message: z.string(),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("tool.completed"),
    toolCallId: z.string().min(1),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("tool.failed"),
    toolCallId: z.string().min(1),
    error: z.string().min(1),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("files.changed"),
    paths: z.array(z.string().min(1)),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("validation.started"),
    command: z.enum(["typecheck", "test", "build"]),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("validation.completed"),
    command: z.enum(["typecheck", "test", "build"]),
    success: z.boolean(),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("build.log"),
    stream: z.enum(["stdout", "stderr"]),
    message: z.string(),
  }),
  z.object({ ...baseEventShape, type: z.literal("preview.starting") }),
  z.object({
    ...baseEventShape,
    type: z.literal("preview.ready"),
    url: previewUrlSchema,
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("preview.failed"),
    error: z.string().min(1),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("run.completed"),
    commitHash: z.string().min(1),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("run.failed"),
    errorCode: z.string().min(1),
    message: z.string().min(1),
  }),
  z.object({ ...baseEventShape, type: z.literal("run.cancelled") }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;
