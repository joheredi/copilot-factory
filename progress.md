# Progress Log

## T119: Scaffold CLI Workspace (2026-03-12)

**What was done:**

- Created `apps/cli/package.json` — `@copilot/factory` package with `bin.factory` pointing to `./dist/cli.js`, workspace dependency on `@factory/control-plane`
- Created `apps/cli/tsconfig.json` — extends base config with `composite: true`, references control-plane
- Created `apps/cli/src/cli.ts` — shebang-bearing entry point with startup banner (version 0.1.0)
- Updated root `tsconfig.json` — added `apps/cli` project reference
- Verified: `pnpm install` succeeds, `pnpm build` compiles CLI, `node apps/cli/dist/cli.js` prints banner, all 4,079 tests pass

**Key design decisions:**

- Followed the `worker-runner` workspace pattern (simplest app pattern) rather than control-plane (NestJS-specific)
- Package name is `@copilot/factory` (not `@factory/cli`) per task spec — this is the public npm package name
- No test/test:watch scripts added since there's no test-worthy logic yet (T121 will add CLI logic)

**What the next loop should know:**

- T119 unblocks T120 (bundle-web-ui) and T121 (cli-entry-point)
- The `apps/cli` workspace is covered by the `apps/*` glob in both `pnpm-workspace.yaml` and `vitest.workspace.ts`
- The `@factory/control-plane` dependency means CLI must be built after control-plane in the project reference graph

## T132: Implement WorkerDispatchService (2025-07-17)

**What was done:**

- Created `packages/application/src/ports/worker-dispatch.ports.ts` — defines `WorkerDispatchUnitOfWork`, `WorkerDispatchContextPort`, `WorkerSpawnContext`, and transaction repository interfaces
- Created `packages/application/src/services/worker-dispatch.service.ts` — implements `createWorkerDispatchService()` factory, `processDispatch()` async method, `ProcessDispatchResult` discriminated union, `DispatchPayload` type
- Created `packages/application/src/services/worker-dispatch.service.test.ts` — 11 tests covering no-op (no job available), happy path (claim→resolve→spawn→complete), context resolution failure (null → fail job), spawn failure (error → fail job), configuration (custom lease owner), and payload correctness
- Updated `packages/application/src/index.ts` — exports all new types and factory

**Key design decisions:**

- **Not self-rescheduling**: Unlike scheduler-tick and reconciliation-sweep, WORKER_DISPATCH jobs are created on-demand by the scheduler. No `initialize()` method needed.
- **Context resolution port**: `WorkerDispatchContextPort.resolveSpawnContext(taskId)` returns the full `WorkerSpawnContext` (repoPath, workerName, runContext) or null. The infrastructure adapter (T136) will implement the DB lookups.
- **Async service**: `processDispatch()` is async because `spawnWorker()` returns a Promise. The caller handles fire-and-forget with error logging.
- **System actor**: Dispatch uses `{ type: "system", id: "worker-dispatch" }` for audit trails.

**What the next loop should know:**

- T132 unblocks T133 (NestJS dispatch controller), T134 (heartbeat forwarder adapter), and T139 (dispatch integration tests)
- The `WorkerDispatchContextPort` needs an infrastructure adapter (T136) that queries task → project → repository to build `WorkerSpawnContext`
- All 4,015 tests pass after this change

## T105: Integrate operator controls into pool and merge queue UI (2026-03-12)

**What was done:**

- Created `PoolToggle` component — enable/disable toggle with confirmation dialog for disable (disruptive action), immediate enable
- Created `ConcurrencyEditor` component — inline number input with save/cancel, keyboard shortcuts (Enter/Escape), range validation (1–100)
- Created `ResumeQueueButton` component — requeues all failed merge queue items with confirmation, reports success/error counts
- Created `QueueItemActions` component — per-item reorder (move up/down) for ENQUEUED/REQUEUED items, requeue for FAILED items, with confirmation dialogs
- Integrated controls into `PoolDetailPage` (toggle in header, inline concurrency editor in stats)
- Integrated controls into `MergeQueuePage` (resume button in pause warning, per-item actions in table)
- Added `ActionFeedbackBanner` + `useActionFeedback` to both pages for success/error feedback
- 35 new tests covering all controls, confirmation flows, API calls, and edge cases

