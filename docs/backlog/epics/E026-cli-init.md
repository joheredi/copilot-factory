# E026: CLI Init & Project Onboarding

## Summary

Implement the `npx @copilot/factory init` command that registers a project with the factory from the project root directory. Auto-detects project metadata (name, git remote, branch, owner) and optionally imports tasks. Establishes the `~/.copilot-factory/` global data directory convention.

## Why This Epic Exists

The factory has no onboarding flow. Developers need a single command to register their project so it appears in the operator dashboard. The init command should auto-detect everything possible and prompt only when necessary, making it effortless to go from "I have a repo" to "the factory knows about my project."

## Goals

- Establish `~/.copilot-factory/` as the global data directory (DB, worktrees, artifacts)
- Run database migrations programmatically (no manual `pnpm db:migrate`)
- Auto-detect project name, git remote, default branch, and owner from the project root
- Register the project and repository in the database idempotently
- Optionally import tasks from a local directory during init
- Write a `.copilot-factory.json` marker file for future CLI features
- Make init safe to re-run (idempotent — update rather than duplicate)

## Scope

### In Scope

- Global data directory helpers (`~/.copilot-factory/`)
- Programmatic Drizzle migration runner
- Project metadata auto-detection (package.json, git, OS)
- Interactive init flow with confirmation and optional task import
- Idempotent project/repository registration
- `.copilot-factory.json` marker file

### Out of Scope

- `factory start` command (E024/E027)
- Worker pool configuration (done via dashboard)
- Policy/workflow configuration (done via dashboard)
- Remote project registration (local-first only)

## Dependencies

**Depends on:** E001, E002, E023 (for task import)

**Enables:** E027 (Factory Lifecycle)

## Risks / Notes

- `init` writes directly to the DB without a running factory. It imports the service layer to create entities in a transaction.
- Auto-detection heuristics may fail in edge cases (monorepos, no git, no package.json). The fallback is always a prompt.
- The `FACTORY_HOME` env var allows overriding `~/.copilot-factory/` for testing or non-standard setups.

## Tasks

| ID                                               | Title                                        | Priority | Status  |
| ------------------------------------------------ | -------------------------------------------- | -------- | ------- |
| [T140](../tasks/T140-global-data-dir.md)         | Establish ~/.copilot-factory/ convention     | P0       | pending |
| [T141](../tasks/T141-programmatic-migrations.md) | Run Drizzle migrations from code             | P0       | pending |
| [T142](../tasks/T142-init-project-detection.md)  | Auto-detect project metadata in init command | P0       | pending |
| [T143](../tasks/T143-init-interactive-flow.md)   | Build init interactive flow and registration | P0       | pending |
| [T144](../tasks/T144-init-idempotent.md)         | Make init safe to re-run                     | P1       | pending |

## Sequencing Notes

T140 (data dir) must be first — everything depends on knowing where data lives. T141 (migrations) depends on T140. T142 (detection) depends on T141 so it can write to the DB. T143 (flow) depends on T142. T144 (idempotent) depends on T143.

## Completion Criteria

Running `npx @copilot/factory init` in a project root registers the project, optionally imports tasks, and produces a `.copilot-factory.json` marker. Running it again updates without duplicating.
