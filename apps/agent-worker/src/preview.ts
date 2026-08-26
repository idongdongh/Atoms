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
 *
 * Starts for the same project are serialized through a queue: concurrent
 * callers (an agent run finishing while reconciliation wakes the same
 * preview) would otherwise race stop-then-start and the slower loser could
 * overwrite the store with a stale failed/running row. The returned promise
 * never rejects — callers fire-and-forget it.
 */
const startQueues = new Map<string, Promise<void>>();

export function isProjectPreviewStarting(projectId: string): boolean {
  return startQueues.has(projectId);
}

export function startProjectPreview(
  input: StartProjectPreviewInput,
): Promise<void> {
  const previous = startQueues.get(input.projectId) ?? Promise.resolve();
  const chained = previous
    .then(() => startProjectPreviewExclusive(input))
    .catch((error: unknown) => {
      // Only store writes can reach here; provider failures are already
      // mirrored as a failed preview row. Swallow so fire-and-forget
      // callers never trip an unhandled rejection.
      console.error("Preview start failed", error);
    });
  startQueues.set(input.projectId, chained);
  void chained.finally(() => {
    if (startQueues.get(input.projectId) === chained) {
      startQueues.delete(input.projectId);
    }
  });
  return chained;
}

async function startProjectPreviewExclusive(
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
  // Dev servers whose project row vanished (deleted apps) would otherwise
  // leak: the idle reaper only ever sees rows that still exist.
  for (const projectId of input.previewProvider.listProjectIds()) {
    if (!input.store.projectExists(projectId)) {
      await input.previewProvider.stop(projectId);
    }
  }
  const idleBefore = new Date(Date.now() - input.idleMs).toISOString();
  const previews = input.store.listProjectPreviewsForReconcile(idleBefore);
  for (const record of previews) {
    if (record.wake_requested_at) {
      input.store.clearProjectPreviewWake(record.project_id);
      // Enqueue without awaiting: a dev-server boot (install + vite) can
      // take a minute or more, and blocking this loop would also delay the
      // worker from claiming queued agent runs.
      if (!isProjectPreviewStarting(record.project_id)) {
        void startProjectPreview({
          store: input.store,
          previewProvider: input.previewProvider,
          projectId: record.project_id,
          workspaceRoot: path.join(input.workspaceRoot, record.project_id),
        });
      }
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
