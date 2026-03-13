# Progress Log

## T143: Build init interactive flow and registration — DONE

**What was done:**

- Created `apps/cli/src/commands/init.ts` with the full `factory init` interactive flow
- Modified `apps/cli/src/cli.ts` to support subcommands (`factory init` + default server start)
- Added `@factory/infrastructure` as a CLI dependency for task import parsers

**Init command flow:**

1. Auto-detects project metadata via `detectAll()` (name, git remote, branch, owner)
2. Displays detected values with ✓ prefix, prompts for missing ones via readline
3. Ensures factory home directory and runs Drizzle migrations
4. Creates Project and Repository records using raw better-sqlite3 SQL (follows queryProjectCount pattern)
5. Optional task import: discovers tasks via infrastructure parsers, inserts into task table
6. Writes `.copilot-factory.json` marker file to project root
7. Prints summary with next steps

**Key design decisions:**

- Used raw better-sqlite3 for DB operations (not Drizzle repositories) because repositories aren't exported from @factory/control-plane main entry. Follows existing `queryProjectCount` pattern in startup.ts.
- Used `ON CONFLICT (name) DO NOTHING` for project insert for basic idempotency. Full idempotent re-run is deferred to T144.
- Dynamic import of `@factory/infrastructure` for task discovery to keep init lightweight.
- CLI restructured with Commander subcommand + `subcommandRan` flag to support both `factory` (default=start) and `factory init`.

**Tests added (18 new tests):**

- 12 tests for `runInit`: all-detected happy path, missing values prompting, re-init idempotency, empty name/owner validation, no-git-remote handling, task import, import skip, import failure, marker file format, summary output, Ctrl+C handling, SSH remote URL
- 6 tests for `extractRepoName`: HTTPS with/without .git, SSH with/without .git, unrecognizable URL

**Patterns for next loops:**

- Init command deps injection pattern: `InitDeps` interface with all injectable functions
- Task import uses `discoverMarkdownTasks`/`parseJsonTasks` from @factory/infrastructure
- CLI subcommands: add `.command("name").action()` to program, use `subcommandRan` flag

## T137: Wire WorkerDispatchService into AutomationService — DONE

**What was done:**

- Wired the full worker dispatch chain into `AutomationService` constructor: HeartbeatService → HeartbeatForwarderAdapter → InfrastructureAdapters → WorkerSupervisorService → WorkerDispatchService
- Added `processWorkerDispatches()` fire-and-forget method to `runCycle()` — dispatches WORKER_DISPATCH jobs without blocking readiness reconciliation or scheduler tick
- Tracks active dispatch promises in a `Set<Promise>` to prevent unbounded concurrency
- Added two new UoW factory functions in `application-adapters.ts`:
  - `createWorkerSupervisorUnitOfWork(conn)` — wraps worker repository for supervisor create/find/update operations
  - `createHeartbeatUnitOfWork(conn)` — wraps lease repository with raw SQLite UNION query for stale lease detection, plus audit event persistence
- Added `mapWorkerRow()` helper to map DB rows to `SupervisedWorker` domain entities

**Tests added:**

- `application-adapters.test.ts`: 9 new tests — 3 for `createWorkerSupervisorUnitOfWork` (create, find, update), 6 for `createHeartbeatUnitOfWork` (find stale, extend lease, revoke lease, record audit, version conflict, no stale returns empty)
- `automation.service.test.ts`: 1 new test for `processWorkerDispatches` fire-and-forget behavior

**Key design decisions:**

- Inline construction in constructor (not extracted factory) — matches existing pattern for transitionService, readinessService, schedulerService
- Fire-and-forget dispatch with `.catch()` error handling — `processWorkerDispatches()` is sync, starts async work, logs results/errors
- HeartbeatUnitOfWork uses raw SQLite for `findStaleLeases` — the heartbeat-stale OR TTL-expired pattern is simpler in raw SQL than Drizzle
- Worker table `currentTaskId` has FK to task table — tests must seed project → repository → task before creating workers

**What the next loop should know:**

