# Progress Log

## T096 — Build worker pool monitoring panel

### Task

T096 - Build worker pool monitoring panel (Epic E020: Web UI Feature Views)

### What was done

- Replaced the placeholder `WorkersPage` with a full pool monitoring feature at `apps/web-ui/src/features/pools/`
- **PoolsPage** (list view): Displays all pools as clickable cards in a responsive grid with pool name, type badge, enabled/disabled status badge, max concurrency, provider/model info, and runtime. Includes filter bar for pool type and enabled status.
- **PoolDetailPage** (detail view): Shows pool header with type/status badges, 3 stat cards (workers online, active tasks, max concurrency), full configuration section (provider, model, runtime, cost profile, timeout, token budget, capabilities), worker table with status/task assignment/heartbeat, and agent profiles list with policy badges.
- **Components**: `PoolCard` (clickable summary card), `PoolStatusBadge` (green enabled / gray disabled), `PoolTypeBadge` (color-coded by pool type), `WorkerTable` (workers with status badges and heartbeat times)
- Added `/workers/:id` route for pool detail with lazy loading in `routes.tsx`
- Leveraged existing hooks (`usePools`, `usePool`, `usePoolWorkers`, `useAgentProfiles`) and query keys — no API changes needed
- 25 tests across PoolsPage and PoolDetailPage covering: pool card rendering, count display, type/status badges, provider info, loading skeletons, error states, empty states, navigation links, filter toggle, worker stats, configuration display, capabilities, worker table with status badges, task assignment display, agent profiles with policy badges, back navigation, loading/error/empty states for workers and profiles

### Patterns used

- Card-based grid layout for pool list (responsive: 1/2/3 columns)
- List → detail drill-down via React Router (same pattern as tasks)
- TanStack Query hooks with conditional `enabled` flag for detail queries
- React Router `useParams` for pool ID extraction
- `data-testid` attributes for all testable elements
- Mock fetch with URL pattern matching in tests (same pattern as dashboard tests)

### Notes for next iteration

- T105 (operator controls in pool/merge queue UI) builds on this page — will add enable/disable toggle and concurrency editing
- Pool cards link to `/workers/:id` to stay consistent with existing nav item
- The workers page is now at `features/pools/` but the route remains `/workers` for backward compatibility with existing nav links

## T095 — Build task detail timeline view

### Task

T095 - Build task detail timeline view (Epic E020: Web UI Feature Views)

### What was done

- Created `TaskDetailPage` at `apps/web-ui/src/features/task-detail/TaskDetailPage.tsx` with five tabbed sections
- **Overview tab**: Displays all task metadata (status, priority, type, source, size, risk, capabilities, file scope, acceptance criteria, definition of done, current lease, current review cycle)
- **Timeline tab**: Vertical chronological audit event list with pagination, state transition metadata, actor info
- **Packets tab**: Review cycle sections with expandable specialist review packets and lead decisions, JSON syntax-highlighted viewer
- **Artifacts tab**: Hierarchical tree view with expand/collapse for directories and file type icons
- **Dependencies tab**: Forward (depends on) and reverse (required by) dependency lists with navigable links, dependency type badges, hard/soft block indicators
- Added `/tasks/:id` route to `routes.tsx` with lazy loading
- Updated task table rows to link to detail page via React Router `<Link>`
- Added `TaskDetail`, `TaskDependency`, `TaskLease` types to `api/types.ts`
- Updated `useTask` hook to return enriched `TaskDetail` instead of bare `Task`
- 23 new tests covering all tabs, loading/error/empty states, metadata display, badges, navigation

### Patterns used

- Radix UI Tabs for accessible tabbed interface (shadcn/ui Tabs component)
- TanStack Query hooks for data fetching with conditional `enabled` flag
- URL-based task ID via React Router `useParams`
- `userEvent` (not `fireEvent`) for Radix UI interaction in tests
- Routes + Route wrapper needed in tests for `useParams` to work with MemoryRouter

### Notes for next iteration