**Patterns used:**

- Reused `ConfirmActionDialog` from T104 for consistency across all operator actions
- Reused `ActionFeedbackBanner` + `useActionFeedback` hook for inline feedback (no toast dependency)
- Used `useUpdatePool` mutation for pool toggle/concurrency, direct `apiPost` for operator actions
- Per-item actions use confirmation dialogs with required reason for audit trail

**Next loop should know:**

- All 111 backlog tasks are now `done`. The backlog is complete.
- The pool toggle and concurrency editor use `useUpdatePool` (PUT /pools/:id)
- Merge queue resume/reorder use task-level operator action endpoints (POST /tasks/:id/actions/\*)
- The `merge-queue/components/` directory was newly created for queue action components

## T092: Build app shell with navigation layout (2026-03-12)

**What was done:**

- Enhanced `apps/web-ui/src/app/layout.tsx` with responsive sidebar (collapses on mobile with hamburger toggle), breadcrumbs header bar, and WebSocket connection status indicator
- Created `src/components/layout/breadcrumbs.tsx` — route-aware breadcrumb trail using React Router location
- Created `src/components/layout/connection-status.tsx` — WebSocket connection indicator (connected/disconnected states with accessible ARIA attributes)
- Created 6 placeholder feature pages: tasks, workers, reviews, merge-queue, config, audit
- Updated `src/app/routes.tsx` with lazy-loaded routes for all 7 views
- Added comprehensive tests for layout, breadcrumbs, and connection status (25 new tests)
- Fixed test cleanup issue: vitest workspace mode from root doesn't load per-project setupFiles; added explicit `afterEach(cleanup)` to test files

**Patterns used:**

- React Router NavLink with `isActive` for sidebar highlighting
- Lucide icons for navigation items and connection status
- Tailwind responsive classes (`md:hidden`, `md:static`, etc.) for sidebar collapse
- `aria-label`, `aria-live="polite"`, `aria-current="page"` for accessibility
- `afterEach(cleanup)` from @testing-library/react in each test file (required for vitest workspace mode)

**What next loop should know:**

- ConnectionStatus currently hardcoded to `connected={false}`. T091 (WebSocket client) will wire it to real state.
- All 6 feature pages are placeholders — T093-T100 implement the actual views.
- Test cleanup must be explicit in web-ui test files (add `afterEach(cleanup)` import from vitest + @testing-library/react).

## T091: Implement WebSocket client for live updates — DONE

**What was done:**

- Installed `socket.io-client` in `apps/web-ui`
- Created `src/lib/websocket/` module with 5 files:
  - `types.ts` — ConnectionState, FactoryEvent, EventChannel, WebSocketContextValue (mirrors backend types)
  - `invalidation.ts` — Maps event channels/types to TanStack Query cache invalidation keys
  - `provider.tsx` — WebSocketProvider (React context, socket.io lifecycle, auto-subscribe to all channels)
  - `use-websocket.ts` — Hook for accessing connection state + subscribe/unsubscribe
  - `index.ts` — Barrel exports
- Updated `ConnectionStatus` component from boolean `connected` prop to `status: ConnectionState` (connected/reconnecting/disconnected) with three visual states (green/amber-pulsing/red)
- Updated `App.tsx` to wrap with WebSocketProvider inside ApiProvider
- Updated `AppLayout` to use `useWebSocket()` hook for real connection status
- Created 3 test files with 20+ tests covering invalidation mapping, provider lifecycle, and hook behavior
- Updated existing `connection-status.test.tsx` and `layout.test.tsx` for new API
- All 3,685 tests pass, lint clean

**Key design decisions:**

- Context-based provider pattern (matches existing ApiProvider) — single shared connection
- Auto-subscribe to all 3 channels (tasks, workers, queue) on connect for broad cache invalidation
- Channel-level invalidation (not per-entity) for correctness; TanStack Query dedup prevents excess refetch
- Event-type extras (e.g., task.state_changed also invalidates pools) for cross-entity effects
- socket.io-client with WebSocket+polling transports, exponential backoff reconnection
- autoConnect=false prop for test isolation without real connections

