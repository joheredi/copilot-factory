# Progress Log

## T104 — Integrate operator controls into task detail UI

### Task

T104 - Integrate operator controls into task detail UI (Epic E021: Operator Actions & Overrides)

### What was done

Added a complete operator action bar to the task detail page with state-dependent controls:

- **action-definitions.ts**: Maps each of 16 task statuses to valid operator actions with metadata (label, variant, confirmation requirement, description). Mirrors backend guards.
- **TaskActionBar.tsx**: Main orchestration component that renders state-dependent buttons, priority selector, escalation resolution panel, and feedback banners. Wires up all 11 TanStack Query mutation hooks.
- **ConfirmActionDialog.tsx**: Reusable confirmation modal with reason textarea (required for audit trail), optional in-progress work acknowledgment checkbox (for cancel on IN_DEVELOPMENT).
- **EscalationResolutionPanel.tsx**: Three-button panel (Retry, Cancel, Mark Done) for ESCALATED tasks, each with a tailored dialog. Mark Done requires evidence field.
- **PriorityChangeSelect.tsx**: Inline native select for priority changes (no confirmation needed, fires immediately).
- **ActionFeedbackBanner.tsx**: Dismissible success/error banner with auto-dismiss after 5s. No toast library needed.
- **use-action-feedback.ts**: Hook managing feedback state with timer cleanup.
- **35 new tests** across 2 test files covering action definitions per status, component rendering, dialog interactions, and full integration with API mocking.

### Patterns used

- Existing TanStack Query mutation hooks from `use-tasks.ts` (already had all 11 operator action hooks)
- Radix Dialog from existing `components/ui/dialog.tsx`
- Native HTML select for priority (avoids adding @radix-ui/react-select dependency)
- Inline feedback banners instead of toast library (keeps dependencies minimal)
- `data-testid` attributes on all interactive elements for testability

### Notes for next loop

- T105 (operator controls for pool/merge queue UI) is the only remaining pending task
- The `OPERATOR_ACTOR_ID` in TaskActionBar is hardcoded as "operator" — should be replaced with real auth identity when authentication is integrated
- Override merge order currently defaults to position 1 — could be enhanced with a position input field in the confirmation dialog

## T100 — Build audit explorer view

### Task

T100 - Build audit explorer view (Epic E020: Web UI Feature Views)

### What was done

Replaced the placeholder audit page with a full-featured audit explorer:

- **Filter hook** (`use-audit-filters.ts`): URL-synced filter state for entity type/ID, event type, actor type/ID, time range, and pagination. Follows the `useTaskFilters` pattern.
- **Filter bar** (`audit-filters.tsx`): Toggle buttons for entity type, event type, actor type; text inputs for entity/actor ID; datetime inputs for time range; clear-all with active count badge.
- **Event table** (`audit-event-table.tsx`): Timeline table with expandable detail rows. Shows time, entity (colored badge), event type (with inline state transition), and actor. Expanded detail shows state transition arrows, actor info, entity links (task IDs link to task detail), and formatted metadata JSON.
- **Pagination** (`audit-pagination.tsx`): Page navigation with smart ellipsis, range display ("Showing 1-20 of 150 events"), and page size selector.
- **Page** (`page.tsx`): Full integration with filter toggle, error state, results summary, and loading skeleton.
- **Updated `AuditEvent` type** to include `oldState`/`newState` fields matching backend API.
- **30 new tests** across 3 test files covering hook state management, table rendering/expansion, and page integration.

### Patterns used

- URL-synced filter state via `useSearchParams` (same as tasks feature)
- TanStack Query hook for data fetching (`useAuditLog` was already implemented)
- Toggle-button filter UI (same as task filters)
- Expandable table rows with toggle state via `Set<string>`
- `data-testid` attributes on all interactive elements

### Notes for next loop

- T104 and T105 are the remaining pending tasks (both P2, UI operator controls)
- The `PaginationControls` component in tasks has "tasks" hardcoded in the label; if more features need pagination, consider extracting a shared component with a configurable label

## T088 — Implement queue and worker status broadcasting

### What was done

- Created `apps/control-plane/src/events/queue-worker-events.service.ts` with full implementation:
  1. **Heartbeat throttling**: Per-worker throttle map, 5s window, suppresses rapid broadcasts to prevent UI flooding
  2. **Pool summary broadcasting**: After worker status changes, queries all pool workers and broadcasts aggregate stats (total workers, active workers, status breakdown) to the Workers channel
  3. **Merge queue position broadcasting**: After merge queue item transitions, queries repository's full queue and broadcasts ordered positions to the Queue channel
  4. **Queue depth gauge polling**: 5s interval broadcasts pending job counts grouped by type to the Queue channel
  5. **Throttle map cleanup**: Prunes stale entries (>30s) during polling to prevent memory leaks
- Updated `DomainEventBroadcasterAdapter` to trigger enrichment broadcasts after entity-level events: pool summaries for worker status changes, merge queue positions for queue item transitions
- Used ModuleRef for lazy database connection resolution (direct @Inject in EventsModule causes NestJS compilation hang with WebSocket gateway)
- Added `.unref()` to the polling timer so it doesn't block Node.js process shutdown
- Created comprehensive test suite (24 tests): throttling behavior, pool summary, merge queue positions, queue depth gauge, polling lifecycle, throttle cleanup, error resilience
- Updated adapter tests (6 new tests): enrichment triggering for worker/merge events, no enrichment for task events, enrichment failure resilience, optional service availability

### Patterns used

- Same mock server pattern as T086/T087 event tests: manual socket.io mock with emitCalls capture
- ModuleRef.get for lazy DI resolution (avoids WebSocket gateway + DB provider resolution hang)
- vi.spyOn on snapshot methods to test broadcasting logic without real database
- vi.useFakeTimers for deterministic interval testing
- @Optional on adapter's QueueWorkerEventsService via ModuleRef (graceful degradation)

### For next loop

- T096-T100 (UI views: worker pools, review center, merge queue, config editor, audit explorer) are all P2 and ready
- T104-T105 (operator controls UI) are P2 — T105 depends on T096 and T098
- All remaining tasks are P2 UI features in E020/E021

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
