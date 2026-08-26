import path from "node:path";
import type { ControlPlaneStore } from "@atoms/db";
import type { PreviewProvider } from "@atoms/sandbox-sdk";

export type PreviewEventInput =
  | { type: "preview.starting" }
  | { type: "preview.ready"; url: string }
  | { type: "preview.failed"; error: string };

export type StartProjectPreviewInput = {
  store: ControlPlaneStore;
  previewProvider: PreviewProvider;
  projectId: string;
  workspaceRoot: string;
  emit?: ((event: PreviewEventInput) => void) | undefined;
};

/**
 * Starts (or restarts) the development preview for a project and mirrors the
 * outcome into the control-plane store. Transient dev-server failures (port
 * races, one-off install hiccups) are common, so exactly one automatic retry
 * is attempted before the preview is marked failed.
 */
export async function startProjectPreview(
  input: StartProjectPreviewInput,
): Promise<void> {
  const { store, previewProvider, projectId, workspaceRoot, emit } = input;
  emit?.({ type: "preview.starting" });
  store.setProjectPreview({
    projectId,
    status: "starting",
    url: null,
    port: null,
    errorMessage: null,
  });
  let preview;
  try {
    preview = await previewProvider.start({ projectId, workspaceRoot });
  } catch {
    try {
      preview = await previewProvider.start({ projectId, workspaceRoot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.setProjectPreview({
        projectId,
        status: "failed",
        url: null,
        port: null,
        errorMessage: message,
      });
      emit?.({ type: "preview.failed", error: message });
      return;
    }
  }
  store.setProjectPreview({
    projectId,
    status: "running",
    url: preview.url ?? null,
    port: preview.port ?? null,
    errorMessage: null,
  });
  if (preview.url) emit?.({ type: "preview.ready", url: preview.url });
}

/**
 * Single-pass preview reconciliation, invoked periodically by the worker:
 *
 * - Wakes previews whose wake flag was set by the API (user re-opened a
 *   sleeping project, or the proxy noticed the dev server died). Starting
 *   unconditionally is safe: the provider stops any existing process first,
 *   which also self-heals stale "running" rows after a worker restart.
 * - Stops previews that have been running but unvisited for longer than the
 *   idle window, freeing memory on capacity-constrained hosts. Projects with
 *   an in-flight agent run are skipped so generation is never disrupted.
 */
export async function reconcileProjectPreviews(input: {
  store: ControlPlaneStore;
  previewProvider: PreviewProvider;
  workspaceRoot: string;
  idleMs: number;
}): Promise<void> {
  const idleBefore = new Date(Date.now() - input.idleMs).toISOString();
  const previews = input.store.listProjectPreviewsForReconcile(idleBefore);
  for (const record of previews) {
    if (record.wake_requested_at) {
      input.store.clearProjectPreviewWake(record.project_id);
      await startProjectPreview({
        store: input.store,
        previewProvider: input.previewProvider,
        projectId: record.project_id,
        workspaceRoot: path.join(input.workspaceRoot, record.project_id),
      });
      continue;
    }
    if (input.store.hasActiveRun(record.project_id)) continue;
    await input.previewProvider.stop(record.project_id);
    input.store.setProjectPreview({
      projectId: record.project_id,
      status: "stopped",
      url: null,
      port: null,
      errorMessage: null,
    });
  }
}
