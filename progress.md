# Progress Log

## T130 — Add Batch Task Import UI to Tasks page (2026-03-13)

### What was done

- Created `BatchCreateDialog.tsx` at `apps/web-ui/src/features/tasks/components/`
  - Monospace JSON textarea for pasting an array of CreateTaskInput objects
  - "Validate" button runs client-side validation: JSON syntax, array check, per-item required field + enum validation
  - Success preview shows task count ("3 tasks ready to create")
  - Validation errors shown as itemized list with per-task error labels (e.g., "Task 1: missing title")
  - "Create Tasks" button submits validated batch via `useCreateTaskBatch` hook
  - Create button label dynamically shows task count after validation
  - Dialog prevents closing during pending mutations, resets state on close
  - Exported `validateJsonInput` and `validateTaskItem` for unit testing
- Created `BatchCreateDialog.test.tsx` — 29 tests covering:
  - Unit tests: `validateTaskItem` (8 tests) and `validateJsonInput` (6 tests)
  - Component tests (15): rendering, button states, JSON validation errors, missing field errors,
    success preview, singular/plural grammar, validation clearing on edit, submission flow,
    API error display, cancel, non-array input, submit button label
- Updated `page.tsx` — added "Create Batch" button with List icon between Import Tasks and Create Task

### Patterns

- Same dialog pattern as CreateTaskDialog: `{ open, onOpenChange }` props, useState form state
- Client-side validation mirrors server-side Zod schema constraints (required fields, enum values, max lengths)
- Validation functions exported separately for direct unit testing outside React context
- `data-testid` attributes on all interactive elements matching codebase convention

### Notes for next loop

- E025 is now complete (8/8 tasks done)
- 3 pending tasks remain (all P2 documentation): T151 (CLI hero docs), T122 (CLI README), T123 (import format docs)

## T128 — Add Create Agent Profile dialog to Pool detail

### Task

T128 - Add Create Agent Profile dialog to Pool detail (Epic E025: Web UI Creation & Editing Forms)

### What was done

- Created `CreateProfileDialog.tsx` following the established CreatePoolDialog pattern
  - 8 optional policy/template ID text input fields (all fields are optional)
  - Form state management with `useState` and `useCallback`
  - Error display in dialog with auto-clear on field edit
  - Form reset on close, submit disabled while pending
  - Scrollable content area for the 8 fields (`max-h-[60vh] overflow-y-auto`)
  - Wired to existing `useCreateAgentProfile(poolId)` mutation hook
  - Empty fields omitted from API payload (whitespace-only treated as empty)
- Created comprehensive test suite (`CreateProfileDialog.test.tsx`, 12 tests)
  - Uses fetch-spy + QueryClientProvider pattern from other dialog tests
  - Tests: rendering, empty submission, partial fill, full fill, whitespace handling,
    API errors, cancel, form reset, error clearing, closed state, endpoint URL
- Modified `PoolDetailPage.tsx` to add "Add Agent Profile" button
  - Button placed in Agent Profiles CardHeader with Plus icon
  - Dialog state managed via `useState`
  - `CreateProfileDialog` rendered with pool ID from URL params

### Patterns

- All dialog components follow the same pattern: `open`/`onOpenChange` props, controlled form
  state, `useCallback` handlers, `data-testid` attributes, error display with auto-clear
- Test pattern: fetch spy, fakeResponse helper, QueryClient+WebSocketProvider+MemoryRouter wrapper

### Notes for next loop

- 4 pending tasks remain (all P2): T130 (batch import UI), T151 (CLI docs), T122 (CLI README), T123 (import format docs)
- E025 is now 7/8 complete (only T130 remains)

## T131 — Add Reassign Pool operator action to Task detail

### Task

T131 - Add Reassign Pool operator action to Task detail (Epic E025: Web UI Creation & Editing Forms)

### What was done

- Added `reassign-pool` to `OperatorActionId` type, `ACTION_DEFS`, and `STATUS_ACTIONS` in `action-definitions.ts`
- Added `reassign-pool` to statuses: BACKLOG, READY, BLOCKED, ASSIGNED, IN_DEVELOPMENT, ESCALATED
- Created `ReassignPoolDialog.tsx` component with pool selector dropdown + reason textarea
  - Fetches pools via existing `usePools({ limit: 100 })` hook
  - Shows loading state while pools load; empty state when no pools available
  - Validates: both pool selection and reason required before submit enabled
  - Resets form on close
- Updated `TaskActionBar.tsx` to wire in `useReassignPool` mutation and `ReassignPoolDialog`
  - Reassign Pool button rendered as a special action (like PriorityChangeSelect and EscalationResolutionPanel)
  - Filtered from regular actions to avoid the generic ConfirmActionDialog
- Updated `index.ts` to export `ReassignPoolDialog`
- Updated existing tests in `operator-actions.test.tsx` for new status action mappings
- Added 3 new unit tests: reassign-pool no confirmation, reassign-pool status coverage across all statuses
- Added 2 integration tests: full dialog submit flow with pool fetch + API call verification, terminal state exclusion

### Patterns used

- Followed the "special action" pattern from PriorityChangeSelect and EscalationResolutionPanel
- Dialog with form state (pool selector + reason) — same Dialog/DialogContent/DialogFooter component pattern
- Native `<select>` for pool dropdown matching CreateTaskDialog's project selector pattern
- Pool data fetched via `usePools` and extracted with `poolsData?.data ?? []`
- `data-testid` attributes on all interactive elements for testing