- T138 (dispatch integration test) is now unblocked — it should test the full end-to-end flow from job queue to worker spawn
- The `ProcessDispatchResult` uses `processed`/`dispatched` boolean discriminants, NOT an `outcome` field
- `Record<string, unknown>` fields require bracket notation access (`updateData["expiresAt"]`) due to `noPropertyAccessFromIndexSignature`

## T138: End-to-End Dispatch Integration Test — DONE

- Added integration test in `apps/control-plane/src/automation/automation.service.test.ts` proving the full task lifecycle: BACKLOG → READY → ASSIGNED → dispatch → IN_DEVELOPMENT → DEV_COMPLETE.
- Test uses hybrid wiring: AutomationService for readiness/scheduling, manually-wired dispatch chain with FakeRunnerAdapter + FakeWorkspaceManager for the dispatch step.
- Verifies: dispatch job completion, worker entity creation (terminal status), heartbeat forwarding (lease STARTING → RUNNING → COMPLETING), task state transitions through guard-protected states, workspace creation, and packet mounting.
- **Discovered gap:** The dispatch pipeline does not automatically transition the lease from LEASED → STARTING. Heartbeat forwarding requires the lease to be in STARTING state. The test manually transitions the lease (mirroring the full-lifecycle integration test pattern).
- All 4,134 tests pass. Build clean.

## T140 — Establish ~/.copilot-factory/ global data directory convention

### Task

T140 - Create paths module for centralized data directory resolution (Epic E026: CLI Init & Project Onboarding)

### What was done

- Created `apps/cli/src/paths.ts` with 6 exported helpers: `getFactoryHome()`, `getDbPath()`, `getWorkspacesRoot()`, `getArtifactsRoot()`, `getMigrationsDir()`, `ensureFactoryHome()`
- Created `apps/cli/src/paths.test.ts` with 10 unit tests covering default resolution, FACTORY_HOME override, empty string fallback, all path helpers, idempotent directory creation, and nested directory creation
- Created `apps/cli/vitest.config.ts` for test infrastructure
- Added `test` script to `apps/cli/package.json`

### Patterns used

- Pure functions composing on `getFactoryHome()` for all path resolution
- `os.homedir()` for cross-platform home directory resolution
- `FACTORY_HOME` env var override for testing and non-standard setups
- Temp directories in tests to avoid touching real `~/.copilot-factory/`
- Consistent with existing infrastructure patterns (recursive mkdirSync, existsSync checks)

### For next loop

- T141 (programmatic Drizzle migrations) and T146 (start static serving) are now unblocked
- T141 depends on this paths module to resolve `getDbPath()` and `getMigrationsDir()`

## T120: Serve web-ui static files from control-plane — DONE

### What was done

- Created `apps/control-plane/src/static-serve/` module with:
  - `configure-static-serving.ts`: Core function `configureStaticServing(app, distPath)` and lower-level `registerStaticFileServing(fastifyInstance, distPath)` for Fastify plugin registration + SPA fallback wildcard route
  - `static-serve.module.ts`: `StaticServeModule` NestJS module with env-var-based activation (`SERVE_STATIC=true`, `WEB_UI_DIST=<path>`). Uses `OnApplicationBootstrap` lifecycle hook for correct timing.
  - `index.ts`: Re-exports
  - `configure-static-serving.test.ts`: 12 tests covering validation, static file serving, SPA fallback, API route precedence, and edge cases
- Added `StaticServeModule` to `AppModule` imports

### Key patterns

- `@fastify/static` with `wildcard: false` — prevents plugin from registering its own `GET /*` route
- Custom `GET /*` wildcard route checks filesystem for actual files, falls back to `index.html` for SPA routing
- Fastify routing priority: exact routes > parametric > wildcard ensures NestJS API routes always win
- Module is always imported but is a no-op when `SERVE_STATIC !== 'true'`
- `configureStaticServing()` exported for CLI entry point (T121) to call programmatically
- Pre-reads `index.html` into memory to avoid filesystem reads on every SPA navigation
- Fastify version type mismatch between NestJS adapter and direct dependency requires `as unknown as FastifyInstance` cast

### For next loop

