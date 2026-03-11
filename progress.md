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

## 2026-03-11 — T008: Create migrations for Project, Repository, WorkflowTemplate tables

**Status:** Done

**What was done:**

- Added Drizzle ORM schema definitions for `workflow_template`, `project`, and `repository` tables in `apps/control-plane/src/infrastructure/database/schema.ts`.
- Generated migration `drizzle/0000_chunky_hellion.sql` via `drizzle-kit generate`.
- Created 24 tests in `schema.test.ts` covering all three tables: insert/select, JSON policy round-trips, FK enforcement (Repository→Project, Project→WorkflowTemplate), unique constraint on project name, nullable columns, timestamp auto-population, index verification, and cross-table join queries.
- Also fixed T003 status in backlog index (was marked `pending` but already fully implemented).

**Schema design decisions:**

- Text primary keys (UUID format) — suitable for distributed systems, consistent across all entities.
- Integer timestamps with `mode: "timestamp"` — stores Unix epoch seconds, Drizzle returns `Date` objects. Uses `DEFAULT (unixepoch())` for auto-population.
- JSON policy columns use `text({ mode: "json" })` — Drizzle handles serialization/deserialization automatically. Schema validated at application layer, stored opaquely in DB.
- FK constraints only to tables in the same migration (Repository→Project, Project→WorkflowTemplate). References to not-yet-created tables (PolicySet from T013) stored as nullable text without DB-level FK constraints — FKs will be added when those tables are created.
- Indexes on `repository.project_id` and `repository.status` for common query patterns.
- Unique constraint on `project.name` to prevent duplicate project names.

**Patterns established:**

- Schema definitions go in `apps/control-plane/src/infrastructure/database/schema.ts` (single file, incrementally extended by T009–T013).
- Table definitions use `sqliteTable()` from `drizzle-orm/sqlite-core`.
- Schema tests use in-memory SQLite with tables created from SQL DDL matching the schema, avoiding coupling to migration files.
- Test helpers (`makeProject`, `makeRepository`, `makeWorkflowTemplate`) generate valid rows with sensible defaults and accept overrides.

**Next steps:**

- T009: Create migrations for Task and TaskDependency tables (depends on T006 ✅, T007 ✅).
- T010–T013: Remaining migration tasks (same dependencies, can run in parallel with T009).
- T014: Entity repositories (depends on T008 ✅ + T009–T013).

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

## T009 — Create migrations for Task and TaskDependency tables (2026-03-11)

### What was done

- Defined Task table (26 columns) in `apps/control-plane/src/infrastructure/database/schema.ts` with all fields from PRD 002 §2.3
- Defined TaskDependency table (6 columns) with FK constraints to Task, unique constraint on (task_id, depends_on_task_id)
- Generated migration `0001_melted_doctor_spectrum.sql` via drizzle-kit
- Added 5 missing domain enums to `packages/domain/src/enums.ts`: TaskType, TaskPriority, TaskSource, EstimatedSize, RiskLevel
- Wrote 31 new schema tests (T009 Task table, TaskDependency table, cross-table relationships)
- Wrote 10 new enum tests for the 5 added enums
- All 143 tests pass, build and lint clean

### Key design decisions

- JSON array columns (acceptance_criteria, definition_of_done, required_capabilities, suggested_file_scope) use `text({ mode: "json" })` matching T008 pattern
- FK references to TaskLease (T011), ReviewCycle (T011), MergeQueueItem (T012) are nullable text with NO DB FK constraint yet
- `is_hard_block` stored as integer (SQLite boolean convention), defaults to 1 (true)
- `version` defaults to 1 for optimistic concurrency (PRD 002 §2.4)
- Composite index on (repository_id, status) for scheduling queries
- Missing enums (TaskType, TaskPriority, TaskSource, EstimatedSize, RiskLevel) were added since T007 missed them

### Next loop should know

- T009 completion unblocks T011 (TaskLease, ReviewCycle) and T012 (MergeQueueItem, ValidationRun, Job)
- T010 (WorkerPool, Worker, AgentProfile, PromptTemplate) and T013 (AuditEvent, PolicySet) are also ready (independent of T009)
- The `uniqueIndex` import was added to schema.ts for the task_dependency unique constraint
- Test pattern: use `seedProjectAndRepo()` helper to create prerequisite Project+Repository for task tests

