import path from "node:path";
import { ControlPlaneStore } from "@atoms/db";
import { LocalDevelopmentSandboxProvider } from "@atoms/sandbox-sdk";
import { AgentRunner } from "./agent.js";
import { createConfiguredModel, type AgentModel } from "./model.js";
import { reconcileProjectPreviews } from "./preview.js";

export function getWorkerIdentity() {
  return {
    service: "agent-worker",
    status: "ready",
  } as const;
}

export async function processNextRun(input: {
  store: ControlPlaneStore;
  workspaceRoot: string;
  model: AgentModel;
  previewProvider?: import("@atoms/sandbox-sdk").PreviewProvider;
}): Promise<boolean> {
  const run = input.store.claimNextRun();
  if (!run) return false;
  const runnerOptions = {
    store: input.store,
    workspaceRoot: input.workspaceRoot,
    model: input.model,
    ...(input.previewProvider
      ? { previewProvider: input.previewProvider }
      : {}),
  };
  await new AgentRunner(runnerOptions).run(run);
  return true;
}

async function startWorker(): Promise<void> {
  const store = new ControlPlaneStore(
    process.env.ATOMS_DATABASE_PATH ??
      path.resolve(".atoms-data/control-plane.sqlite"),
  );
  const workspaceRoot = path.resolve(
    process.env.ATOMS_WORKSPACE_ROOT ?? ".atoms-data/workspaces",
  );
  let model: AgentModel;
  try {
    model = createConfiguredModel();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    model = {
      async complete() {
        throw new Error(reason);
      },
    };
  }
  const previewProvider =
    process.env.ATOMS_PREVIEW_PROVIDER === "local"
      ? new LocalDevelopmentSandboxProvider()
      : undefined;
  for (const interrupted of store.recoverInterruptedRuns()) {
    store.appendAgentEvent({
      runId: interrupted.id,
      type: "run.failed",
      errorCode: "worker_interrupted",
      message: "The worker stopped before the run completed",
    });
  }
  const pollMs = Number(process.env.ATOMS_WORKER_POLL_MS ?? 300);
  const previewIdleMs = Number(process.env.ATOMS_PREVIEW_IDLE_MS ?? 600_000);
  const reconcileIntervalMs = 2_000;
  let lastReconcileAt = 0;
  console.log(
    JSON.stringify({
      ...getWorkerIdentity(),
      model: process.env.ATOMS_MODEL_PROVIDER ?? "openai-compatible",
    }),
  );
  try {
    while (true) {
      const processInput = {
        store,
        workspaceRoot,
        model,
        ...(previewProvider ? { previewProvider } : {}),
      };
      const processed = await processNextRun(processInput);
      if (!processed) {
        // Between runs the worker also reconciles previews: stopping idle
        // dev servers and waking sleeping ones so 2C2G-class hosts are not
        // pinned by forgotten previews.
        if (
          previewProvider &&
          Date.now() - lastReconcileAt >= reconcileIntervalMs
        ) {
          lastReconcileAt = Date.now();
          await reconcileProjectPreviews({
            store,
            previewProvider,
            workspaceRoot,
            idleMs: previewIdleMs,
          }).catch((error: unknown) => {
            console.error("Preview reconcile failed", error);
          });
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    }
  } finally {
    store.close();
  }
}

if (process.env.NODE_ENV !== "test") {
  void startWorker().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
