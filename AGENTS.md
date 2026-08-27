# Agent Guidelines

Instructions for AI coding agents working in this repository.

## Hard constraints

- Control Plane (apps/api) never executes user code; execution happens only in
  the worker via the sandbox providers in packages/sandbox-sdk.
- At most one active write Run per project; all write requests carry an
  idempotency key. Preview and build operations share the project write lock.
- Secrets (model keys, service credentials) live only in `.env` and are never
  committed, logged, or passed into generated-app child processes.
- Shared shapes live in packages/contracts as Zod schemas and are validated at
  runtime on both ends — do not replace them with TS-only types.
- Git is the source of truth for generated code; the database stores metadata
  only.

## Workflow

- Every change must keep `pnpm check` green (format + types + tests + build).
- Prefer turning a task into a verifiable goal: write the failing test first,
  then make it pass.
- Consult the ADRs under docs/adr/ before changing a documented boundary.
- Touch only what the task requires; match the existing code style.