**Patterns used:**

- vi.mock for socket.io-client with \_simulateEvent helper for testing connection lifecycle
- QueryClient injection in tests via fresh instances
- renderHook from @testing-library/react for hook isolation tests

## T093: Build dashboard view with system health summary — DONE

**What was done:**

- Replaced placeholder dashboard page with fully data-driven implementation
- Created `useDashboardData` aggregation hook that fires parallel queries for 15 task statuses (limit=1 each for efficient count extraction), pools, and audit events
- Created `TaskSummaryCards` component — 4 colour-coded cards showing Active, Queued, Completed, and Needs Attention counts
- Created `WorkerPoolSummaryCard` component — shows total pools, enabled pools, and aggregate max concurrency
- Created `RecentActivityFeed` component — shows last 10 audit events with type badges and relative timestamps
- Added `TotalTasksCard` in page — shows total tasks across all statuses with "Live" badge
- Error alert displayed when API is unreachable
- Loading skeletons shown while data is fetching
- Empty state for activity feed on fresh systems
- 21 new tests across 3 test files (page.test.tsx, use-dashboard-data.test.tsx, recent-activity-feed.test.tsx)
- All 3,707 tests pass (152 test files)

**Key design decisions:**

- Client-side aggregation approach (no backend changes needed) using existing endpoints
- Task statuses grouped into 4 operator-facing categories: Active (6 states), Queued (3 states), Completed (1 state), Needs Attention (5 states)
- limit=1 per status query to minimise payload — only `total` count from PaginatedResponse is used
- staleTime=15s for task counts (aggressive refresh) vs 30s for pools (less volatile)
- WebSocket-driven cache invalidation already handles live updates via existing infrastructure

**Patterns used:**

- `useQueries` for parallel task status count queries
- data-testid attributes on all key elements for reliable test selectors
- vi.stubGlobal("fetch") pattern for API mocking in tests
- QueryClient with retry:false and gcTime:0 in test wrappers
- `// @vitest-environment jsdom` docblock + explicit `afterEach(cleanup)` for web-ui tests

**For next loop:**

- T094 (task board) and T095 (task detail) are ready and share similar patterns
- The `useTasks` hook already supports filtering/pagination needed for the task board
- Consider adding a dedicated backend summary endpoint later for efficiency

## T094: Build task board with status filtering and pagination — DONE

**What was done:**

- Replaced placeholder task board page with full implementation
- Created `features/tasks/hooks/use-task-filters.ts` — URL-synced filter/pagination state hook
- Created `features/tasks/components/task-status-badge.tsx` — Color-coded status badges grouped by lifecycle phase
- Created `features/tasks/components/task-priority-badge.tsx` — Color-coded priority badges
- Created `features/tasks/components/task-filters.tsx` — Toggle button filters for status, priority, and task type
- Created `features/tasks/components/task-table.tsx` — Sortable data table with loading skeleton and empty state
- Created `features/tasks/components/pagination-controls.tsx` — Page navigation with size selector
- Updated `features/tasks/page.tsx` — Full task board with filters, table, and pagination
- Created `features/tasks/page.test.tsx` — 15 tests covering all acceptance criteria
- All 3,722 tests pass (153 test files)

**Key patterns used:**

- Filter state in URL search params via `useSearchParams` for shareable/bookmarkable URLs
- Client-side sorting (API lacks sort params) with column header toggles
- Status color categories matching dashboard's state groupings (active=blue, review=purple, queued=amber, success=green, error=red, blocked=orange)
- Toggle button UX instead of Select (no Select component in UI library)
- Follows dashboard page pattern: data-testid attributes, loading skeletons, error alerts

**For next loop:**

- T095 (task detail timeline) is now ready and shares the same API types
- T096-T100 (other UI views) are also ready in parallel
- T104 (operator controls in task detail) is now unblocked by T094+T095
- Consider adding a Select/Combobox shadcn component for more compact filter UIs in future views

## T111 — Integration test: escalation triggers and resolution

### Task

T111 - Integration test: escalation triggers and resolution (Epic E022: Integration Testing & E2E)

