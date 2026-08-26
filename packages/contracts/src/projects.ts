import { z } from "zod";
import { agentRunStatusSchema } from "./run-state.js";

export const projectStatusSchema = z.enum(["ready", "archived"]);

export const projectSchema = z.object({
  id: z.uuid(),
  userId: z.string().min(1),
  name: z.string().min(1).max(80),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  templateId: z.string().min(1),
  defaultBranch: z.string().min(1),
  currentCommit: z.string().regex(/^[0-9a-f]{40}$/i),
  status: projectStatusSchema,
  chatId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const createProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const projectVersionSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  commitHash: z.string().regex(/^[0-9a-f]{40}$/i),
  parentCommitHash: z
    .string()
    .regex(/^[0-9a-f]{40}$/i)
    .nullable(),
  message: z.string().min(1).max(200),
  runId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export const restoreProjectInputSchema = z.object({
  commitHash: z.string().regex(/^[0-9a-f]{7,40}$/i),
});

export const projectPreviewStatusSchema = z.enum([
  "starting",
  "running",
  "stopped",
  "failed",
]);

export const projectPreviewSchema = z.object({
  projectId: z.uuid(),
  status: projectPreviewStatusSchema,
  url: z.url().nullable(),
  port: z.number().int().positive().nullable(),
  errorMessage: z.string().min(1).nullable(),
  updatedAt: z.iso.datetime(),
});

export const chatMessageRoleSchema = z.enum(["user", "assistant", "system"]);

export const chatMessageSchema = z.object({
  id: z.uuid(),
  chatId: z.uuid(),
  role: chatMessageRoleSchema,
  content: z.string().min(1),
  sourceCommit: z
    .string()
    .regex(/^[0-9a-f]{40}$/i)
    .nullable(),
  resultCommit: z
    .string()
    .regex(/^[0-9a-f]{40}$/i)
    .nullable(),
  model: z.string().min(1).nullable(),
  runId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export const agentRunSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  chatId: z.uuid(),
  userMessageId: z.uuid(),
  status: agentRunStatusSchema,
  idempotencyKey: z.string().min(1),
  baseCommit: z.string().regex(/^[0-9a-f]{40}$/i),
  resultCommit: z
    .string()
    .regex(/^[0-9a-f]{40}$/i)
    .nullable(),
  model: z.string().min(1).nullable(),
  errorCode: z.string().min(1).nullable(),
  errorMessage: z.string().min(1).nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});

export const createRunInputSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
  idempotencyKey: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(200).optional(),
});

export const toolCallStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);

export const toolCallSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  sequence: z.number().int().nonnegative(),
  toolName: z.string().min(1),
  inputJson: z.string(),
  outputJson: z.string().nullable(),
  status: toolCallStatusSchema,
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});

export const projectReleaseStatusSchema = z.enum([
  "building",
  "ready",
  "failed",
]);

export const projectReleaseSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  commitHash: z.string().regex(/^[0-9a-f]{40}$/i),
  status: projectReleaseStatusSchema,
  errorMessage: z.string().min(1).nullable(),
  createdAt: z.iso.datetime(),
});

export const projectPublicationSchema = z.object({
  projectId: z.uuid(),
  currentReleaseId: z.uuid().nullable(),
  updatedAt: z.iso.datetime(),
});

export type Project = z.infer<typeof projectSchema>;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type ProjectVersion = z.infer<typeof projectVersionSchema>;
export type ProjectPreview = z.infer<typeof projectPreviewSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type CreateRunInput = z.infer<typeof createRunInputSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ProjectReleaseStatus = z.infer<typeof projectReleaseStatusSchema>;
export type ProjectRelease = z.infer<typeof projectReleaseSchema>;
export type ProjectPublication = z.infer<typeof projectPublicationSchema>;
