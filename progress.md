# Progress Log

## T057: Validation Gate Checking for State Transitions — Done

**What was implemented:**

- Created `packages/application/src/ports/validation-gate.ports.ts`:
  - `ValidationResultQueryPort` interface for querying latest validation results
  - `LatestValidationResult` type with validationRunId, profileName, overallStatus, completedAt
- Created `packages/application/src/services/validation-gate.service.ts`:
  - `ValidationGateService` with `checkGate()` method returning discriminated union
  - `GATED_TRANSITIONS` constant mapping gated transitions to required profiles
  - `enforceValidationGate()` convenience function for exception-based control flow
  - Two gated transitions: IN_DEVELOPMENT→DEV_COMPLETE (default-dev), POST_MERGE_VALIDATION→DONE (merge-gate)
  - APPROVED→QUEUED_FOR_MERGE explicitly NOT gated per spec
- Added `ValidationGateError` to `packages/application/src/errors.ts`
- 20 new tests covering: gate configuration, non-gated transitions, both gated transitions (pass/fail/missing), task isolation, enforceValidationGate convenience function
- All types/functions exported from `@factory/application`

**Design decision:**

- Created a standalone ValidationGateService rather than modifying TransitionService directly
- TransitionService is synchronous/transactional; adding I/O queries would violate its design
- Domain state machine already has guards (requiredValidationsPassed, postMergeValidationPassed)
- Callers use ValidationGateService to check gates, then populate TransitionContext accordingly
- Follows existing composition pattern where services are independent and composed by callers

**Patterns:**

- Fake query port pattern for testing (map of "taskId:profileName" → result)
- Discriminated union result types (GateNotApplicableResult | GatePassedResult | GateFailedResult)
- Uses domain constants DEFAULT_DEV_PROFILE_NAME and MERGE_GATE_PROFILE_NAME from @factory/domain

## T058: Review Router with Deterministic Rules — Done

**What was implemented:**

- Created `packages/application/src/services/review-router.service.ts`:
  - Pure deterministic service (no ports/UnitOfWork needed) — receives all inputs, produces routing decision
  - Rule evaluation in §10.6.2 order: 1) repo-required, 2) path-based, 3) tag/domain, 4) risk-based
  - Path matching via `picomatch` (glob patterns against changed file paths)
  - Compound AND logic across condition fields, OR within each field
  - Deduplication: reviewers promoted from optional→required when later rules require them
  - General reviewer always required (V1 invariant from §9.9)
  - Full routing rationale with rule names and tier labels for auditability
- 45 new tests covering: condition evaluation, rule categorization, all 4 evaluation tiers, deduplication/promotion, complex multi-rule scenarios, rationale completeness
- Added `picomatch` dependency to `@factory/application`
- Exported all types and factory function from barrel `index.ts`

**Patterns:**

- Pure deterministic service pattern (no side effects, no DB) for configuration-driven logic
- Builder-style test data factories with `createInput()` / `createRule()` overrides
- Categorized rule evaluation maintaining spec-mandated ordering
- Set-based deduplication for reviewer types across tiers

## T060 — Implement lead reviewer dispatch with dependencies

### Task

T060 - Implement lead reviewer dispatch with dependencies (Epic E012: Review Pipeline)

### What was done

Created LeadReviewConsolidationService in `packages/application` that assembles the lead reviewer's complete context when the `lead_review_consolidation` job becomes claimable. T059 already creates the lead job with `dependsOnJobIds`, and T026 prevents claiming until all dependencies are terminal. T060 adds the context assembly: gathering all specialist ReviewPackets from the current cycle, fetching review history from prior cycles, transitioning the ReviewCycle to CONSOLIDATING, recording audit events, and emitting domain events. 25 tests covering: single/multiple specialist packets, failed specialist jobs, review history ordering, state machine validation (IN_PROGRESS and AWAITING_REQUIRED_REVIEWS sources), terminal state rejection, job completion verification, concurrent modification detection, audit recording, and event emission.

### Files created

- `packages/application/src/ports/lead-review-consolidation.ports.ts`
- `packages/application/src/services/lead-review-consolidation.service.ts`
- `packages/application/src/services/lead-review-consolidation.service.test.ts`

### Files modified

- `packages/application/src/index.ts` — added exports for new service and port types

### Patterns used

- Service factory pattern with dependency injection (matching reviewer-dispatch.service.ts)
- Narrow port interfaces per service (hexagonal architecture)
- Unit of work for atomic transactions
- Post-commit domain event emission
- Defense-in-depth specialist job terminal check (even though T026 handles this at claim time)
- Review history assembly with chronological ordering for multi-rework scenarios

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