### Notes for next loop

- Remaining E025 tasks: T128 (Create Profile dialog), T130 (Batch Task Import UI)
- Documentation tasks still ready: T122, T123, T151
- All tasks are P2 with no dependencies

## T129 — Add Edit Task form to Task detail page

### Task

T129 - Add Edit Task form to Task detail page (Epic E025: Web UI Creation & Editing Forms)

### What was done

- Created `EditTaskDialog` component at `apps/web-ui/src/features/task-detail/components/EditTaskDialog.tsx`
- Editable fields: title, description, priority, riskLevel, estimatedSize, externalRef, severity, acceptanceCriteria, definitionOfDone, requiredCapabilities, suggestedFileScope
- Pre-populates form from current task data; array fields joined with newlines for textarea editing
- Only sends changed fields in the update payload (compares form state vs original task)
- Includes `version` field for optimistic concurrency control
- Handles 409 Conflict with clear user-friendly message ("modified by another user")
- Added "Edit" button with Pencil icon to TaskDetailPage header
- 15 comprehensive tests covering pre-population of all fields, null handling, validation, submission with version, dialog close on success, 409 conflict handling, generic error handling, cancel, and saving state feedback
- 2 integration tests added to TaskDetailPage.test.tsx for edit button rendering and dialog opening

### Patterns used

- Same dialog pattern as `CreateTaskDialog`: `{ open, onOpenChange }` props
- `taskToFormState()` helper converts Task to form strings; `buildUpdateInput()` diffs form vs original
- Array fields (acceptanceCriteria, definitionOfDone, etc.) stored as newline-separated strings in form state
- `useEffect` re-populates form when dialog opens or task data changes
- Follows existing selectClasses pattern for native selects matching Input component styling

### Notes for next loop

- All remaining E025 tasks (T128, T130, T131) are independent P2 UI features with no deps
- Documentation tasks (T122, T123, T151) are also ready
- The `useUpdateTask` hook uses `apiPut` (PUT method), not PATCH

## T127 — Add Create Worker Pool dialog to Pools page

### Task

T127 - Add Create Worker Pool dialog to Pools page (Epic E025: Web UI Creation & Editing Forms)

### What was done

- Created `CreatePoolDialog` component at `apps/web-ui/src/features/pools/components/CreatePoolDialog.tsx`
- Fields: name (required), poolType (required, shadcn Select: developer/reviewer/lead-reviewer/merge-assist/planner), provider (optional), model (optional), maxConcurrency (number, default 3), defaultTimeoutSec (number, default 3600)
- Wired to existing `useCreatePool` hook; cache invalidation on success via hook's `onSuccess`
- Added "Create Pool" button with Plus icon to PoolsPage header
- 11 comprehensive tests covering rendering, defaults, validation, submission with required and optional fields, error handling, cancel, form reset, and whitespace-only name rejection
- Added jsdom polyfills for Radix UI Select (`scrollIntoView`, pointer capture methods) to test file

### Patterns used

- Same dialog pattern as `CreateProjectDialog` and `CreateRepositoryDialog`: `{ open, onOpenChange }` props
- shadcn `Select` component for poolType (same pattern as CreateRepositoryDialog's checkout strategy)
- useState-based form state with `INITIAL_FORM_STATE` constant
- `useCallback` for all handlers, `updateField` generic helper that clears errors on change
- `data-testid` attributes on all interactive elements
- fetch-spy + QueryClientProvider + WebSocketProvider test harness

### Notes for next iteration

- Remaining E025 tasks (T128–T131) are all P2 and follow the same dialog pattern
- T128 (Create Agent Profile dialog) may need `poolId` as a prop, similar to how CreateRepositoryDialog receives `projectId`

## T126 — Add Create Repository dialog to Project detail

### Task

T126 - Add Create Repository dialog to Project detail (Epic E025: Web UI Creation & Editing Forms)

### What was done

- Created `CreateRepositoryDialog` component at `apps/web-ui/src/features/projects/components/CreateRepositoryDialog.tsx`
- Fields: name (required), remoteUrl (required, URL validation), defaultBranch (default "main"), localCheckoutStrategy (Select: worktree/clone, default "worktree")
- Wired to existing `useCreateRepository` hook; cache invalidation on success
- Client-side URL validation using native `URL` constructor with inline error hint
- Added "Add Repository" button to dashboard page, visible only when a project is selected via the ProjectSelector
- 18 comprehensive tests covering rendering, defaults, validation, submission, error handling, cancel, and URL validation feedback

### Patterns used

- Same dialog pattern as `CreateProjectDialog`: `{ open, onOpenChange }` props + `projectId` prop
- Form state via `useState` with `updateField` callback, same as all existing dialogs
- fetch-spy testing pattern matching `CreateProjectDialog.test.tsx`
- Conditional rendering of button/dialog on dashboard based on `projectFilter.selectedProjectId`

### Notes for next loop

- No project detail page exists yet — the "Add Repository" button lives on the dashboard, shown when a project is selected
- If a project detail page is created later, the dialog can easily be moved there since it takes `projectId` as a prop
- The `CreateRepositoryDialog` is self-contained and reusable from any page that has a projectId

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
