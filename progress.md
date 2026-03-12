# Progress Log

## T102: Implement state transition guards for manual actions (2026-03-12)

**What was done:**

- Created `apps/control-plane/src/operator-actions/operator-action-guards.ts` — `OperatorActionGuards` class with guard methods for force_unblock, reopen, cancel, and override_merge_order actions
- Created `apps/control-plane/src/operator-actions/operator-action-guards.test.ts` — 36 tests covering all guard validation scenarios including active lease checks, MERGING state protection, in-progress work acknowledgment, and audit severity classification
- Updated `OperatorActionsService` to integrate guards before executing actions
- Updated `CancelActionDto` to support `acknowledgeInProgressWork` boolean for confirming cancellation of in-progress tasks
- Updated controller to pass `acknowledgeInProgressWork` flag to service
- Added elevated audit severity metadata to sensitive actions (force_unblock, override_merge_order, reopen)

**Key guards implemented:**

- **force_unblock**: Validates non-empty reason and BLOCKED state (defense-in-depth)
- **reopen**: Validates no active (non-terminal) lease exists — prevents one-active-lease invariant violation
- **cancel**: Blocks cancellation during MERGING (repository corruption risk); requires `acknowledgeInProgressWork: true` for IN_DEVELOPMENT tasks
- **override_merge_order**: Validates QUEUED_FOR_MERGE state with hook for future validation extensions

**Patterns used:**

- Separate guard class for independent testability
- `SENSITIVE_ACTIONS` ReadonlySet and `getAuditSeverity()` for audit severity classification
- Guards throw `BadRequestException` with descriptive messages before the state machine is consulted
- Guards defer not-found checks to service layer (NotFoundException has correct HTTP status)

**Next loop should know:**

- T103 (Escalation resolution flow) is now unblocked by T102's completion
- The cancel action now has a breaking API change: IN_DEVELOPMENT tasks need `acknowledgeInProgressWork: true`
- Guard pattern can be extended for future authorization checks (RBAC is out of scope per T102)

## T087: Implement task state change event broadcasting (2026-03-12)

**What was done:**

- Created `apps/control-plane/src/events/domain-event-broadcaster.adapter.ts` — adapter implementing `DomainEventEmitter` port that maps domain events to WebSocket `FactoryEvent` payloads and broadcasts via `EventBroadcasterService`
- Created `apps/control-plane/src/events/domain-event-broadcaster.adapter.test.ts` — 14 tests covering: all entity types (task, lease, review-cycle, merge-queue-item, worker), event type mapping, payload structure, error handling (no-throw contract), unknown entity types, server-not-ready graceful handling
- Updated `EventsModule` to register and export `DomainEventBroadcasterAdapter`
- Updated `OperatorActionsModule` to import `EventsModule` for DI access
- Updated `OperatorActionsService` to inject `DomainEventBroadcasterAdapter` instead of the no-op emitter
- Updated `OperatorActionsService` tests to provide the real adapter (with no-server gateway for safe unit testing)

**Patterns used:**