## T010 — WorkerPool, Worker, AgentProfile, PromptTemplate migrations (2026-03-11)

**What was done:**

- Added Drizzle schema definitions for 4 new tables: `worker_pool`, `worker`, `prompt_template`, `agent_profile`
- Generated migration `0002_smart_micromax.sql`
- Added 34 new tests covering all CRUD, FK enforcement, JSON round-trips, defaults, and cross-table relationships
- Total test count: 177 (all passing)

**Patterns used:**

- Same schema patterns as T008/T009: UUID text PKs, `unixepoch()` timestamp defaults, `text({ mode: "json" })` for JSON columns, integer booleans
- FK references to existing tables (tasks) enforced at DB level
- FK references to future tables (PolicySet from T013) stored as nullable text without DB-level FK
- PromptTemplate defined before AgentProfile in schema to support FK reference order

**What next loop should know:**

- T011, T012, T013 migrations are now unblocked (they depend on T006/T007/T009, all done)
- T014 (entity repositories) still needs T010-T013 all done before starting
- The `openTestDb()` helper in schema.test.ts now includes all T008-T010 tables — future tasks should continue this pattern

## T011: Create migrations for TaskLease, ReviewCycle, ReviewPacket, LeadReviewDecision tables

**Status:** Done  
**Date:** 2026-03-11

### What was done

- Added Drizzle schema definitions for 4 tables in `apps/control-plane/src/infrastructure/database/schema.ts`:
  - `task_lease` — tracks worker lease assignments with FK to task and worker_pool
  - `review_cycle` — tracks review cycle lifecycle with FK to task, JSON arrays for reviewers
  - `review_packet` — stores specialist reviewer results with FK to task and review_cycle
  - `lead_review_decision` — stores lead reviewer consolidation with FK to task and review_cycle
- Generated migration `0003_youthful_nicolaos.sql` via `pnpm db:generate`
- Added 39 new tests (128 total in schema.test.ts, up from 89)

### Patterns used

- Same Drizzle schema patterns as T008-T010: text PKs, `{ mode: "json" }` for JSON columns, `{ mode: "timestamp" }` with `(unixepoch())` defaults
- FK constraints enforced at DB level for task_id, pool_id, review_cycle_id
- worker_id is text-only (no FK) since workers may be ephemeral
- Indexes on frequently queried columns: task_id, status, worker_id, verdict

### Next loop notes

- T012 (MergeQueueItem, ValidationRun, Job) and T013 (AuditEvent, PolicySet) are now ready
- T014 (entity repositories) will be ready once T011-T013 are all done
- The test helper `openTestDb()` now creates all T008-T011 tables; future migrations should extend it
- The `seedWorkerPool()` helper was added for tests that need a valid pool_id FK

## T012: MergeQueueItem, ValidationRun, Job Migrations (2026-03-11)

**What was done:**

- Added `ValidationRunStatus` enum to `packages/domain/src/enums.ts` (pending, running, passed, failed, cancelled)
- Added three Drizzle schema table definitions to `apps/control-plane/src/infrastructure/database/schema.ts`:
  - `mergeQueueItems`: merge queue tracking with position, status, approved_commit_sha, timestamps
  - `validationRuns`: validation execution tracking with run_scope, status, tool_name, artifact_refs JSON
  - `jobs`: DB-backed job queue with job_type, payload_json, dependency/group coordination, lease_owner
- Generated migration `0004_greedy_guardsmen.sql`
- Added 35 comprehensive tests covering all three tables, nullable fields, JSON columns, FK constraints, cross-table joins, and the review cycle job coordination pattern
- All 251 tests pass (up from 216 baseline)

**Patterns used:**

- Same Drizzle schema patterns as T008–T011: text PKs, integer timestamps with `(unixepoch())` default, JSON columns via `text("col", { mode: "json" })`, indexes via third argument to `sqliteTable`
- Test pattern: in-memory SQLite DB created from raw SQL in `openTestDb()`, helper functions for generating valid rows