### What was done

- Created `apps/control-plane/src/integration/escalation-triggers-resolution.integration.test.ts` with 11 integration tests
- **Escalation trigger tests:**
  - Max retry exceeded → ESCALATED (verifies `shouldEscalate` policy evaluation + state machine transition)
  - Max review rounds exceeded → ESCALATED (drives task to IN_REVIEW, then escalates)
  - Policy violation → ESCALATED (immediate escalation for security violations)
- **Operator resolution tests:**
  - Retry → ASSIGNED (with audit metadata verification)
  - Retry with pool reassignment (verifies separate pool audit event)
  - Cancel → CANCELLED (with resolution reason in audit)
  - Mark done → DONE (with evidence and elevated audit severity)
- **State machine invariant tests:**
  - Full trigger → resolution cycle with complete audit trail
  - Terminal state escalation prevention (DONE, FAILED, CANCELLED)
  - Non-operator resolution rejection (human-in-the-loop enforcement)
  - Domain event emission for escalation transitions

### Patterns used

- Follows T107/T108 integration test pattern: real SQLite, real TransitionService, real OperatorActionsService
- `asDatabaseConnection()` adapter wraps `TestDatabaseConnection` to add `healthCheck()` for `OperatorActionsService` compatibility
- `extractStatus()` helper parses JSON-encoded audit event states (e.g., `{"status":"ESCALATED","version":5}` → `"ESCALATED"`)
- Helper functions `driveTaskToInDevelopment()` and `driveTaskToInReview()` reuse the T107/T108 lifecycle transition patterns
- Domain policy verification (`shouldEscalate`) combined with state machine transitions for trigger tests

### For next loop

- T109 (merge conflict/failure paths) and T110 (lease timeout/crash recovery) are P1 and ready
- T096-T100 (UI views) are P2 and ready
- T104 (operator controls in task detail UI) depends on T096/T098 which are still pending

## T109: Integration test — merge conflict and failure paths (done)

### What was done

Added 12 integration tests in `apps/control-plane/src/integration/merge-conflict-failure.integration.test.ts` covering four merge failure scenarios:

1. **Conflict classification policy** (3 tests): Verified `classifyConflict()` correctly classifies reworkable vs non-reworkable conflicts based on file count threshold (default: 5) and protected paths (.github/, package.json, pnpm-lock.yaml).

2. **Reworkable conflict → CHANGES_REQUESTED** (1 test): Full merge executor flow with fake git ops simulating 2-file rebase conflict. Verified task transitions to CHANGES_REQUESTED, merge queue item to REQUEUED, and audit events recorded.

3. **Non-reworkable conflict → FAILED** (2 tests): Full merge executor flow with 6+ files or protected paths in conflict. Verified task and merge queue item both transition to FAILED.

4. **Post-merge validation severity classification** (4 tests): Verified `classifyFailureSeverity()` for high (1 required failure), critical (security or ≥3 failures), and low (optional only) severity levels.

5. **High severity post-merge failure** (1 test): Full post-merge validation service with fake runner returning 1 required failure. Verified task → FAILED, operator notified, queue NOT paused.

6. **Critical post-merge failure** (1 test): Full post-merge validation service with security + multiple required failures. Verified task → FAILED, revert task created with correct origin/project/repo IDs, merge queue paused, operator notified with requiresAction=true.

### Patterns used

- Custom `MergeExecutorUnitOfWork` adapter with raw SQL for full `MergeExecutorItem` fields (the general `createSqliteUnitOfWork` strips merge queue item fields to only id/status)
- Custom `PostMergeUnitOfWork` adapter with raw SQL task repo (joins task+repository for projectId) and injected fake follow-up task port
- Shared `createRawAuditEventRepo()` for consistent audit event persistence
- `extractStatus()` handles both JSON state objects (`{ status: "..." }`) and plain status strings
- Tracking fakes for queue pause, notifications, and follow-up task creation
- Configurable fake git ops and validation runner for deterministic failure scenarios

### For next loop

- T110 (lease timeout/crash recovery) is P1 and ready
- T096-T100 (UI views) and T104-T105 (operator controls UI) are P2 and ready

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
