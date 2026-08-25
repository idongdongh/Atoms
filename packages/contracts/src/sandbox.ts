import { z } from "zod";

export const sandboxStatusSchema = z.enum([
  "absent",
  "provisioning",
  "syncing",
  "installing",
  "starting",
  "running",
  "stopping",
  "stopped",
  "failed",
]);

export type SandboxStatus = z.infer<typeof sandboxStatusSchema>;

export const previewUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    context.addIssue({
      code: "custom",
      message: "Preview URL must use HTTP or HTTPS",
    });
  }
  if (url.username || url.password) {
    context.addIssue({
      code: "custom",
      message: "Preview URL must not contain credentials",
    });
  }
});

export const sandboxInfoSchema = z.object({
  id: z.string().min(1),
  status: sandboxStatusSchema,
  previewUrl: previewUrlSchema.optional(),
  previewPort: z.number().int().positive().optional(),
});

export type SandboxInfo = z.infer<typeof sandboxInfoSchema>;

const transitions: Readonly<Record<SandboxStatus, readonly SandboxStatus[]>> = {
  absent: ["provisioning"],
  provisioning: ["syncing", "failed"],
  syncing: ["installing", "failed"],
  installing: ["starting", "failed"],
  starting: ["running", "failed"],
  running: ["syncing", "stopping", "failed"],
  stopping: ["stopped", "failed"],
  stopped: ["provisioning"],
  failed: ["provisioning", "stopping"],
};

export function canTransitionSandbox(
  from: SandboxStatus,
  to: SandboxStatus,
): boolean {
  return transitions[from].includes(to);
}
