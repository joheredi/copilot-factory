# Progress Log

## T073 — Implement audit event recording on state transitions

### Task

T073 - Implement audit event recording on state transitions (Epic E015: Audit & Event System)

### What was done

Verified that T073 was already fully implemented by T018 (atomic transition + audit persistence). The TransitionService in `packages/application/src/services/transition.service.ts` already creates an AuditEvent record atomically within the same BEGIN IMMEDIATE transaction for every state transition across all 4 entity types (Task, TaskLease, ReviewCycle, MergeQueueItem). All acceptance criteria are met:

- Every state transition creates an audit event (structural guarantee — no conditional logic)
- Audit events capture entity_type, entity_id, event_type, actor_type, actor_id, old_state, new_state, metadata
- Atomicity enforced via BEGIN IMMEDIATE transactions (audit + state change in same tx)
- Tests verify: rollback on audit failure, no partial state, correct fields for all entity types

### Notes for next loop

- T074 (Audit query service) is now unblocked
- T100 (UI audit explorer) is also unblocked
- Actor types are string-based (`ActorInfo.type: string`). If stronger typing is needed, consider adding an `ActorType` union type in the domain layer.

## T081 — Implement Project and Repository CRUD endpoints

### Task

T081 - Implement Project and Repository CRUD endpoints (Epic E017: REST API Layer)

### What was done

Implemented full CRUD endpoints for Projects and Repositories in the NestJS control-plane app:

- **DatabaseModule**: Global NestJS module providing `DatabaseConnection` via `DATABASE_CONNECTION` injection token
- **ProjectsController**: POST/GET/PUT/DELETE `/projects` with pagination, 201/204/404/409 status codes
- **RepositoriesController**: POST/GET nested under `/projects/:projectId/repositories`, plus GET/PUT/DELETE at `/repositories/:id`
- **ProjectsService & RepositoriesService**: Use existing repository factory functions with write transactions
- **DTOs**: 5 Zod-validated DTOs (CreateProject, UpdateProject, CreateRepository, UpdateRepository, PaginationQuery)
- **Tests**: 4 test files — controller tests (mocked services via NestJS testing module), service integration tests (in-memory SQLite with migrations)

### Key fixes from code review

- SQL-level LIMIT/OFFSET for repository pagination (instead of in-memory slicing)
- FOREIGN KEY constraint error handling in RepositoriesService.create (throws BadRequestException)
- Additional pagination edge case tests (page 2, out-of-range page)

### Files created

- `apps/control-plane/src/infrastructure/database/database.module.ts`
- `apps/control-plane/src/projects/dtos/` (5 DTOs + barrel index)
- `apps/control-plane/src/projects/projects.service.ts`
- `apps/control-plane/src/projects/repositories.service.ts`
- `apps/control-plane/src/projects/projects.controller.ts`
- `apps/control-plane/src/projects/repositories.controller.ts`
- `apps/control-plane/src/projects/projects.service.test.ts`
- `apps/control-plane/src/projects/repositories.service.test.ts`
- `apps/control-plane/src/projects/projects.controller.test.ts`
- `apps/control-plane/src/projects/repositories.controller.test.ts`

### Files modified

- `apps/control-plane/src/projects/projects.module.ts` (wired controllers + services)
- `apps/control-plane/src/app.module.ts` (imported DatabaseModule)

### Patterns

- Global NestJS module with custom provider for database connection injection
- Zod DTOs with static `schema` property for automatic validation via global pipe
- Service layer delegates to repository factory functions; writes wrapped in `writeTransaction`
- `PaginatedResponse<T>` with `{ data, meta: { page, limit, total, totalPages } }` shape
- SQLite UNIQUE/FK constraint errors mapped to appropriate HTTP exceptions

### Notes for next loop

- T089 (React SPA init) is now unblocked by T081
- The DatabaseModule is Global so all future feature modules get DB access automatically
- PaginationQueryDto and PaginatedResponse can be reused by T082-T085

## T066: Implement merge conflict classification (done)

**Date:** 2026-03-11

Implemented the conflict classifier service that determines whether merge conflicts are reworkable or non-reworkable per PRD §10.10.2.

### What was done

- Created `packages/application/src/services/conflict-classifier.service.ts`
- Created `packages/application/src/services/conflict-classifier.service.test.ts` (32 tests)
- Exported new types and functions from `packages/application/src/index.ts`

### Key design decisions

- Implemented as an application service with a factory function (`createConflictClassifierService`) that takes a `MergeConflictPolicy` config object
- Uses `picomatch` for protected path glob matching (consistent with review-router pattern)
- Directory prefix patterns (ending with `/`) are normalized to `<prefix>**` for picomatch compatibility
- Provides both `ConflictClassifierPort` implementation and a detailed classifier that returns reasons
- File count threshold is checked BEFORE protected paths (short-circuit on cheaper check)

