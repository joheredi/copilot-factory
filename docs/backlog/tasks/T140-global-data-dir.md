# T140: Establish ~/.copilot-factory/ global data directory convention

| Field                     | Value                                                                             |
| ------------------------- | --------------------------------------------------------------------------------- |
| **ID**                    | T140                                                                              |
| **Epic**                  | [E026: CLI Init & Project Onboarding](../epics/E026-cli-init.md)                  |
| **Type**                  | foundation                                                                        |
| **Status**                | pending                                                                           |
| **Priority**              | P0                                                                                |
| **Owner**                 | platform-engineer                                                                 |
| **AI Executable**         | Yes                                                                               |
| **Human Review Required** | Yes                                                                               |
| **Dependencies**          | [T119](./T119-scaffold-cli-workspace.md)                                          |
| **Blocks**                | [T141](./T141-programmatic-migrations.md), [T146](./T146-start-static-serving.md) |

---

## Description

Create a `paths` module in the CLI workspace that centralizes all path resolution for the factory's global data directory. The default location is `~/.copilot-factory/`, overridable via the `FACTORY_HOME` environment variable. This module provides helper functions for all standard paths (database, worktrees, artifacts, migrations) and ensures directories are created idempotently.

## Goal

Establish a single source of truth for where the factory stores its data, so that `init`, `start`, and all internal services resolve paths consistently.

## Scope

### In Scope

- `apps/cli/src/paths.ts` module with exported helpers:
  - `getFactoryHome(): string` — `FACTORY_HOME` env var or `~/.copilot-factory/`
  - `getDbPath(): string` — `{home}/factory.db`
  - `getWorkspacesRoot(): string` — `{home}/workspaces/`
  - `getArtifactsRoot(): string` — `{home}/artifacts/`
  - `getMigrationsDir(): string` — `{home}/drizzle/` or resolved from package
  - `ensureFactoryHome(): void` — create `~/.copilot-factory/` and subdirs if missing
- Support `FACTORY_HOME` env var override for testing and non-standard setups
- Cross-platform `~` resolution (use `os.homedir()`)
- Unit tests verifying path resolution and env var override

### Out of Scope

- Database creation (T141)
- Migration execution (T141)
- CLI commands (T142, T143, T145)

## Context Files

The implementing agent should read these files before starting:

- `apps/control-plane/src/infrastructure/database/database.module.ts` — current `DATABASE_PATH` resolution (line 34)
- `apps/control-plane/src/infrastructure/database/connection.ts` — how directory creation works (line 150-153)
- `packages/infrastructure/src/workspace/workspace-manager.ts` — current workspace root resolution
- `packages/infrastructure/src/artifacts/artifact-store.ts` — current artifact root resolution
- `apps/cli/package.json` — CLI workspace structure (created in T119)

## Implementation Guidance

1. Create `apps/cli/src/paths.ts`
2. Import `os` for `homedir()`, `path` for joins, `fs` for `mkdirSync`
3. `getFactoryHome()`:
   ```typescript
   export function getFactoryHome(): string {
     return process.env["FACTORY_HOME"] ?? path.join(os.homedir(), ".copilot-factory");
   }
   ```
4. Other helpers compose on `getFactoryHome()`:
   ```typescript
   export function getDbPath(): string {
     return path.join(getFactoryHome(), "factory.db");
   }
   export function getWorkspacesRoot(): string {
     return path.join(getFactoryHome(), "workspaces");
   }
   export function getArtifactsRoot(): string {
     return path.join(getFactoryHome(), "artifacts");
   }
   ```
5. `ensureFactoryHome()`: call `mkdirSync(dir, { recursive: true })` for home, workspaces, artifacts
6. Export all helpers from `apps/cli/src/paths.ts`
7. Write tests that:
   - Verify default resolves to `~/.copilot-factory/`
   - Verify `FACTORY_HOME` override works
   - Verify `ensureFactoryHome()` creates nested directories
   - Use a temp directory for testing (don't touch real home)

## Acceptance Criteria

- [ ] `getFactoryHome()` returns `~/.copilot-factory/` by default
- [ ] `FACTORY_HOME` env var overrides the default
- [ ] `getDbPath()` returns `{home}/factory.db`
- [ ] `getWorkspacesRoot()` returns `{home}/workspaces/`
- [ ] `getArtifactsRoot()` returns `{home}/artifacts/`
- [ ] `ensureFactoryHome()` creates all directories idempotently
- [ ] Works on Linux and macOS (cross-platform `~` resolution)
- [ ] Unit tests pass

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
cd apps/cli && pnpm test -- --grep paths
```

## Risks / Notes

- Use `os.homedir()` not `process.env.HOME` for cross-platform support (Windows compat later).
- The `FACTORY_HOME` override is critical for testing — tests should never write to the real `~/.copilot-factory/`.

## Follow-on Tasks

T141, T146
