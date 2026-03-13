# T141: Run Drizzle migrations from code

| Field                     | Value                                                                     |
| ------------------------- | ------------------------------------------------------------------------- |
| **ID**                    | T141                                                                      |
| **Epic**                  | [E026: CLI Init & Project Onboarding](../epics/E026-cli-init.md)          |
| **Type**                  | foundation                                                                |
| **Status**                | done                                                                      |
| **Priority**              | P0                                                                        |
| **Owner**                 | backend-engineer                                                          |
| **AI Executable**         | Yes                                                                       |
| **Human Review Required** | Yes                                                                       |
| **Dependencies**          | [T140](./T140-global-data-dir.md)                                         |
| **Blocks**                | [T142](./T142-init-project-detection.md), [T145](./T145-start-command.md) |

---

## Description

Create a migration utility in the CLI workspace that runs Drizzle ORM migrations programmatically against the global factory database. This is called by both `factory init` (to prepare the DB on first use) and `factory start` (to apply any pending migrations before starting the server). It must handle first-run (no DB file), already-up-to-date (no-op), and error cases gracefully.

## Goal

Eliminate the need for manual `pnpm db:migrate` — migrations run automatically as part of `init` and `start`.

## Scope

### In Scope

- `apps/cli/src/migrate.ts` with `runMigrations(dbPath: string): Promise<MigrationResult>`
- Resolve migration SQL files from the control-plane's `drizzle/` directory
- Create the database file and parent directory if they don't exist
- Apply pending migrations using Drizzle's `migrate()` function
- Return result: `{ applied: number, alreadyUpToDate: boolean }`
- Handle errors: corrupt DB, permission denied, invalid migrations
- Unit tests with a temp DB

### Out of Scope

- Migration generation (still use `pnpm db:generate` in the control-plane)
- Schema changes (separate tasks)

## Context Files

The implementing agent should read these files before starting:

- `apps/control-plane/src/infrastructure/database/connection.ts` — `createDatabaseConnection()` (line 146)
- `apps/control-plane/drizzle/` — migration SQL files and journal
- `apps/control-plane/drizzle.config.ts` — Drizzle migration config
- `apps/cli/src/paths.ts` — `getDbPath()`, `getMigrationsDir()` (from T140)

## Implementation Guidance

1. Create `apps/cli/src/migrate.ts`
2. Import `drizzle` from `drizzle-orm/better-sqlite3` and `migrate` from `drizzle-orm/better-sqlite3/migrator`
3. Resolve the migrations folder: look for `apps/control-plane/drizzle/` relative to the CLI package, or from an env var `MIGRATIONS_DIR`
4. Implementation:

   ```typescript
   import Database from "better-sqlite3";
   import { drizzle } from "drizzle-orm/better-sqlite3";
   import { migrate } from "drizzle-orm/better-sqlite3/migrator";
   import { mkdirSync, existsSync } from "node:fs";
   import { dirname } from "node:path";

   export interface MigrationResult {
     applied: number;
     alreadyUpToDate: boolean;
   }

   export async function runMigrations(
     dbPath: string,
     migrationsFolder: string,
   ): Promise<MigrationResult> {
     const dir = dirname(dbPath);
     if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

     const sqlite = new Database(dbPath);
     sqlite.pragma("journal_mode = WAL");
     sqlite.pragma("foreign_keys = ON");
     const db = drizzle(sqlite);

     migrate(db, { migrationsFolder });
     sqlite.close();
     return { applied: 0, alreadyUpToDate: true }; // Drizzle handles idempotency
   }
   ```

5. Note: Drizzle's `migrate()` is synchronous for better-sqlite3 but the function signature can be async for future flexibility
6. Add `better-sqlite3` and `drizzle-orm` as dependencies of `apps/cli/package.json`
7. Write tests: first-run (creates DB), second-run (no-op), invalid path (error)

## Acceptance Criteria

- [x] `runMigrations()` creates the DB file if it doesn't exist
- [x] `runMigrations()` applies all pending migrations on first run
- [x] `runMigrations()` is a no-op when already up to date
- [x] Migrations folder is resolved correctly from the CLI package
- [x] Errors (corrupt DB, missing migrations) are thrown with clear messages
- [x] Unit tests pass with a temp DB

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
cd apps/cli && pnpm test -- --grep migrate
```

## Risks / Notes

- The Drizzle `migrate()` function reads the `__drizzle_migrations` journal table to determine what's already applied. It's inherently idempotent.
- The CLI package needs `better-sqlite3` as a dependency, which requires native compilation. Ensure it's in `dependencies` not `devDependencies`.

## Follow-on Tasks

T142, T145