### Patterns used

- Factory function + dependency injection (consistent with all other application services)
- Port implementation pattern (implements existing `ConflictClassifierPort` from merge-executor.ports.ts)
- `picomatch` with `{ dot: true }` for glob matching (consistent with review-router.service.ts)

### What the next loop should know

- T067 (post-merge validation and failure policy) is now unblocked
- The `ConflictClassifierPort` was already consumed by `merge-executor.service.ts` — this task provides the production implementation
- The JSDoc in merge-executor.service.ts references `createPolicyConflictClassifier(policySnapshot)` — the actual function is `createConflictClassifierService(policy)` which is close but the merge executor JSDoc may need updating in a future task
- `MergeConflictPolicy` is not yet part of the hierarchical `FactoryConfig` — merge policy lives as opaque JSON in the DB schema. A future task should formalize the merge policy type in packages/config

## T106: Create test harness with fake runner and workspace — DONE

**What was done:**

- Created `FakeClock` in `packages/testing/src/fakes/fake-clock.ts` — deterministic time control with advance/setTime/reset/createDateNow
- Created `FakeWorkspaceManager` in `packages/testing/src/fakes/fake-workspace-manager.ts` — implements WorkspaceProviderPort with in-memory tracking, error injection, and cleanup support
- Created `FakeRunnerAdapter` in `packages/testing/src/fakes/fake-runner-adapter.ts` — implements RuntimeAdapterPort with configurable outcomes (success/failure/partial/cancelled), per-run overrides, error injection, and full call tracking
- Created `createTestDatabase()` in `packages/testing/src/database/test-database.ts` — in-memory SQLite with Drizzle migrations, FK enforcement, writeTransaction support
- Created 13 entity factory functions in `packages/testing/src/fixtures/entity-factories.ts` (Project, Repository, Task, WorkerPool, TaskLease, ReviewCycle, MergeQueueItem, Job, ValidationRun, SupervisedWorker, AuditEvent, Packet, AgentProfile)
- Created `runTaskToState()` and `findTransitionPath()` in `packages/testing/src/helpers/run-task-to-state.ts` — drives tasks through the lifecycle using BFS pathfinding and auto-generated transition contexts
- 83 new tests across 7 test files, all passing
- Added dependencies: @factory/application, @factory/domain, better-sqlite3, drizzle-orm

**Patterns:**

- Entity factories use `createTestId()` for unique IDs and accept `Partial<T>` overrides
- FakeRunnerAdapter supports `outcomesByRun` Map for mixed-scenario tests (first run succeeds, second fails)
- `runTaskToState` uses BFS for off-happy-path targets (FAILED, ESCALATED, CANCELLED) and optimizes with the happy path array for common cases
- Test DB uses `:memory:` SQLite with the same pragmas as production (WAL, FK ON, busy_timeout)

**What the next loop should know:**

- T107-T111 (integration tests) are now unblocked and should use the test harness
- The `@factory/testing` package now depends on `@factory/application` and `@factory/domain`
- `import.meta.dirname` is used in test-database.test.ts for migrations path resolution
- The `TransitionContext` property names are specific — use the actual type definition in domain, not guessed names

## 2026-03-11 — T067: Implement post-merge validation and failure policy

**Status:** Done

**What was done:**

- Created `packages/application/src/ports/post-merge-validation.ports.ts` — port interfaces for task transitions, follow-up task creation, merge queue pause/resume, and operator notifications
- Created `packages/application/src/services/post-merge-validation.service.ts` — full implementation of:
  - Post-merge validation triggering (runs merge-gate profile after merge)
  - POST_MERGE_VALIDATION → DONE transition on success
  - POST_MERGE_VALIDATION → FAILED transition on failure
  - Severity classification per §9.11.1 (critical/high/low)
  - Response policy per §9.11.2 (revert task, queue pause, operator notification)
  - Exported `classifyFailureSeverity` pure function for reuse
  - Configurable `PostMergeFailurePolicy` with defaults from §9.11.4
- Created comprehensive test suite (33 tests) covering all severity levels, policy customization, audit trail, and precondition enforcement
- Updated barrel exports in `packages/application/src/index.ts`

**Patterns / notes for next loops:**

- The `PostMergeFollowUpTaskRecord` type is named with `PostMerge` prefix to avoid collision with `FollowUpTaskRecord` from review-decision ports
- The service follows the same factory-function + dependency-injection pattern as merge-executor and other application services
- Severity classification: security check name match is case-insensitive (`check.checkName.toLowerCase() === "security"`)
- The analysis agent integration for high-severity failures is policy-controlled (`useAnalysisAgentOnHigh`); when enabled, no revert task is created — a separate agent dispatch would handle that
- Queue pause is a side effect outside the transaction boundary (correct per the pattern)

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
