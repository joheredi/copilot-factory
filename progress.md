# Progress Log

## T122 — Write CLI and import documentation

### Task

T122 - Write CLI and import documentation (Epic E024: CLI Package & Single-Command Startup)

### What was done

- Created `apps/cli/README.md` — comprehensive CLI reference documenting both commands (`factory init` and `factory start`), all flags, environment variables, data directory layout, shutdown behavior, the `.copilot-factory.json` marker file, troubleshooting, and links to further reading.
- Added "Importing Tasks" subsection to `docs/user-guide.md` §5 (Managing Tasks) covering:
  - The 4-step web UI import dialog flow (path input → preview/select → confirm → results)
  - CLI init task import flow
  - Supported formats table (JSON and Markdown) with link to `TASK_FORMAT.md`
  - Import REST API endpoints (`POST /import/discover`, `POST /import/execute`) with curl examples
  - Import behavior notes (deduplication by externalRef, dependency wiring, atomic transactions, BACKLOG status)
- Updated `docs/backlog/tasks/T122-cli-readme.md` status to `done`
- Updated `docs/backlog/index.md` — E024 now 4/4 done, 24/27 epics complete, no pending tasks remain

### Notes for next loop

- All 27 epics have active tasks fully complete. The backlog has no remaining `pending` tasks.
- E024 (CLI Package) is now fully complete (T119, T120, T121, T122 all done).
- The README Quick Start and user-guide CLI sections were already written by T151 — T122 only needed the CLI README and import docs.

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

---

## T144 — Make init safe to re-run (2026-03-13)

- Made `factory init` fully idempotent by reading `.copilot-factory.json` marker file at startup
- If marker file exists, uses stored projectId/repositoryId to find existing DB records and UPDATE metadata instead of INSERT
- If marker file is missing but DB has the project (by name), falls through to ON CONFLICT path which also updates metadata
- Repository re-init updates name, remote_url, and default_branch
- Added 5 new tests: metadata update on re-init, repository update, re-init without marker, task dedup on re-import, and the existing re-init test was updated to check for "updating" message
- All 4,390 tests pass, lint clean
- Pattern: `insertProject()` and `insertRepository()` extracted as helper functions for cleaner control flow

---

## T148 — Log recovery status on startup (2026-03-13)

- Created `StartupDiagnosticsService` implementing `OnApplicationBootstrap` lifecycle hook
- Service runs three COUNT queries on startup to detect: stale leases (heartbeat > 75s old), orphaned jobs (CLAIMED/RUNNING > 10min old), stuck tasks (ASSIGNED > 5min old)
- Thresholds match reconciliation sweep defaults (`DEFAULT_STALENESS_POLICY`, `DEFAULT_ORPHANED_JOB_TIMEOUT_MS`, `DEFAULT_STUCK_TASK_TIMEOUT_MS`)
- Clean startup: logs "Clean startup — no pending recovery items" at INFO
- Recovery needed: logs counts at WARN with note that reconciliation will process within 60s
- Error handling: catches and logs any database errors so diagnostics never block app startup
- Created `StartupDiagnosticsModule` registered in `AppModule`
- 15 unit tests covering: empty DB, recent vs stale leases, completed leases excluded, orphaned jobs by status, stuck tasks by status, combined scenario, bootstrap error handling
- All 4,405 tests pass, build clean
- Pattern: direct service instantiation with `createTestDatabase()` — no NestJS testing module needed
- Uses raw SQLite `conn.sqlite.prepare()` for simple COUNT queries (more efficient than Drizzle for pure counts)

## T149 — Clean orphaned worktrees on start

### Task

T149 - Clean orphaned worktrees on startup (Epic E027: Factory Lifecycle & Recovery)

### What was done