- T121 (CLI entry point) is now unblocked — it can call `configureStaticServing(app, distPath)` directly

## T141 — Run Drizzle migrations from code

### Task

T141 - Run Drizzle migrations from code (Epic E026: CLI Init & Project Onboarding)

### What was done

- Created `apps/cli/src/migrate.ts` with `runMigrations(dbPath, migrationsFolder)` function
- Uses Drizzle ORM's built-in `migrate()` from `drizzle-orm/better-sqlite3/migrator`
- Counts applied migrations by querying `__drizzle_migrations` table before/after migration run
- Configures SQLite with WAL mode, busy_timeout=5000, foreign_keys=ON (matching control-plane connection.ts)
- Creates parent directories for DB file automatically
- Custom `MigrationError` class wraps errors with dbPath and migrationsFolder context
- Validates migrations folder exists before opening the database
- Always closes the database connection in a `finally` block
- Added `better-sqlite3` and `drizzle-orm` as dependencies of `apps/cli/package.json`
- Created 10 unit tests covering first-run, idempotency, parent dir creation, WAL mode, table verification, error cases

### Patterns

- Tests use real control-plane migration files from `apps/control-plane/drizzle/` (resolved via `import.meta.dirname`) to catch schema compatibility issues
- Temporary directories with `mkdtempSync` for test isolation, cleaned up in `afterEach`
- Database table names are singular snake_case (e.g., `project`, `task`, `repository`) — not plural

### For next loop

- T142 (auto-detect project metadata) and T145 (factory start command) are now unblocked
- T146 (static serving) is also ready (depends on T140 which is done)
- When integrating into `factory init`/`factory start`, call `runMigrations(getDbPath(), getMigrationsDir())`

## T121 — Build CLI entry point command

### Task

T121 - Build CLI entry point command (Epic E024: CLI Package & Single-Command Startup)

### What was done

- Extracted `createApp()` from `apps/control-plane/src/main.ts` into `apps/control-plane/src/bootstrap.ts`. This creates a NestJS Fastify app with CORS, Swagger, validation, and error handling — but does NOT listen or init tracing. Allows both `main.ts` and the CLI to share the same app setup.
- Refactored `apps/control-plane/src/main.ts` to import and use `createApp()` from `bootstrap.ts`. Module-scope tracing init and auto-start remain in `main.ts`.
- Exported `createApp` and `configureStaticServing` from `@factory/control-plane` package (`index.ts`).
- Installed `commander` (v14) and `open` (v11) as CLI dependencies, plus `@factory/observability` for tracing init.
- Implemented full CLI in `apps/cli/src/startup.ts` (testable core) + `apps/cli/src/cli.ts` (shebang entry point):
  - Commander arg parsing: `--port` (default 4100), `--db-path`, `--no-open`, `--no-ui`
  - `ensureFactoryHome()` → Drizzle migrations → tracing init → `createApp()` → static serving → `app.listen()` → browser open
  - Graceful SIGINT/SIGTERM shutdown
  - EADDRINUSE error handling with helpful message
  - Startup banner with API/Swagger/WebUI URLs and DB path
  - Dependency injection for `openBrowser`, `webUiDistPath`, `migrationsPath` to enable testing
- Created 15 unit tests in `apps/cli/src/cli.test.ts` covering arg parsing, option validation, path resolution.
- All 4,249 tests pass across the monorepo (184 test files).

### Patterns used

- **Side-effect isolation**: Separated testable logic (`startup.ts`) from entry point (`cli.ts`) to prevent module-scope `main()` calls during test imports.
- **Dependency injection for testing**: `startServer()` accepts `deps` object for overriding browser open, paths. Same pattern as `FakeClock`/`FakeFileSystem` in infrastructure tests.
- **Monorepo-relative paths**: Used `import.meta.dirname` + relative `join()` for migrations dir and web-UI dist — same pattern as `migrate.test.ts`.
- **Graceful degradation**: Missing web-UI dist logs a warning and continues in API-only mode instead of failing.

### For next loop

- T122 (CLI readme/docs) is now unblocked by T121
- T114 (parser integration tests) is ready (P1)
- T124-T131 (web-UI CRUD dialogs) are ready (P1)
- T150 (dashboard project selector) is ready (P1)