- T104 (operator controls) builds on this page — will add action buttons to the detail view
- `userEvent` is required instead of `fireEvent.click` for Radix UI tab switching in tests
- The `useTask` hook now returns `TaskDetail` (enriched) — existing code that used `useTask` should be checked for compatibility

## T071 — Implement summarization packet generation for retries

### Task

T071 - Implement summarization packet generation for retries (Epic E014: Artifact Service)

### What was done

Implemented the `SummarizationService` in `packages/application/src/services/summarization.service.ts` following the existing factory-function + port-based architecture pattern:

- **Ports** (`summarization.ports.ts`): Defined `SummarizationArtifactReaderPort` (reads failed run info + partial work snapshots) and `SummarizationArtifactWriterPort` (stores summaries). Also defined `RetrySummary`, `SummaryFileChange`, `SummaryValidation`, `FailedRunInfo` types.
- **Service** (`summarization.service.ts`): Reads artifacts best-effort (missing data → degraded summary, never throws). Extracts files changed, validations run, failure points, and a human-readable failure summary. Enforces a 2000-character limit via progressive truncation (files → validations → failure points → text fields). Stores summary as artifact. Uses OTel tracing.
- **Tests** (28 tests): Unit tests for all pure extraction functions + integration tests for the full service covering: both sources available, result-only, partial-work-only, no artifacts, reader failures, JSON round-trip, character limit enforcement with large inputs.
- **Exports** added to `packages/application/src/index.ts`.

### Patterns used

- Factory function pattern with `SummarizationDependencies` struct (matching heartbeat, lease, crash-recovery services)
- Port-based architecture: reader/writer ports for artifact I/O
- Best-effort `safeAsync()` for all artifact reads
- Progressive truncation for size bounding
- `SpanStatusCode` imported from `@factory/observability` (not directly from `@opentelemetry/api`)
- Injectable clock for deterministic test timestamps

### Notes for next loop

- T072 (Partial work snapshot on lease reclaim) is the other remaining E014 task — also ready
- The `RetrySummary` type is designed to be used as `TaskPacket.context.prior_partial_work` value
- The `SummarizationArtifactReaderPort` needs infrastructure adapter implementation that reads from ArtifactStore — can be done when wiring the control plane
- `prior_partial_work` field in TaskPacket schema is `z.unknown().nullable()` — no schema change needed to carry `RetrySummary`

## T101 — Implement operator action API endpoints

### Task

T101 - Implement operator action API endpoints (Epic E021: Operator Actions & Overrides)

### What was done

Implemented all 10 operator actions from §6.2 of the additional refinements PRD as REST API endpoints under `POST /tasks/:id/actions/{action}`:

- **State transition actions** (via TransitionService): `pause` (→ESCALATED), `resume` (ESCALATED→ASSIGNED), `requeue` (ASSIGNED/IN_DEV→READY), `force-unblock` (BLOCKED→READY), `cancel` (→CANCELLED)
- **Metadata actions** (direct DB + audit): `change-priority`, `reassign-pool`
- **Operator override actions** (bypass state machine): `rerun-review` (APPROVED/IN_REVIEW→DEV_COMPLETE), `reopen` (DONE/FAILED/CANCELLED→BACKLOG)
- **Merge queue action**: `override-merge-order`

All actions create audit events with `actorType: "operator"`. State machine invariants are respected — only valid transitions are allowed.

### Files created

- `apps/control-plane/src/operator-actions/operator-actions.module.ts`
- `apps/control-plane/src/operator-actions/operator-actions.controller.ts`
- `apps/control-plane/src/operator-actions/operator-actions.service.ts`
- `apps/control-plane/src/operator-actions/dtos/operator-action.dto.ts`
- `apps/control-plane/src/operator-actions/operator-actions.service.test.ts` (34 tests)

### Architecture patterns used