- Adapter pattern: `DomainEventBroadcasterAdapter` bridges application-layer `DomainEventEmitter` port to infrastructure-layer `EventBroadcasterService`
- Entity-type-to-channel mapping table for clean routing (task→Tasks, lease→Workers, review→Tasks, merge→Queue)
- Domain event type to WS event type mapping (past-tense "transitioned" → present-tense "state_changed")
- Error swallowing with logging per the port contract (state is already committed, can't roll back)

**What the next loop should know:**

- All domain events from TransitionService now broadcast to WebSocket clients via the adapter
- The `DomainEventBroadcasterAdapter` is exported from `EventsModule` — any module creating a `TransitionService` should import `EventsModule` and inject the adapter
- T088 (queue and worker status broadcasting) can reuse the same adapter — it already handles all entity types including workers and merge-queue-items

## T086: Implement WebSocket gateway for live events (2026-03-12)

**What was done:**

- Installed `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io` in control-plane
- Created `apps/control-plane/src/events/types.ts` — EventChannel enum, FactoryEvent interface, SubscriptionRequest/Response types, buildEntityRoom helper
- Created `apps/control-plane/src/events/events.gateway.ts` — WebSocket gateway with connection tracking, subscribe/unsubscribe handlers, channel+entity room subscriptions
- Created `apps/control-plane/src/events/event-broadcaster.service.ts` — public API for emitting events to channels and entity rooms
- Created `apps/control-plane/src/events/events.module.ts` — NestJS module exporting EventBroadcasterService
- Registered EventsModule in AppModule
- 24 tests covering: connection lifecycle, subscribe/unsubscribe, channel validation, entity rooms, broadcast routing, graceful handling when server not ready

**Patterns used:**

- Single gateway + socket.io rooms (not separate gateways per namespace) — simpler for V1
- `Record<string, unknown>` in decorated method params to avoid `emitDecoratorMetadata` issues with interfaces
- `import type` for interfaces used in decorated signatures (TS1272 requirement)
- EventBroadcasterService is the public API; other modules inject it, never the gateway directly
- Events use "factory_event" socket.io event name with structured FactoryEvent payloads

**Next loop should know:**

- T087 (task events), T088 (queue/worker events), T091 (WebSocket client) are now unblocked
- EventBroadcasterService is exported from EventsModule — import EventsModule in feature modules that need to broadcast
- Use `broadcastToChannel()` for broad events, `broadcastToEntity()` for entity-specific events

## T108: Integration test — review rejection and rework loop (2026-03-11)

**What was done:**

- Created `apps/control-plane/src/integration/review-rework.integration.test.ts` (5 tests)
- Tests validate the full CHANGES_REQUESTED → rework → approval flow
- Tests verify schema-valid rejection packets, RejectionContext, rework TaskPacket
- Tests verify review_round_count tracking and atomic audit events
- All 2,962 tests pass (including the 5 new ones)

**Patterns used:**

- Same integration test pattern as T107 (real SQLite, real UnitOfWork, real TransitionService)
- Direct SQL seeding for prerequisite entities
- Schema validation using Zod packet schemas from @factory/schemas
- IssueSchema uses: severity, code, title, description, file_path, line, blocking
- WorkerLeaseStatus.COMPLETING is terminal (no COMPLETED state)

**Notes for next loops:**

- T109 (merge conflict tests) and T110 (lease timeout tests) follow same pattern
- The integration test directory is at apps/control-plane/src/integration/
- FakeRunnerAdapter from @factory/testing not needed for state-transition-level tests

---

## T075: Structured logging with correlation IDs — DONE

**What was done:**

- Implemented structured JSON logging in `packages/observability` using pino
- Created `src/logger.ts` — `createLogger(module, options)` factory function producing structured JSON loggers
- Created `src/context.ts` — AsyncLocalStorage-based correlation context with `runWithContext()` / `getContext()`
- Created `src/nest-logger.ts` — NestJS LoggerService adapter (`NestLoggerAdapter`) for framework integration
- Updated `src/index.ts` — re-exports full public API
- Added pino dependency to `packages/observability/package.json`
- 28 new tests across 3 test files (context, logger, nest-logger)
- All 3,122 tests pass (93 test files)

**Key design decisions:**

- Pino chosen for speed (async JSON logging) per task guidance
- AsyncLocalStorage for request-scoped correlation — no explicit context passing needed
- Logger wraps pino child loggers and injects CorrelationContext on every log call
- §7.14 common fields: timestamp (ISO), level, module, taskId, runId, workerId, reviewCycleId, mergeQueueItemId, eventType
- Per-module log level config via `LogLevelConfig` map with `resolveLogLevel()`
- NestJS adapter defined without hard dependency on `@nestjs/common` (interface-only)
- Tests use writable stream capture for deterministic JSON output verification

**Patterns used:**

- Writable stream + JSON.parse for capturing/asserting structured log output in tests
- vi.fn() mocks for NestJS adapter tests
- runWithContext for correlation context scoping in async flows

**Notes for next loops:**

- T076 (OpenTelemetry init) is now unblocked — depends only on T075
- NestLoggerAdapter can be integrated into control-plane main.ts in a future task
- Log levels can be wired to hierarchical config (T052) when operator config UI is built
- `getContextStorage()` is exported for NestJS interceptors that need to establish correlation context at the request boundary

## T042: Implement ReconcileWorkspacesCommand — Done

**What was implemented:**

- Created `packages/application/src/ports/workspace-reconciliation.ports.ts`:
  - `ExpiredWorkspaceRecord` — minimal task record for cleanup evaluation
  - `WorkspaceDirectoryEntry` — represents a workspace directory found on disk
  - `ExpiredWorkspaceQueryPort` — query tasks in terminal states with workspace info
  - `WorkspaceDirectoryScannerPort` — scan workspace directories for orphan detection
  - `CleanupJobQueryPort` — count non-terminal jobs by type (for initialize)
  - `WorkspaceReconciliationUnitOfWork` — transaction boundary

- Created `packages/application/src/services/workspace-reconciliation.service.ts`:
  - `WorkspaceReconciliationService` interface with `initialize()` and `processReconciliation()`
  - `createWorkspaceReconciliationService()` factory function with injected dependencies
  - Self-rescheduling pattern using `JobType.CLEANUP` (same as reconciliation sweep)
  - Two cleanup operations: expired workspaces and orphaned workspace directories
  - Uses `isWorkspaceCleanupEligible()` from domain for retention policy enforcement
  - Error-isolated per-workspace cleanup (one failure doesn't block others)
  - Default 1-hour interval, configurable via `WorkspaceReconciliationConfig`
  - Force-deletes branches for terminal tasks (may not be merged)

- Created `packages/application/src/services/workspace-reconciliation.service.test.ts`:
  - 29 tests covering initialization, self-rescheduling, expired cleanup, orphan detection, error isolation, combined scenarios, and default constants
  - Follows same mock dependency pattern as reconciliation-sweep.service.test.ts

- All types/functions exported from `@factory/application`

**Design decision:** Created standalone `WorkspaceReconciliationService` (vs adding to existing ReconciliationSweepService) because: recommended hourly interval differs from the 60s sweep interval, `JobType.CLEANUP` already existed in the enum, and workspace cleanup involves async I/O while the sweep is synchronous.

**Patterns used:**

- Self-rescheduling job pattern (claim → process → complete → create next)
- Port-based dependency injection (same as all application services)
- Error isolation per workspace (try/catch around each cleanup)
- Domain eligibility check before infrastructure cleanup

**What the next loop should know:**

- The `ExpiredWorkspaceQueryPort` and `WorkspaceDirectoryScannerPort` need infrastructure implementations when the control-plane wires up the service
- The `WorkspaceDirectoryScannerPort` is a new port that needs a filesystem-based implementation scanning `{workspacesRoot}/{repoId}/{taskId}/` directories
- T042 doesn't block any other tasks currently

## T065: Implement squash and merge-commit strategies — Done

**What was implemented:**

- Extended `MergeGitOperationsPort` with `squashMerge()` and `mergeCommit()` methods and `MergeOperationResult` type
- Added `mergeStrategy` (optional, defaults to rebase-and-merge) to `ExecuteMergeParams`
- Updated merge executor Phase 3 to dispatch to the correct git operation based on strategy
- Updated Phase 5 to push the correct branch: source branch for rebase-and-merge, target branch for squash/merge-commit
- Updated Phase 7 MergePacket to record the chosen strategy and set `rebase_performed` correctly (true only for rebase-and-merge)
- Strategy-specific summary labels in MergePacket ("Squash merge", "Merge commit", "Rebase-and-merge")
- 12 new tests: squash happy path, merge-commit happy path, MergePacket correctness per strategy, git op dispatch verification, push branch verification, conflict handling per strategy, default strategy backward compatibility

**Files changed:**

- `packages/application/src/ports/merge-executor.ports.ts` — added `MergeOperationResult`, `squashMerge()`, `mergeCommit()`
- `packages/application/src/services/merge-executor.service.ts` — strategy dispatch, push branch logic, packet details
- `packages/application/src/services/merge-executor.service.test.ts` — 12 new tests, updated fake git ops
- `packages/application/src/index.ts` — exported `MergeOperationResult`

**What the next loop should know:**

- The `MergeGitOperationsPort.squashMerge()` and `mergeCommit()` need infrastructure implementations when wiring up the merge executor
- Strategy selection from policy (task override → repo workflow → system default) is the caller's responsibility — the merge executor receives the resolved strategy
- All three strategies reuse the same conflict classification pipeline

## T084: Implement Artifact and Review packet retrieval endpoints — Done

**What was implemented:**

- `review/artifacts.controller.ts` + `review/artifacts.service.ts`: Artifact tree endpoint (`GET /tasks/:taskId/artifacts`) that aggregates review packets, lead review decisions, validation runs, and merge queue items from the DB. Packet content endpoint (`GET /tasks/:taskId/packets/:packetId`) that searches review_packet and lead_review_decision tables and returns parsed JSON.
- `review/reviews.controller.ts` + `review/reviews.service.ts`: Review history endpoint (`GET /tasks/:taskId/reviews`) returning all review cycles enriched with lead decisions and specialist packet counts. Review cycle packets endpoint (`GET /tasks/:taskId/reviews/:cycleId/packets`) returning specialist packets + lead decision for a specific cycle.
- `merge/merge-details.controller.ts` + `merge/merge-details.service.ts`: Merge details endpoint (`GET /tasks/:taskId/merge`) returning merge queue item and validation runs for a task.
- Updated `review.module.ts` and `merge.module.ts` to register new controllers and services.
- 31 new tests: 6 controller tests (mock-based) + 25 service tests (in-memory SQLite with Drizzle migrations).

**Patterns used:**

- Same NestJS patterns as existing controllers: `@ApiTags`, `@Controller`, `@Get`, `@Param`, `NotFoundException`, Swagger decorators
- Services injected via `@Inject(DATABASE_CONNECTION)` with functional repository factories
- Controller tests mock the service; service tests use real in-memory SQLite (same as tasks.service.test.ts pattern)
- Data seeding in tests uses repository factory functions (not raw SQL or `require()`)
- Artifact tree assembled from DB records, not filesystem — DB is source of truth for artifact metadata
- Task-scoped access control: packet retrieval verifies `taskId` ownership before returning

**What the next loop should know:**

- T085 (audit/policy/config endpoints) is the remaining E017 task — once done, E017 is complete and unblocks E018
- The artifact tree currently covers DB-tracked artifacts only (review packets, lead decisions, validation runs, merge items). Filesystem artifacts via ArtifactStore could be added later if needed.
- The `PacketContent.content` field returns the raw `packetJson` from the DB — it's the full Zod-validated packet JSON

## T077 — Instrument core orchestration paths with OTel spans

### Task

T077 - Instrument core orchestration paths with spans (Epic E016: Observability)

### What was done

Added OpenTelemetry spans to all 9 core orchestration services per §10.13.2:

1. **task.transition** — `TransitionService.transitionTask()` in transition.service.ts
2. **task.assign** — `SchedulerService.scheduleNext()` in scheduler.service.ts
3. **worker.prepare** / **worker.run** — `WorkerSupervisorService.spawnWorker()` in worker-supervisor.service.ts
4. **worker.heartbeat** — `HeartbeatService.receiveHeartbeat()` in heartbeat.service.ts
5. **validation.run** — `ValidationRunnerService.runValidation()` in validation-runner.service.ts
6. **review.route** — `ReviewRouterService.routeReview()` in review-router.service.ts
7. **review.lead_decision** — `ReviewDecisionService.applyDecision()` in review-decision.service.ts
8. **merge.prepare** / **merge.execute** — `MergeExecutorService.executeMerge()` in merge-executor.service.ts

Also created:

- `packages/observability/src/spans.ts` — Span name and attribute key constants
- `packages/application/src/services/orchestration-spans.test.ts` — 14 span verification tests
- Added `@factory/observability` as a dependency to `@factory/application`
- Re-exported `SpanStatusCode`, `Span`, `InMemorySpanExporter` from observability package

### Patterns used

- Each service file gets a module-level `const tracer = getTracer("service-name")`
- Sync methods use `tracer.startActiveSpan(name, (span) => { try/catch/finally })` pattern
- Async methods use the same pattern with `async (span) => { ... }`
- Worker supervisor and merge executor use separate non-nested spans (prepare + run/execute)
- Span attributes set from available context (task.id, pool.id, result.status, etc.)
- `SpanStatusCode.OK` on success, `SpanStatusCode.ERROR` on thrown exceptions
- `span.end()` always called in `finally` block

### Notes for next loop

- T078 (Prometheus endpoint) and T079 (starter metrics) are the remaining E016 tasks
- The span constants in `SpanNames` and `SpanAttributes` can be referenced from future instrumentation
- `InMemorySpanExporter` is now publicly exported from `@factory/observability` for use in tests
- The `startActiveSpan` callback may widen TypeScript literal types — use explicit return type annotation (see scheduler.service.ts for pattern)

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