**What the next loop should know:**

- T012 and T013 both unblock T014 (entity repositories). T013 (AuditEvent, PolicySet) is the next critical dependency.
- The Job table's `(status, run_after)` composite index is the hot path for queue polling (T025)
- The `depends_on_job_ids` JSON column stores cross-job dependency references but has no DB-level FK — coordination is enforced at the application layer

## 2026-03-11 — T013: Create migrations for AuditEvent and PolicySet tables

**Status:** Done

**What was done:**

- Added two Drizzle schema table definitions to `apps/control-plane/src/infrastructure/database/schema.ts`:
  - `auditEvents`: append-only audit trail with entity_type+entity_id correlation, actor tracking, state transitions, and metadata_json for event-specific context
  - `policySets`: versioned policy configuration bundles with 6 JSON policy columns (scheduling, review, merge, security, validation, budget)
- Added indexes: composite `(entity_type, entity_id)` and `created_at` on audit_event
- Generated migration `0005_odd_snowbird.sql`
- Added 29 comprehensive tests covering: CRUD, nullable fields, JSON round-trip (including deeply nested objects), auto-populated timestamps, duplicate rejection, multiple events per entity, all actor/entity/event types, cross-table joins (audit→task, policy→project, audit→policy), and full T008-T013 table existence check
- All 280 tests pass (up from 251 baseline)

**Patterns used:**

- Same Drizzle schema patterns as T008-T012: text PKs, integer timestamps with `(unixepoch())` default, JSON columns via `text("col", { mode: "json" })`
- AuditEvent has no FK constraints by design — it references any entity type via entity_type+entity_id text columns
- PolicySet has no FK constraints — referenced by other tables (Project.default_policy_set_id, AgentProfile policy IDs) as nullable text columns

**What the next loop should know:**

- T013 completion unblocks T014 (data access repositories) — the critical path bottleneck
- T014 depends on T008-T013 (all now done). It's the next critical-path task
- The `default_policy_set_id` on Project and various policy ID columns on WorkflowTemplate/AgentProfile are currently nullable text without DB-level FK constraints — T014 repositories should handle this gracefully
- AuditEvent is append-only by design; no UPDATE/DELETE patterns needed in the repository layer

## 2026-03-11 — T014: Implement data access repositories for all entities

**Status:** Done

**What was done:**

- Created `apps/control-plane/src/infrastructure/repositories/` with 18 repository factory functions
- Each repository is a `createXxxRepository(db: BetterSQLite3Database)` factory returning a typed object with CRUD + query methods
- All 18 schema entities covered: WorkflowTemplate, Project, Repository, Task, TaskDependency, WorkerPool, Worker, AgentProfile, PromptTemplate, TaskLease, ReviewCycle, ReviewPacket, LeadReviewDecision, MergeQueueItem, ValidationRun, Job, AuditEvent, PolicySet
- **Task repository**: Optimistic concurrency via version column — `update()` requires `expectedVersion`, atomically checks and increments, throws `VersionConflictError` on mismatch
- **Job repository**: `claimJob()` atomically sets status=CLAIMED + leaseOwner + increments attemptCount, only if job is PENDING
- **AuditEvent repository**: Insert-only by design — no update/delete methods
- **TaskLease repository**: `findActiveByTaskId()` filters out terminal statuses (COMPLETED, TIMED_OUT, CRASHED, RECLAIMED)
- **MergeQueueItem repository**: `findByRepositoryId()` returns items ordered by position
- Central `index.ts` re-exports all factory functions and entity types
- 138 tests in `repositories.test.ts` covering CRUD, special behaviors, and edge cases
- 418 total tests pass (280 existing + 138 new)

**Patterns established:**

- Factory function pattern: `createXxxRepository(db)` — accepts `BetterSQLite3Database` for both standalone and transactional use
- Consistent API: `findById`, `findAll(opts?)`, `create`, `update`, `delete` + entity-specific queries
- `$dynamic()` used for optional limit/offset pagination
- Optimistic concurrency via WHERE clause on version column (Task repository)
- Atomic claim pattern via conditional UPDATE (Job repository)
- Entity types exported as `Xxx` (select) and `NewXxx` (insert) from each repository module