- **Hybrid approach**: TransitionService for state transitions (atomic state change + audit), direct DB for metadata and operator overrides
- **No-op DomainEventEmitter**: Ready for WebSocket gateway (T086/T087) integration later
- **Explicit state pre-validation**: For actions like `resume` where the state machine allows the transition from multiple source states, but the operator action should only be valid from one (ESCALATED)
- **Override pattern**: For transitions not in the state machine (reopen, rerun-review), uses direct DB writes with manual audit events

### Notes for next loop

- T102 (State transition guards for manual actions) is now unblocked
- T103 (Escalation resolution flow) is now unblocked
- The no-op DomainEventEmitter should be replaced with a real implementation once T086 (WebSocket gateway) is done
- The `reassign-pool` action records a pool hint via audit events — when pool assignment columns are added to the task table, this should be updated to persist the hint directly

## T072 — Implement partial work snapshot on lease reclaim

### Task

T072 - Implement partial work snapshot on lease reclaim (Epic E014: Artifact Service)

### What was done

Implemented infrastructure adapters for crash recovery partial work snapshot capture in `packages/infrastructure/src/crash-recovery/`:

- **WorkspaceInspector**: Reads filesystem-persisted result packets, git diffs, modified files, and output files from a workspace. Best-effort — gracefully returns empty/partial results if workspace is missing or corrupted.
- **CrashRecoveryArtifactAdapter**: Stores crash recovery artifacts via `ArtifactStore` using the §7.11 directory layout. Writes partial work snapshots as JSON artifacts with proper path construction.
- **ResultPacketValidator**: Validates result packet content against `DevResultPacketSchema`. Returns structured validation results (valid/invalid with error details).

33 new tests covering all three adapters.

Added `@factory/application` as a dependency to `@factory/infrastructure` — this is a valid inward dependency in clean architecture (infrastructure depends on application ports/interfaces).

### Patterns used

- Port-adapter pattern with dependency injection (adapters implement application-layer port interfaces)
- `FakeFileSystem` and `FakeGitDiffProvider` fakes for testing without real I/O
- Best-effort error handling throughout — workspace may be in any state after a crash, so all reads are defensive and never throw

### Notes for next loop

- The `CrashRecoveryLeasePort` (DB adapter for updating `partial_result_artifact_refs`) still needs an implementation in `apps/control-plane`
- The lease reclaim service does not yet call the crash recovery service — integration wiring is needed

## T078 — Implement Prometheus metrics endpoint

### Task

T078 - Implement Prometheus metrics endpoint (Epic E016: Observability)

### What was done

Implemented the Prometheus /metrics endpoint with two components:

1. **`packages/observability/src/metrics.ts`** — Core metrics module:
   - `initMetrics(config?)` initializes a prom-client Registry with optional default Node.js metrics and default labels
   - `getMetricsHandle()` singleton accessor for the active registry
   - `createCounter()`, `createHistogram()`, `createGauge()` factory functions that register on the active registry
   - `resetMetrics()` for test cleanup
   - Full JSDoc with examples referencing §10.13 naming and label conventions

2. **`apps/control-plane/src/metrics/`** — NestJS controller and module:
   - `MetricsController` exposes GET /metrics with Swagger docs and Cache-Control: no-store
   - `MetricsModule` initializes the metrics subsystem via factory provider and exports `METRICS_HANDLE` token for DI
   - Registered in AppModule alongside existing feature modules

3. **Tests:**
   - `packages/observability/src/metrics.test.ts` — 14 tests covering init, singleton, default metrics, custom prefix, default labels, reset, counter/histogram/gauge creation with labels
   - `apps/control-plane/src/metrics/metrics.controller.test.ts` — 3 tests covering controller delegation to MetricsHandle

Also fixed T072 backlog index status (was `pending` but task file was `done`).

### Patterns used

- Metrics core in `@factory/observability` matching the existing tracing/logging pattern
- NestJS DI via Symbol-based injection token (`METRICS_HANDLE`)
- Factory provider in module for singleton initialization
- Fake MetricsHandle in controller tests (no real prom-client needed)

### Notes for next loop

