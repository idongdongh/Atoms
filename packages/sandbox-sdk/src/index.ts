import type { SandboxInfo, SandboxStatus } from "@atoms/contracts";
import { canTransitionSandbox, sandboxInfoSchema } from "@atoms/contracts";

export { LocalDevelopmentSandboxProvider } from "./local-development-provider.js";
export type {
  PreviewProcess,
  PreviewProvider,
} from "./local-development-provider.js";

function snapshot(sandbox: SandboxInfo): SandboxInfo {
  return { ...sandbox };
}

export interface SandboxProvider {
  create(): Promise<SandboxInfo>;
  transition(id: string, status: SandboxStatus): Promise<SandboxInfo>;
  get(id: string): Promise<SandboxInfo>;
  destroy(id: string): Promise<void>;
}

export class FakeSandboxProvider implements SandboxProvider {
  readonly #sandboxes = new Map<string, SandboxInfo>();
  #nextId = 1;

  async create(): Promise<SandboxInfo> {
    const sandbox: SandboxInfo = {
      id: `sandbox-${this.#nextId++}`,
      status: "provisioning",
    };
    const validated = sandboxInfoSchema.parse(sandbox);
    this.#sandboxes.set(validated.id, snapshot(validated));
    return snapshot(validated);
  }

  async transition(id: string, status: SandboxStatus): Promise<SandboxInfo> {
    const current = await this.get(id);
    if (!canTransitionSandbox(current.status, status)) {
      throw new Error(
        `Invalid sandbox transition: ${current.status} -> ${status}`,
      );
    }
    const next = sandboxInfoSchema.parse({ ...current, status });
    this.#sandboxes.set(id, snapshot(next));
    return snapshot(next);
  }

  async get(id: string): Promise<SandboxInfo> {
    const sandbox = this.#sandboxes.get(id);
    if (!sandbox) {
      throw new Error(`Sandbox not found: ${id}`);
    }
    return snapshot(sandbox);
  }

  async destroy(id: string): Promise<void> {
    this.#sandboxes.delete(id);
  }
}