**Next steps:**

- T015: Task state machine (depends on T014 ✅)
- T025: Job queue core (depends on T014 ✅)
- T030: Lease acquisition (depends on T014 ✅)
- T035: DAG validation (depends on T014 ✅)
- T005: CI pipeline (independent — depends on T003 ✅, T004 ✅)
- T020-T024: Zod packet schemas (independent — depends on T004 ✅)

## 2026-03-11 — T015: Implement Task state machine with transition validation

**Status:** Done

**What was done:**

- Created `packages/domain/src/state-machines/task-state-machine.ts` with full implementation of the task state machine from PRD §2.1.
- Implemented all 16 task states and 45 valid transitions (18 explicit normal-flow + 3 ESCALATED resolutions + 12 wildcard→ESCALATED + 12 wildcard→CANCELLED).
- Each transition has a guard function checking preconditions from the PRD transition table.
- Exported `validateTransition(current, target, context)` returning `{valid, reason}`.
- Exported helpers: `getValidTargets()`, `isTerminalState()`, `getAllValidTransitions()`.
- Created 395 exhaustive tests covering every valid transition, every invalid transition pair, self-transitions, terminal state invariants, guard preconditions, lifecycle scenarios, and rework cycles.
- Updated `packages/domain/src/index.ts` to re-export all state machine functions and types.

**Patterns established:**

- State machines live in `packages/domain/src/state-machines/` with one file per machine.
- Transition maps use `Map<TransitionKey, GuardFn>` where `TransitionKey` is `"FROM→TO"`.
- Wildcard transitions (e.g., \* → ESCALATED) are handled separately from the explicit map.
- Guard functions are pure `(ctx: TransitionContext) => TransitionResult`.
- `TransitionContext` is a flat interface where callers supply only relevant fields.
- Tests use `it.each()` for exhaustive transition pair coverage.

**Next ready tasks:**

- T016: Supporting state machines (depends on T007 ✅)
- T017: Transition service (depends on T015 ✅, T016)
- T020: Shared Zod types (depends on T004 ✅)
- T005: CI pipeline (depends on T003 ✅, T004 ✅)

## 2026-03-11 — T016: Implement supporting state machines

**Status:** Done

**What was done:**

- Implemented Worker Lease state machine (`worker-lease-state-machine.ts`) with 9 states, 15 transitions (including HEARTBEATING self-loop), guard functions for all transitions, and full public API (`validateWorkerLeaseTransition`, `getValidWorkerLeaseTargets`, `isTerminalWorkerLeaseState`, `getAllValidWorkerLeaseTransitions`).
- Implemented Review Cycle state machine (`review-cycle-state-machine.ts`) with 8 states, 10 transitions, escalation from multiple states (IN_PROGRESS, AWAITING_REQUIRED_REVIEWS, CONSOLIDATING), and full public API.
- Implemented Merge Queue Item state machine (`merge-queue-item-state-machine.ts`) with 8 states, 12 transitions, REQUEUED→ENQUEUED retry cycle, and full public API.
- Created comprehensive test suites for all three state machines (131 new tests).
- Exported all new functions and types from `@factory/domain` package index.
- All three state machines follow the same Map-based transition table + guard function pattern established by T015's Task state machine.

**Patterns used:**

- `as const` enum objects with derived union types for state values
- Map<TransitionKey, GuardFn> for transition tables
- TransitionContext interfaces with optional fields for guard preconditions
- Separate `reject()` helper for consistent error messages

**Next loop should know:**

- T017 (Transition Service) is now unblocked — it depends on T015 ✅ and T016 ✅ and T014 ✅.
- T005 (CI pipeline) and T020 (Shared Zod types) are also ready.
- Worker Lease HEARTBEATING state has a self-loop (the only self-transition allowed across all state machines).
- TIMED_OUT and CRASHED are NOT terminal for Worker Lease — they transition to RECLAIMED.
- REQUEUED is NOT terminal for Merge Queue Item — it transitions back to ENQUEUED.

## T017: Build Centralized State Transition Service (done)

**Date:** 2026-03-11