- T079 (starter metrics inventory) is now unblocked — it should use the `createCounter`, `createHistogram`, `createGauge` factories to register the §10.13.3 metrics
- The `METRICS_HANDLE` is exported from MetricsModule for other modules to inject when registering custom metrics
- Label cardinality rules from §10.13.4 must be followed: never use task_id, run_id, or branch_name as Prometheus labels

---

## T089: Initialize React SPA with Vite, Tailwind, shadcn/ui — DONE

**Date:** 2026-03-12

### What was done

- Transformed the empty `apps/web-ui` skeleton into a full Vite + React + TypeScript SPA
- Configured Tailwind CSS v3 with shadcn/ui CSS variables (light/dark theme support)
- Installed and configured shadcn/ui component primitives: Button, Card, Badge, Table, Dialog, Tabs
- Set up React Router v7 with lazy-loaded routes and code splitting
- Created app shell layout with sidebar navigation (Dashboard, Tasks, Workers, Reviews, Merge Queue, Config, Audit Log)
- Created dashboard placeholder page with status cards
- Added Vite proxy config for API (`/api`) and WebSocket (`/socket.io`) forwarding to backend
- Added comprehensive tests: 7 test files covering cn() utility, Button, Card, Badge, Table, Tabs components, and App routing
- All 3,581 tests pass, build succeeds (Vite produces 315KB bundle), lint clean

### Patterns used

- shadcn/ui components use relative imports (not `@/` path alias) for Vitest workspace compatibility
- Vitest jsdom environment set via `// @vitest-environment jsdom` docblock in each test file
- `@testing-library/jest-dom/vitest` imported directly in each test file for custom matchers
- `defineProject` from `vitest/config` for workspace mode compatibility
- `emitDeclarationOnly: true` in tsconfig — tsc handles type checking, Vite handles bundling
- `moduleResolution: "bundler"` and `module: "ESNext"` for Vite compatibility (overrides base NodeNext)

### Notes for next loop

- T090 (API client with TanStack Query), T091 (WebSocket client), T092 (App shell) are now unblocked
- Dashboard page has placeholder cards — wire up real data in T090
- shadcn/ui components.json is configured for future `npx shadcn add` usage
- PostCSS + Tailwind config follows standard shadcn/ui setup
- React Router v7 is installed (package name is still `react-router-dom`)

## T090: Implement API client layer with TanStack Query

**Date:** 2026-03-12
**Status:** Done

### What was done

- Installed `@tanstack/react-query` in `apps/web-ui`
- Created `src/api/client.ts` — typed fetch wrapper with JSON handling, error extraction, 204 support
- Created `src/api/types.ts` — comprehensive API response types matching all control-plane DTOs
- Created `src/api/query-keys.ts` — centralized query key factory for predictable cache invalidation
- Created `src/api/provider.tsx` — `ApiProvider` with `QueryClientProvider` (30s staleTime, 1 retry)
- Created query + mutation hooks for all entities:
  - Projects, Repositories, Tasks (with 11 operator actions), Pools, Agent Profiles, Reviews, Audit, Policies, Health
- Created 11 test files with 67 new tests covering client, provider, query keys, and all hooks
- Updated `App.tsx` to wrap router with `ApiProvider`

### Patterns used

- TanStack Query key factory pattern (all → lists → detail hierarchy)
- `mockImplementation` for fetch mocks (Response body can only be read once)
- `createWrapper()` helper for hook tests with isolated QueryClient per test
- Conditional queries via `enabled: !!id` for optional parameters
- Cache invalidation on mutation success via `queryClient.invalidateQueries`

### Notes for next loops

- Base URL defaults to `/api` — Vite proxy forwards to backend at localhost:3000
- Hook tests use jsdom environment — add `// @vitest-environment jsdom` docblock
- All hooks re-exported from `src/api/hooks/index.ts` and `src/api/index.ts`
- Types are manually maintained — consider OpenAPI codegen if backend DTOs drift
- T091 (WebSocket) and T092 (App Shell) are now unblocked

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