## T114 — Build JSON/backlog.json task parser

### Task

Build a deterministic parser for JSON task files (backlog.json and flat array formats) that produces ImportManifest.

### What was done

- Created `packages/infrastructure/src/import/json-task-parser.ts` (~330 lines)
  - `parseJsonTasks(sourcePath, fs)` — main entry point, reads file and auto-detects format
  - `detectJsonFormat(data)` — returns "backlog" | "flat" | "unknown"
  - `mapBacklogTask(raw, source)` — maps backlog.json fields to ImportedTask
  - `mapFlatTask(raw, index, source)` — validates flat-format entries
  - `parseBacklogJsonData(data, sourcePath)` — processes backlog.json root object
  - `parseFlatJsonData(data, sourcePath)` — processes flat array
  - `buildManifest(tasks, warnings, sourcePath, rootData)` — assembles ImportManifest
- Created `packages/infrastructure/src/import/json-task-parser.test.ts` (~470 lines, 30 tests)
- Updated barrel exports in `packages/infrastructure/src/import/index.ts`

### Patterns used

- Pure functional approach matching markdown parser pattern
- FileSystem dependency injection (same interface as markdown parser)
- Reuses `mapTaskType` and `mapPriority` from markdown-task-parser.ts
- Zod safeParse for validation; invalid entries produce warnings, valid ones kept
- `Record<string, unknown>` with bracket notation for index signature access (required by `noPropertyAccessFromIndexSignature`)

### Notes for next loops

- T115 (import discovery endpoint) and T123 (import format docs) are now unblocked
- The parser handles the real 111-task backlog.json from this repo
- `createFakeFs()` helper from testing package works for mock file reads in tests

## T124: Add Create Task Dialog to Tasks Page

- Created `CreateTaskDialog.tsx` — full dialog component with form validation, cascading project→repository selection, all task fields (title, description, type, priority, risk level, estimated size, acceptance criteria)
- Updated `page.tsx` — added "Create Task" button with Plus icon in the header, wired to open the dialog
- Created `CreateTaskDialog.test.tsx` — 16 tests covering rendering, validation, submission flow, error display, cascading selects, and form reset
- Pattern: native `<select>` elements styled like Input (no shadcn Select component exists), useState for form management, `useCreateTask` mutation hook
- Key learning: In tests with cascading selects, must wait for options to actually populate (not just for the select to be enabled) before selecting a value

## T146: Serve web-ui static files from same server

### What was done

- Verified T146 is already fully implemented by the existing T120 work in `apps/control-plane/src/static-serve/`
- All 7 acceptance criteria confirmed met: SERVE_STATIC env var gating, SPA fallback for client routes, API route precedence, graceful handling of missing WEB_UI_DIST
- Marked T146 as `done` in task file and backlog index
- Also fixed T120 status in backlog index (was `pending` but task file was already `done`)
- Cleaned up Ready-Now and P0 Pending lists to remove completed tasks (T112, T113, T119, T120, T121, T136, T137, T138, T140, T141, T146)
- Added newly-ready tasks: T142, T145, T115

### For next loop

- T145 (Build factory start command) is now unblocked (deps T141+T146 both done) — high priority P0
- T142 (Auto-detect project metadata) is ready (dep T141 done) — P0
- T115 (Import discovery endpoint) is ready (deps T113+T114 done) — P0

## T142 — Auto-detect project metadata

### Task

T142 - Auto-detect project metadata in init command (Epic E026: CLI Init & Project Onboarding)

### What was done

- Created `apps/cli/src/detect.ts` with five detection functions:
  - `detectProjectName(cwd)` — reads `package.json` name field, falls back to `path.basename(cwd)`
  - `detectGitRemoteUrl(cwd)` — runs `git remote get-url origin`
  - `detectDefaultBranch(cwd)` — parses `git symbolic-ref refs/remotes/origin/HEAD`, defaults to `"main"`
  - `detectOwner(cwd)` — runs `git config user.name`, falls back to `os.userInfo().username`
  - `detectAll(cwd)` — aggregates all four into a `ProjectMetadata` interface
