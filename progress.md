# Progress Log

## 2026-03-11 — T001: Initialize pnpm monorepo workspace

**Status:** Done

**What was done:**

- Created root `package.json` with `private: true`, `engines.node >= 20`, `packageManager: pnpm@10.12.1`, and workspace-level script stubs (`build`, `test`, `lint`, `format`, `clean`, `dev`) that delegate to `pnpm -r run`.
- Created `pnpm-workspace.yaml` listing `apps/*` and `packages/*`.
- Scaffolded 3 apps: `control-plane`, `web-ui`, `worker-runner`.
- Scaffolded 8 packages: `domain`, `application`, `infrastructure`, `schemas`, `config`, `observability`, `ui-components`, `testing`.
- Each workspace has a `package.json` with `@factory/` scoped name and version `0.1.0`.
- Added `.gitignore` (node_modules, dist, .env, \*.db, /workspaces, /artifacts, IDE, OS, logs, coverage).
- Added `.editorconfig` (2-space indent, LF, UTF-8, trim trailing whitespace).
- Added `.nvmrc` (Node 20).
- Added `README.md` with project overview, structure, and setup instructions.

**Patterns established:**

- All packages use `@factory/` npm scope.
- Root scripts delegate to workspaces via `pnpm -r run`.
- pnpm version pinned via `packageManager` field in root `package.json`.

**Next steps:**

- T003: Set up ESLint and Prettier.
- T004: Set up Vitest testing framework.
- T005: Create CI pipeline with GitHub Actions.
- T006: Set up SQLite with Drizzle ORM and migrations.

## 2026-03-11 — T002: Configure TypeScript for all packages

**Status:** Done

**What was done:**

