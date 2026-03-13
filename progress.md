# Progress Log

## T115 — Create POST /import/discover endpoint

### Task

T115 - Create POST /import/discover endpoint (Epic E023: Task Import Pipeline)

### What was done

- Created `apps/control-plane/src/import/` module with full NestJS ImportModule
- `import.controller.ts`: `POST /import/discover` endpoint with Swagger docs, delegates to service
- `import.service.ts`: `discover()` method with auto-detection (backlog.json → JSON parser, else markdown parser), suggested name derivation from directory basename or manifest metadata
- `dtos/discover-request.dto.ts`: Zod-validated DTO with `path` (required) and `pattern` (optional)
- `import.module.ts`: NestJS module registering controller and service
- `import.controller.test.ts`: 4 tests covering delegation, pattern passthrough, format passthrough, error propagation
- `import.service.test.ts`: 7 tests covering non-existent path, JSON discovery, markdown discovery, name derivation, warning passthrough, empty directory, format priority
- Added JSON parser exports (`parseJsonTasks`, `detectJsonFormat`, etc.) to `packages/infrastructure/src/index.ts`
- Registered ImportModule in AppModule

### Patterns used

- Zod DTO with static `schema` property (matches projects DTO pattern)
- `@Inject(ImportService)` on constructor param (tsx compatibility)
- Direct controller instantiation in tests (NestJS DI doesn't work with vitest/esbuild)
- `vi.fn()` for service mocks, cast to real type
- FakeFileSystem implementing full `FileSystem` interface with `readdir()` returning `{ name, isDirectory }` entries
- Constructor-injected `FileSystem` on service for testability, defaults to `createNodeFileSystem()`

### For next loop

- T116 (import execute endpoint) is now unblocked — it writes discovered tasks to the database
- T123 (import format docs) is also ready
- The FakeFileSystem pattern in the service test could be extracted to `@factory/testing` if reused

---

## T113 — Build deterministic markdown task parser

### Task

T113 - Build markdown task parser (Epic E023: Task Import Pipeline)

### What was done

- Created `packages/infrastructure/src/import/markdown-task-parser.ts` with ~550 lines implementing full deterministic markdown parsing
- Key exports: `discoverMarkdownTasks()`, `parseTaskFile()`, `parseMetadataTable()`, `extractSection()`, `extractCheckboxItems()`, `extractDependencyRefs()`, `extractExternalRef()`, `extractFileReferences()`, `mapTaskType()`, `mapPriority()`, `parseIndexFile()`, `applyOrdering()`, `findMarkdownFiles()`
- Created `packages/infrastructure/src/import/index.ts` barrel exports
- Updated `packages/infrastructure/src/index.ts` with import module exports
- Created comprehensive test suite with 68 tests covering all public functions, edge cases, and full pipeline integration
- Uses FileSystem interface for DI (consistent with infrastructure package patterns)
- Lenient parsing: unrecognized types/priorities produce warnings and fall back to defaults rather than failing
- Zod validation via ImportedTaskSchema.safeParse for final validation

### Patterns used

- Functional approach over class-based: pure parsing functions with FileSystem DI only for I/O
- Recursive readdir for file discovery (no glob library needed)
- createFakeFs() test helper for filesystem abstraction in tests
- Non-null assertions on regex capture groups (TypeScript strict mode)
- Type/priority mapping: P0→critical, P1→high, P2→medium, P3→low; foundation/infrastructure→chore, feature→feature, etc.

### For next loop

- T115 (import discovery endpoint) and T123 (import format docs) are now unblocked
- T120 (bundle web-ui static files) and T140 (global data directory convention) are also P0 and ready

---

## T110 — Integration test: lease timeout and crash recovery

### Task

T110 - Integration test: lease timeout and crash recovery (Epic E022: Integration Testing & E2E)

### What was done

- Created `apps/control-plane/src/integration/lease-recovery.integration.test.ts` with 11 integration tests covering all four T110 scenarios:
  1. **Heartbeat timeout → reclaim → retry**: Detects stale leases via FakeClock, reclaims with retry policy, verifies task returns to READY
  2. **Worker crash → CRASHED → retry**: Immediate crash reclaim with CRASHED lease state, retry granted
  3. **Grace period acceptance**: Terminal heartbeat extends lease TTL, result accepted within grace window
  4. **Retry exhaustion → ESCALATED**: Exhausted retries trigger escalation policy, task moves to ESCALATED
- Additional coverage: crash during ASSIGNED (startup crash), active lease negative case, TTL expiry detection, domain event emission, zero-retry policy edge case
- Created in-test HeartbeatUnitOfWork and ReclaimUnitOfWork adapters backed by real SQLite
- Tests use real TransitionService, HeartbeatService, LeaseReclaimService with FakeClock for deterministic time
- Also fixed T111 status discrepancy in backlog index (task file said done, index said pending)

### Patterns used

- Follows the exact integration test pattern from `escalation-triggers-resolution.integration.test.ts`: real SQLite via `createTestDatabase`, real services, direct SQL seeding, audit event verification
- In-test UoW adapters pattern: HeartbeatUnitOfWork and ReclaimUnitOfWork are created as test helpers since no pre-built infrastructure implementations exist yet
- FakeClock injection for deterministic heartbeat staleness: `createHeartbeatService(uow, emitter, () => new Date(clock.now()))`
- Raw SQLite for complex UNION queries in `findStaleLeases` (Drizzle doesn't handle UNION well)

### For next loop

- T088 (queue/worker event broadcasting) is P2 and ready (depends on T086 which is done)
- T096-T100 (UI views) and T104-T105 (operator controls UI) are P2 and ready
- Consider creating permanent HeartbeatUnitOfWork and ReclaimUnitOfWork infrastructure implementations (currently only exist as test helpers)

---

## T098: Build merge queue view (2026-03-12)

### What was done

- Created `GET /merge-queue` backend list endpoint with pagination and status/repositoryId filters
  - `MergeQueueController` + `MergeQueueService` in `apps/control-plane/src/merge/`
  - Joins merge_queue_item with task table for enriched data (task title, task status)
  - Ordered by queue position ascending
  - DTO with Zod validation following existing TaskFilterQueryDto pattern
- Built full merge queue UI page replacing placeholder
  - Table view with position, task link, status badge, enqueued/started/completed times
  - Active merge progress indicator (purple highlight for PREPARING/REBASING/VALIDATING/MERGING items)
  - Queue pause warning when FAILED items exist
  - Status filter bar with all 8 merge queue states
  - Loading skeleton, error state, empty state
  - Click-through task links to `/tasks/:id`
- Added `MergeQueueStatusBadge` component with color-coded statuses
- Added `useMergeQueue` TanStack Query hook + `mergeQueue` query keys
- Updated WebSocket invalidation to include `mergeQueue.all` on Queue channel events and merge_queue_item.state_changed events
- Full test coverage: 7 backend tests (controller + service with in-memory SQLite), 12 frontend tests

### Patterns used

- Backend: Same controller → service → repository pattern as TasksController/TasksService
- Frontend: Same hooks/query-keys/page structure as PoolsPage (T096)
- Tests: Backend uses mocked service (controller) + real SQLite (service). Frontend uses mocked fetch + QueryClient + MemoryRouter.

### For next loop

- T097 (review center view), T099 (config editor), T100 (audit explorer), T104 (operator controls in task detail), T105 (operator controls in pool/merge UI) are remaining pending tasks
- T105 is now unblocked by T098 completion (also needs T096 done + T101 done, both are done)

## T097: Build review center view (2026-03-12)

- Replaced the placeholder review center page with a full implementation
- Created ReviewCycleStatusBadge for the 8 review cycle lifecycle statuses
- Created ReviewVerdictBadge for specialist verdicts and lead decisions
- Created ReviewCycleDetail expandable panel showing packets + lead decision
- Main page fetches tasks in IN_REVIEW and CHANGES_REQUESTED states using existing useTasks hook
- Click-through task rows expand to show review cycle history via useReviewHistory
- Further expansion into cycles shows specialist packets via useReviewCyclePackets
- Status filter bar toggles between IN_REVIEW and CHANGES_REQUESTED
- Warning banner when tasks have changes requested
- Round count warning badge when approaching max review rounds (≥3)
- 15 tests covering rendering, filtering, expand/collapse, loading, error, and empty states
- Followed the merge-queue page pattern: status filter, table, loading/error/empty states
- Reused TaskStatusBadge and TaskPriorityBadge from tasks feature
- Fixed T096 status in backlog index (was done in task file, pending in index)

## T099: Build configuration editor view (2026-03-12)

- Replaced the placeholder config page with a full tabbed configuration editor
- Three tabs: Policies, Pools, Effective Config
- **Policies tab**: Two-panel layout with policy set list (left) and multi-field JSON editor (right). Edits all 6 policy JSON fields (scheduling, review, merge, security, validation, budget). Dirty tracking, reset, save with confirmation dialog, success/error badges.
- **Pools tab**: Two-panel layout with pool list and form editor. Editable fields: name, maxConcurrency, enabled toggle, provider, runtime, model, timeout, token budget, cost profile. JSON editors for capabilities and repoScopeRules.
- **Effective Config tab**: Read-only view of resolved configuration from GET /config/effective with individual layer display and priority labels.
- Created reusable JsonEditor component: textarea-based JSON editor with real-time validation, Format button, error display, and read-only mode
- Created SaveConfirmationDialog: modal confirmation before persisting config changes
- Added shadcn/ui Input, Textarea, and Label primitives
- 35 new tests: 16 for JsonEditor (unit + component), 22 for ConfigPage (page structure, policies tab, pools tab, effective config tab)
- Used userEvent for Radix UI Tab switching in tests (fireEvent.click doesn't trigger Radix pointer events)

### Patterns used

- Two-panel layout: list on left (lg:col-span-1), editor on right (lg:col-span-2)
- Controlled form state with useState, dirty tracking, reset to original values
- useEffect to sync form state when selected entity changes
- Existing API hooks: usePolicies, usePolicy, useUpdatePolicy, usePools, usePool, useUpdatePool, useEffectiveConfig
- Tests: fetch spy with URL-based routing, QueryClient with retry:false, WebSocketProvider with autoConnect:false

### For next loop

- T100 (audit explorer), T104 (operator controls in task detail), T105 (operator controls in pool/merge UI) remain as the last pending tasks
- Prompt template viewer and routing rule display are not yet implemented (no API endpoints exist for prompt templates)

## T112: Define task import Zod schemas — DONE

### What was done

- Created `packages/schemas/src/import/task-import.ts` with four Zod schemas:
  - `ParseWarningSeveritySchema` — enum for warning levels (info/warning/error)
  - `ParseWarningSchema` — structured parser warning with file, field, message, severity
  - `ImportedTaskSchema` — validated task record with title/taskType required, priority defaults to "medium", optional fields for description, riskLevel, estimatedSize, acceptanceCriteria, definitionOfDone, dependencies, suggestedFileScope, externalRef, source, metadata
  - `ImportManifestSchema` — top-level import result with sourcePath, tasks array, warnings array, optional formatVersion/discoveredProjectName/discoveredRepositoryName
- Created `packages/schemas/src/import/index.ts` barrel export
- Added `EstimatedSizeSchema` to `packages/schemas/src/shared.ts` (was missing, domain had the enum but schemas didn't wrap it)
- Updated `packages/schemas/src/index.ts` with new exports
- Created comprehensive test file with 64 tests covering acceptance, rejection, defaults, boundary cases, all enum values

### Patterns used

- `zodEnumFromConst()` helper from shared.ts wraps domain const-objects as Zod enums
- Export both `XxxSchema` and inferred `type Xxx = z.infer<typeof XxxSchema>`
- `.min(1)` for non-empty strings, `.optional()` for truly optional, `.optional().default()` for optional-with-default
- `z.record(z.string(), z.unknown())` for flexible metadata
- Tests use safeParse() for both acceptance and rejection, JSDoc on every test

### For next loop

- T113 (Markdown task parser) and T114 (YAML task parser) are now unblocked by T112
- T119 (Crash recovery) and T135 (Queue worker events) are also P0 ready candidates

## T133: Unit tests for WorkerDispatchService — DONE

- **Status**: Already implemented by a prior session. 11 tests, all passing.
- **Coverage**: No-op (no jobs), happy path (claim→spawn→complete), context resolution failure, spawn failure (Error + non-Error), configuration (default/custom lease owner), job type validation, payload extraction with realistic data.
- **Action taken**: Verified all acceptance criteria are met, updated task status to `done` in task file and backlog index.

## T134: Wire WorkerDispatch unit-of-work adapter — DONE

- **What was done**: Added `createWorkerDispatchUnitOfWork()` factory to `apps/control-plane/src/automation/application-adapters.ts`. This bridges infrastructure database repositories to the `WorkerDispatchUnitOfWork` port from `@factory/application`, enabling the `WorkerDispatchService` to resolve spawn context for tasks.
- **Key implementation details**:
  - Read-only pattern (uses `conn.db` directly, no `writeTransaction`), matching `createReadinessUnitOfWork`/`createSchedulerUnitOfWork`
  - `resolveSpawnContext(taskId)` loads task + repository, builds full `WorkerSpawnContext` with task packet, timeout settings, workspace paths, and policy snapshot
  - Returns `null` for missing tasks, missing repos, or tasks in terminal states (DONE, FAILED, CANCELLED)
  - Task type → packet type mapping: feature/bug_fix/refactor/chore → development_result, documentation → documentation_result, test → test_result, spike → spike_result
  - Repository `remoteUrl` used as `repoPath` (supervisor/workspace manager handles local provisioning)
  - Default timeout constants: 3600s budget, 30s heartbeat, 3 missed threshold, 60s grace period
  - Empty policy snapshot `{}` — policy infrastructure not yet wired
- **Tests**: 17 unit tests in `application-adapters.test.ts` covering success path, missing task/repo, terminal states, all task type mappings, worker name derivation, remoteUrl usage, and JSON array deserialization
- **Build/test**: 4,096 tests pass, zero failures

### For next loop

- T135 (heartbeat forwarder adapter), T136 (infrastructure adapter wiring), T137 (wire dispatch automation) are now unblocked by T134
- T135 and T136 are P0 ready candidates

## T135: HeartbeatForwarderPort Adapter (2026-03-12)

**What was done:**

- Created `apps/control-plane/src/automation/heartbeat-forwarder-adapter.ts` — factory function `createHeartbeatForwarderAdapter()` implementing `HeartbeatForwarderPort`
- Created `apps/control-plane/src/automation/heartbeat-forwarder-adapter.test.ts` — 7 unit tests covering normal forwarding, terminal heartbeats, error swallowing, non-Error throws, actor identity, successive heartbeats, and resilience after errors
- Adapter bridges `forwardHeartbeat(leaseId, workerId, isTerminal)` to `heartbeatService.receiveHeartbeat({ leaseId, completing: isTerminal, actor })` with system actor `{ type: "system", id: "worker-supervisor" }`
- Errors are caught and logged via `logger.warn()` — never propagated to the worker process

**Key design decisions:**

- Used a plain factory function (not a class) matching the existing adapter pattern in `application-adapters.ts`
- Logger is injectable for testing but defaults to `createLogger("heartbeat-forwarder")` for production
- Error details include leaseId, workerId, isTerminal, and error message for diagnosability

**What the next loop should know:**

- T136 (infrastructure adapter wiring) is the next ready P0 task in E009 — it wires WorkspaceManager, PacketMounter, and CopilotCliAdapter
- T137 (wire dispatch into AutomationService) depends on both T135 and T136 being done
- The heartbeat forwarder adapter will be instantiated in T137 when wiring the AutomationService

## T136: Wire workspace, runtime, and packet infrastructure adapters — DONE

**What was done:**

- Added `@factory/infrastructure` as a dependency of `apps/control-plane`
- Created `apps/control-plane/src/automation/infrastructure-adapters.ts` — factory functions that bridge infrastructure classes to application-layer port interfaces
- Created `apps/control-plane/src/automation/infrastructure-adapters.test.ts` — 17 unit tests

**Adapter bridges created:**

1. **`createWorkspaceProviderAdapter(manager)`** → `WorkspaceProviderPort` — maps positional `(taskId, repoPath, attempt?)` to `CreateWorkspaceOptions` and `(taskId, repoPath, options?)` to `CleanupWorkspaceOptions`
2. **`createPacketMounterAdapter(mounter)`** → `PacketMounterPort` — delegates to `WorkspacePacketMounter`, discards `MountPacketsResult` (port returns `void`)
3. **`createRuntimeAdapterBridge(adapter)`** → `RuntimeAdapterPort` — bridges `CopilotCliAdapter` with `SupervisorRunContext` → `RunContext` type cast for nominal type differences (`Record<string, unknown>` ↔ `TaskPacket`/`PolicySnapshot`)
4. **`createInfrastructureAdapters(config, deps?)`** — top-level factory that instantiates `FileSystem`, `GitOperations`, `ProcessSpawner`, creates all three infrastructure classes, and wraps them in adapter bridges
5. **`resolveInfrastructureConfig()`** — reads `WORKSPACES_ROOT` env var with `./data/workspaces` default

**Key design decisions:**

- Factory function pattern (not NestJS providers) — matches existing `application-adapters.ts` and `heartbeat-forwarder-adapter.ts` patterns
- `InfrastructureAdapterDependencies` interface allows test injection of fake filesystem/git/process spawner
- Type bridge uses `as unknown as RunContext` cast — safe because at runtime the objects are valid `TaskPacket`/`PolicySnapshot` instances; the port just carries them as `Record<string, unknown>`

**What the next loop should know:**

- T137 (wire dispatch into AutomationService) is now unblocked — it needs to call `createInfrastructureAdapters()` and pass the resulting ports into `createWorkerSupervisorService()`
- T112 (import schemas, E023) is also P0-ready and independent of E009

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