- Created `WorkspaceCleanupService` in `apps/control-plane/src/workspace-cleanup/`
- NestJS service implementing `OnApplicationBootstrap` — runs once after all modules are initialized
- Scans `{WORKSPACES_ROOT}/{repoId}/{taskId}/` directories and cross-references with DB leases
- Orphaned worktrees (no non-terminal lease) older than retention period → auto-deleted
- Recent orphans → logged as "pending cleanup in N days"
- Active-leased worktrees → never deleted (primary safety invariant)
- Created `WorkspaceCleanupModule` registered in `AppModule` after `StartupDiagnosticsModule`
- 17 unit tests covering: empty/missing dir, active lease protection (all 7 non-terminal statuses), orphan deletion (no lease, terminal-only leases, multi-repo), retention period (boundary, zero, default), mixed scenarios, error isolation, bootstrap safety, summary counts, freed bytes tracking, non-directory entry skipping
- Configurable via `WORKSPACE_RETENTION_DAYS` env var (default 7 days) and `WORKSPACES_ROOT` env var

### Patterns used

- Follows `StartupDiagnosticsService` pattern: `@Inject(DATABASE_CONNECTION)`, direct SQL queries, error-swallowing `onApplicationBootstrap()`
- `CleanupFileSystem` interface abstracts Node.js `fs` for deterministic testing
- Fake filesystem helper (`createFakeFs`) for path-based directory tree simulation
- Terminal lease statuses (`COMPLETING`, `RECLAIMED`) match domain enum values
- `cleanOrphanedWorkspaces(options?)` exposes all config for testing while `onApplicationBootstrap()` uses env var defaults

### Notes for next iteration

- T149 completion unblocks T151 (Document the CLI hero experience)
- Remaining E027 tasks: T149 (done), T151 (pending/docs)
- The `WORKSPACES_ROOT` env var defaults to `./data/workspaces` (matching infrastructure-adapters.ts)

## T151 — Document the CLI hero experience

### Task

T151 - Document the CLI hero experience (Epic E027: Factory Lifecycle & Recovery)

### What was done

- Added a **Quick Start** section to root `README.md` showing the `npx @copilot/factory init` + `start` two-command flow, positioned between Architecture and Repository Structure for immediate visibility.
- Renamed the README's "Getting Started" section to "Development Setup" with a note directing operators to Quick Start.
- Rewrote `docs/user-guide.md` section 3 ("Getting Started") to be CLI-first with comprehensive subsections:
  - **Quick Start** — two-command hero scenario
  - **`factory init`** — auto-detection table (project name, git remote, default branch, owner), 7-step flow, example output, idempotency behavior
  - **`factory start`** — all 5 flags with defaults, 9-step startup sequence, banner format, usage examples
  - **Shutdown & Recovery** — two-phase Ctrl+C (graceful drain + force kill), active worker outcome table, recovery guarantees (stale leases 75s, orphaned jobs 10m, stuck tasks 5m), crash recovery artifacts
  - **Global Data Directory** — `~/.copilot-factory/` tree layout, `FACTORY_HOME` override
  - **`.copilot-factory.json` Marker File** — JSON schema, field descriptions, `.gitignore` tip
  - **Multi-Project Support** — project selector in dashboard, URL persistence
  - **Environment Variables** — full table with 8 variables including `FACTORY_HOME`, `WORKSPACE_RETENTION_DAYS`
  - **Developer Setup** — preserved original clone/install/dev-server instructions for contributors
- Updated E027 epic table (T151 → done, 7/7 complete)
- Updated backlog index: E027 7/7, progress counter 23/27, removed T151 from ready-now list

### Patterns used

- All documentation sourced from actual implementation code (cli.ts, startup.ts, shutdown.ts, paths.ts, detect.ts, init.ts, startup-diagnostics, workspace-cleanup)
- Verified default port (4100), drain timeout (30s), retention period (7 days) from source constants
- Kept developer setup section for contributors while making operator flow the default path

### Notes for next iteration

- E027 is now fully complete (7/7 tasks done)
- T122 (CLI and import documentation, E024) is the only remaining ready-now task
- E024 still shows 0/4 done in index but T122 is listed as ready — may need index reconciliation