- Created `tsconfig.base.json` at repo root with strict TypeScript settings: `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `verbatimModuleSyntax: true`, plus additional strictness flags (`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`).
- Created root `tsconfig.json` with project references to all 11 workspaces (8 packages + 3 apps).
- Created per-workspace `tsconfig.json` files extending `tsconfig.base.json` with `composite: true`, `outDir: dist`, `rootDir: src`, `include: [src]`.
- Added `src/index.ts` entry points for all 11 workspaces with JSDoc module descriptions.
- Updated all 11 workspace `package.json` files with: `type: module`, `main`, `types`, `exports` (with types + import conditions), `build` script (`tsc --build`), `clean` script, and `files: [dist]`.
- Installed `typescript`, `tsx`, and `@types/node` as root devDependencies.
- Verified cross-package import resolution works via pnpm workspace symlinks + package.json exports with `moduleResolution: NodeNext`.

**Patterns established:**

- All packages use ESM (`"type": "module"` in package.json).
- `module: NodeNext` with `moduleResolution: NodeNext` — imports must use file extensions (`.js`) and `import type` for type-only imports.
- `verbatimModuleSyntax: true` — enforces explicit `import type` syntax.
- Cross-package imports resolve via pnpm workspace protocol + package.json `exports` field (no tsconfig `paths` needed).
- Build via `tsc --build` (composite project references) for incremental builds.
- `outDir` and `rootDir` are set per-package (not in base config) since tsconfig `extends` resolves relative paths from the originating config file.

**Next steps:**

- T003: Set up ESLint and Prettier.
- T004: Set up Vitest testing framework.
- T005: Create CI pipeline with GitHub Actions.
- T006: Set up SQLite with Drizzle ORM and migrations (depends on T002 ✅).

## 2026-03-11 — T004: Set up Vitest testing framework

**Status:** Done

**What was done:**

- Installed `vitest@4.0.18` and `@vitest/coverage-v8` as root devDependencies.
- Created `vitest.workspace.ts` at repo root referencing `packages/*` and `apps/*` globs.
- Created `vitest.config.ts` in all 11 workspaces using `defineProject` with unique `name` and `environment: "node"`.
- Updated root `package.json` test scripts: `test` → `vitest run` (single-process workspace mode), added `test:watch` and `test:coverage`.
- Added `test`, `test:watch`, `test:coverage` scripts to all 11 workspace `package.json` files using `--project` flag for scoped execution.
- Updated all 11 workspace `tsconfig.json` files to exclude `*.test.ts` and `*.spec.ts` from compilation (keeps test files out of `dist/`).
- Added test utilities to `packages/testing/src/index.ts`: `createTestId()`, `createSequentialId()`, `sleep()` — all with JSDoc.
- Created `packages/testing/src/index.test.ts` with 8 tests covering all exported helpers.

**Design decisions:**

- Root `pnpm test` runs `vitest run` directly (single vitest instance in workspace mode) instead of `pnpm -r run test`. This is more efficient than spawning 11 separate vitest processes.
- Per-workspace test scripts use `--project @factory/<name>` to filter to a single workspace when running from a subdirectory. Vitest walks up to find root `vitest.workspace.ts`.
- `defineProject` (vitest 4.x API) is used for per-workspace configs instead of the removed `defineWorkspace`.
- Test files live alongside source in `src/` (e.g., `src/foo.test.ts`) and are excluded from `tsconfig.json` compilation via `exclude` patterns.

**Patterns established:**

- Test files: `src/**/*.test.ts` or `src/**/*.spec.ts` (co-located with source).
- Import vitest APIs explicitly: `import { describe, it, expect } from "vitest"` (no globals).
- Use `.js` extensions in test imports (ESM + NodeNext).
- Coverage via `pnpm test:coverage` (v8 provider).
- Per-workspace scoped tests: `cd packages/domain && pnpm test`.

**Next steps:**

- T003: Set up ESLint and Prettier.
- T005: Create CI pipeline (depends on T003 + T004 ✅).
- T006: Set up SQLite with Drizzle ORM and migrations.

## 2026-03-11 — T006: Set up SQLite with Drizzle ORM and migrations

**Status:** Done

**What was done:**

- Installed `drizzle-orm`, `better-sqlite3`, `@types/better-sqlite3`, and `drizzle-kit` in `apps/control-plane`.
- Created `apps/control-plane/src/infrastructure/database/connection.ts` — connection factory with `createDatabaseConnection()` that applies WAL mode, busy_timeout=5000, and foreign_keys pragmas. Includes `healthCheck()` and `writeTransaction()` (BEGIN IMMEDIATE).
- Created `apps/control-plane/src/infrastructure/database/schema.ts` — empty barrel file for future E002 table definitions.
- Created `apps/control-plane/src/infrastructure/database/migrate.ts` — programmatic `runMigrations()` for app startup use.
- Created `apps/control-plane/src/infrastructure/database/index.ts` — module barrel re-exporting connection and migrate APIs.
- Created `apps/control-plane/drizzle.config.ts` — drizzle-kit config pointing to schema.ts, out=./drizzle, SQLite dialect.
- Created `apps/control-plane/drizzle/meta/_journal.json` — initial empty migration journal.
- Added `db:generate`, `db:migrate`, `db:studio` scripts to control-plane `package.json`.
- Updated `apps/control-plane/src/index.ts` to export database module types and functions.
- Created 17 tests covering WAL mode, busy timeout, foreign keys, healthCheck, writeTransaction (commit, rollback, return value, BEGIN IMMEDIATE), close behavior, directory auto-creation, and Drizzle integration.

**Patterns established:**

- Database connection factory at `apps/control-plane/src/infrastructure/database/connection.ts`.
- `DatabaseConnection` interface wraps both Drizzle ORM (`db`) and raw better-sqlite3 (`sqlite`) for full control.
- All write transactions must use `conn.writeTransaction()` which issues BEGIN IMMEDIATE to avoid SQLITE_BUSY on lock promotion.
- `healthCheck()` verifies connectivity and reports current pragma values.
- Pragmas are always set explicitly (including foreign_keys = OFF when disabled) — don't rely on SQLite compile-time defaults.
- `better-sqlite3` requires native compilation — run `pnpm rebuild better-sqlite3` if the `.node` binding is missing after install.
- Migration directory: `apps/control-plane/drizzle/`. Schema file: `apps/control-plane/src/infrastructure/database/schema.ts`.
- `DATABASE_PATH` env var controls the DB file path (defaults to `./data/factory.db`).

**Next steps:**

- T007: Define core domain enums and value objects (depends on T002 ✅).
- T008-T013: Create entity migrations (depend on T006 ✅ and T007).
- T003: Set up ESLint and Prettier.

## 2026-03-11 — T007: Define core domain enums and value objects

**Status:** Done

**What was done:**

- Created `packages/domain/src/enums.ts` with 24 `as const` enum objects covering all enumerated values from PRD 002-data-model.md and PRD 008-packet-and-schema-spec.md.
- Each enum uses the `as const` object + derived union type pattern for both runtime-accessible values and compile-time type safety.
- All values are case-sensitive exact matches to the PRD specifications.
- Created `packages/domain/src/enums.test.ts` with 53 tests verifying all 24 enums have correct value counts and exact spec-matching values.
- Updated `packages/domain/src/index.ts` to re-export all 24 enum objects and their types.

**Enums defined (24 total):**

- From PRD 002: TaskStatus (16), WorkerLeaseStatus (9), ReviewCycleStatus (8), MergeQueueItemStatus (8), DependencyType (3), WorkerPoolType (5), JobType (8), JobStatus (6), ValidationRunScope (5), FileScopeEnforcementLevel (3), EscalationAction (2).
- From PRD 008: PacketType (8), PacketStatus (4), FileChangeType (4), IssueSeverity (4), ValidationCheckType (7), ValidationCheckStatus (3), ReviewVerdict (3), LeadReviewDecision (4), MergeStrategy (3), MergeAssistRecommendation (3), Confidence (3), PostMergeAnalysisRecommendation (4), AgentRole (6).

**Design decisions:**

- Used `as const` objects rather than TypeScript `const enum` or bare string literal unions. This provides both runtime-accessible values (for iteration, validation, and DB schema use) and full TypeScript type inference. Avoids `const enum` cross-module declaration file issues.
- UPPER_CASE enum values (TaskStatus, etc.) use matching UPPER_CASE keys. Snake_case/kebab-case values use UPPER_SNAKE_CASE keys for readability.
- Single `enums.ts` file organized by domain area with JSDoc cross-referencing PRD sections.

**Patterns established:**

- Domain enums live in `packages/domain/src/enums.ts` and are re-exported from `packages/domain/src/index.ts`.
- Enum pattern: `export const Foo = { ... } as const; export type Foo = (typeof Foo)[keyof typeof Foo];`
- Every enum has JSDoc referencing the authoritative PRD section.
- Tests verify exact value counts and bidirectional containment (no extra, no missing values).

**Next steps:**

- T008-T013: Create entity migrations (depend on T006 ✅ and T007 ✅).
- T003: Set up ESLint and Prettier.
- T015: Implement Task state machine (depends on T007 ✅ and T014).

## T003 — Set up ESLint and Prettier (2026-03-11)

### What was done

- Installed ESLint 10 + typescript-eslint 8 + Prettier 3 + eslint-config-prettier
- Created root `eslint.config.js` using ESLint flat config with typescript-eslint recommended rules
- Created `.prettierrc` (double quotes, semicolons, trailing commas, 100 print width)
- Created `.prettierignore` to exclude dist/, node_modules/, coverage/, drizzle/, pnpm-lock.yaml, \*.db
- Added `"type": "module"` to root package.json for ESM flat config support
- Updated root scripts: `lint`, `lint:fix`, `format`, `format:check` (direct execution, not delegation)
- Added `lint` and `format` scripts to all 11 workspace package.json files
- Installed husky 9 + lint-staged 16, configured pre-commit hook running `npx lint-staged`
- lint-staged runs `eslint --fix` on code files and `prettier --write` on all supported files
- Formatted all 166 existing files to match Prettier config
- `eng/` directory excluded from ESLint (Node.js utility scripts with globals)

### Patterns & decisions

- ESLint flat config (`eslint.config.js`) at root, picked up by workspaces via directory traversal
- `@typescript-eslint/no-unused-vars` allows underscore-prefixed args (`_param`) for intentionally unused parameters
- Root lint/format scripts run directly (`eslint .` / `prettier --write .`) rather than delegating via `pnpm -r run`
- Workspace scripts also available for scoped runs (`cd packages/domain && pnpm lint`)

### Next loop should know

- `pnpm lint` and `pnpm format:check` are now real quality gates (no longer vacuous)
- T005 (CI pipeline) is now unblocked — it depends on T003
- `eng/` directory is excluded from ESLint; if engineering scripts need linting later, add a separate config block with Node.js globals
