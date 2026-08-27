# Contributing

Thanks for your interest in improving Atoms!

## Getting started

```bash
pnpm install
pnpm dev   # API :3000 + Web :5173 + Worker
```

## Before opening a PR

- Run `pnpm check` — it formats, type-checks, runs all tests and builds; it must pass.
- Add or update tests for any behavior change.
- Keep changes focused: one logical change per PR.

## Architecture notes

Read [docs/architecture.md](docs/architecture.md) and the [ADRs](docs/adr/) first —
boundary decisions are documented there and should not be changed casually.
