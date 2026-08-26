import { z } from "zod";

const reservedSegments = new Set([".git", ".atoms", "node_modules"]);

export const workspacePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .transform((value) => value.replaceAll("\\", "/"))
  .superRefine((value, context) => {
    const segments = value.split("/");
    if (
      value.startsWith("/") ||
      /^[a-zA-Z]:\//.test(value) ||
      value.includes("\0")
    ) {
      context.addIssue({
        code: "custom",
        message: "Path must be a project-relative path",
      });
    }
    if (segments.some((segment) => segment === "" || segment === ".")) {
      context.addIssue({
        code: "custom",
        message: "Path must use a canonical project-relative form",
      });
    }
    if (segments.includes("..")) {
      context.addIssue({
        code: "custom",
        message: "Path must not escape the project",
      });
    }
    if (segments.some((segment) => reservedSegments.has(segment))) {
      context.addIssue({
        code: "custom",
        message: "Path targets a reserved workspace location",
      });
    }
    if (
      segments.some(
        (segment) =>
          segment === ".env" ||
          (segment.startsWith(".env.") && segment !== ".env.example"),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Environment secret files are not accessible",
      });
    }
  });

export const fileEntrySchema = z.object({
  path: workspacePathSchema,
  kind: z.enum(["file", "directory"]),
  size: z.number().int().nonnegative().optional(),
});

export const fileContentSchema = z.object({
  path: workspacePathSchema,
  content: z.string(),
  contentHash: z.string().min(1),
});

export const fileMutationResultSchema = z.object({
  path: workspacePathSchema,
  contentHash: z.string().min(1).optional(),
  changed: z.boolean(),
});

export const fileSearchMatchSchema = z.object({
  path: workspacePathSchema,
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  snippet: z.string().max(500),
});

export type FileEntry = z.infer<typeof fileEntrySchema>;
export type FileContent = z.infer<typeof fileContentSchema>;
export type FileMutationResult = z.infer<typeof fileMutationResultSchema>;
export type FileSearchMatch = z.infer<typeof fileSearchMatchSchema>;