- Created `apps/cli/src/detect.test.ts` with 21 tests covering:
  - Package.json name detection, scoped names, missing/invalid/empty package.json
  - Git remote URL detection (HTTPS and SSH), no-git, no-origin scenarios
  - Default branch detection with symbolic ref, fallback to "main"
  - Owner detection from git config with OS username fallback
  - `detectAll` aggregation, partial metadata, subdirectory detection

### Patterns

- Used `execSync` with `{ cwd, stdio: 'pipe' }` and try/catch for git commands
- All functions return `null` on failure (never throw)
- Tests use real temp directories with `mkdtempSync` and `git init` — no mocks
- Matches existing CLI patterns: JSDoc, node: prefix imports, explicit vitest imports

### For next loop

- T143 (Build init interactive flow) is now unblocked — depends on T142 (done)
- T145 (Build factory start command) remains ready — P0
- T115 (Import discovery endpoint) remains ready — P0

---

## T145: Build factory start command — DONE

### What was done

Enhanced `apps/cli/src/startup.ts` to complete T145 acceptance criteria:

1. **`--verbose` flag**: Added to `CliOptions` and Commander config. When enabled, prints `[verbose]` prefixed debug messages at each startup step and enables the OpenTelemetry console exporter.

2. **Box-drawing banner**: Rewrote `printBanner()` to use Unicode box-drawing characters (┌─┐│└─┘) with dynamic width padding. Banner shows version, dashboard URL, API docs URL, data directory, project count, and Ctrl+C instruction.

3. **Project count**: Added `queryProjectCount(dbPath)` that opens a short-lived read-only better-sqlite3 connection to `SELECT COUNT(*) AS cnt FROM project`. Returns 0 on any error (DB missing, table missing). WAL mode ensures no conflict with the NestJS app's connection.

4. **Tests**: Added 3 tests for `queryProjectCount` (non-existent DB, missing table, populated table) plus updated existing tests for the new `verbose` option.

### Patterns used

- Read-only better-sqlite3 connection for project count query (avoids WAL conflicts)
- Defensive error handling — `queryProjectCount` never throws, returns 0 on failure
- Box-drawing chars with dynamic padding for the banner
- Verbose logging prefixed with `[verbose]` for debug output

### Key details

- DB table name is `project` (singular) — matches Drizzle schema's `sqliteTable("project", ...)`
- Default port is 4100 (not 3000 as task spec suggested) — kept existing convention from T121
- `better-sqlite3` and `open` packages were already dependencies of `apps/cli`

### For next loop

- T147 (Two-phase shutdown) is now unblocked — depends on T145 (done)
- T143 (Build init interactive flow) remains ready
- T115 (Import discovery endpoint) remains ready — P0

---

## T147: Two-phase Ctrl+C shutdown — DONE

### What was done

1. Created `apps/cli/src/shutdown.ts` — standalone two-phase shutdown module:
   - `countActiveLeases(dbPath)` — polls SQLite for active leases (STARTING, RUNNING, HEARTBEATING, COMPLETING)
   - `drain(dbPath, timeoutMs, deps?)` — polling loop with injectable timer/counter for testability
   - `forceKillChildren(pids)` — sends force signal to tracked PIDs, handles already-dead processes
   - `setupShutdownHandlers(config)` — wires SIGINT/SIGTERM with two-phase logic
   - `childPids` — module-level Set for worker supervisor to populate

2. Modified `apps/cli/src/cli.ts` — replaced inline signal handlers with `setupShutdownHandlers()` call

3. Created `apps/cli/src/shutdown.test.ts` — 22 unit tests covering all exported functions

### Patterns used

- Dependency injection for testability (ProcessHandle, injectable countLeases/sleep)
- Read-only better-sqlite3 connection (same pattern as queryProjectCount)
- Fake process handle with `exit()` returning `undefined as never` to avoid unhandled rejections

### For next loop

- Worker supervisor needs to populate `childPids` when spawning processes (future task)
- T150 (Startup banner) and T143 (Build init interactive flow) are ready