**What was done:**

- Created the centralized State Transition Service in `packages/application/src/services/transition.service.ts`
- Defined repository port interfaces in `packages/application/src/ports/repository.ports.ts`
- Defined UnitOfWork port in `packages/application/src/ports/unit-of-work.port.ts`
- Defined DomainEventEmitter port in `packages/application/src/ports/event-emitter.port.ts`
- Defined domain event types in `packages/application/src/events/domain-events.ts`
- Defined application-layer error types in `packages/application/src/errors.ts`
- Added `@factory/domain` as a dependency of `@factory/application`
- Added tsconfig project reference from application → domain
- Wrote 33 unit tests covering all 4 entity transition methods

**Design decisions:**

- Used port-based dependency injection (repository ports + UnitOfWork + DomainEventEmitter) to keep the application layer decoupled from infrastructure. The control-plane wires implementations.
- Tasks use version-based optimistic concurrency; other entities (lease, review cycle, merge queue item) use status-based optimistic concurrency checks.
- Domain events are emitted AFTER transaction commit to prevent events on rollback.
- Audit events are created WITHIN the transaction to guarantee atomicity with state changes.

**Patterns for next loops:**

- The `createTransitionService(unitOfWork, eventEmitter)` factory pattern should be used when wiring up the service in the control-plane.
- All state transitions in downstream tasks (T018, T019, T030, etc.) should go through this service.
- The UnitOfWork port needs a concrete implementation in `apps/control-plane` that wraps `connection.writeTransaction()`.
- Repository ports need adapter implementations that delegate to the existing Drizzle repository factories.

## 2026-03-11 — T018: Implement atomic transition + audit persistence

**Status:** Done

**What was done:**

- Created `SqliteUnitOfWork` in `apps/control-plane/src/infrastructure/unit-of-work/sqlite-unit-of-work.ts` — concrete implementation of the `UnitOfWork` port that delegates to `DatabaseConnection.writeTransaction` (BEGIN IMMEDIATE).
- Created repository port adapters in `apps/control-plane/src/infrastructure/unit-of-work/repository-adapters.ts` — bridges 5 narrow application-layer ports to the full infrastructure repositories:
  - `createTaskPortAdapter` — version-based optimistic concurrency, re-throws infra `VersionConflictError` as application-layer `VersionConflictError`
  - `createTaskLeasePortAdapter` — status-based optimistic concurrency
  - `createReviewCyclePortAdapter` — status-based optimistic concurrency
  - `createMergeQueueItemPortAdapter` — status-based optimistic concurrency
  - `createAuditEventPortAdapter` — maps between port's `NewAuditEvent` and infra's Drizzle schema (handles `mode: "json"` serialization)
- Created 15 integration tests in `sqlite-unit-of-work.integration.test.ts` proving:
  - State change + audit event persisted atomically on success (all 4 entity types)
  - Failed transitions leave no partial state (rollback is complete)
  - Entity not found throws cleanly with no side effects
  - Sequential transitions increment versions correctly
  - Metadata round-trips through audit events
  - Status-based concurrency rejection for leases
  - Audit write failure triggers full rollback (entity state reverted)
  - Stale version detection via optimistic concurrency
- Added `@factory/application` and `@factory/domain` as dependencies of `@factory/control-plane`
- Added project references in `apps/control-plane/tsconfig.json`

**Key patterns:**

- `createSqliteUnitOfWork(conn)` creates a UnitOfWork that can be injected into `createTransitionService`.
- The adapter pattern (narrow port ← full repo) keeps the application layer decoupled from Drizzle/SQLite details.
- For status-based entities, the adapter reads current status and verifies before updating — safe within BEGIN IMMEDIATE.
- The infra task repo's `VersionConflictError` is caught and re-thrown as the application-layer `VersionConflictError` to maintain type compatibility.

**For next loops:**

- T019 (optimistic concurrency) can build on this — the version and status-based concurrency is already implemented and tested.
- T073 (audit event recording) is unblocked — the audit event infrastructure is fully integrated.
- The `createSqliteUnitOfWork` + `createTransitionService` wiring is ready for use in the control-plane bootstrap (T080).
