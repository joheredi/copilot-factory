# Progress Log

## T019 — Implement optimistic concurrency control (2026-03-11)

### What was done

- Created `packages/domain/src/conflict-priority.ts` — pure domain functions for conflict resolution priority classification per §10.2.3:
  - `ConflictPriority` enum: OPERATOR (3) > LEASE_EXPIRY (2) > AUTOMATED (1)
  - `getConflictPriority(actorType, targetStatus)` — classifies actor priority
  - `shouldRetryOnConflict(actorType, targetStatus)` — retry decision helper
  - `isWithinGracePeriod(leaseExpiredAt, resultReceivedAt, gracePeriodSeconds)` — grace period check for late worker results
- Created `packages/application/src/services/optimistic-retry.service.ts` — priority-aware retry wrapper:
  - `OptimisticRetryService` with `transitionTaskWithPriority()` method
  - Operator/lease-monitor actors retry on VersionConflictError (up to maxRetries)
  - Automated actors (worker, scheduler) yield immediately (no retry)
  - Configurable maxRetries (default 3)
- Created design decision doc at `docs/design-decisions/conflict-resolution-priority.md`
- 56 new tests (31 domain + 25 application) covering all priority scenarios, retry exhaustion, grace period edge cases, concurrent race simulations
- All 1,089 tests pass, build clean

### Key design decisions

- **Domain classification + application retry** (vs embedding retry in transition service): Keeps transition service focused on single atomic transitions; retry orchestration is a separate concern at the application layer. See `docs/design-decisions/conflict-resolution-priority.md`.
- **Priority enum with numeric values**: Enables simple comparison (`>`) for retry decisions. Three levels match the §10.2.3 rules exactly.
- **Operator actor types**: 'operator' and 'admin' get OPERATOR priority. 'system' gets OPERATOR only when targeting ESCALATED/CANCELLED (operator-intent signals).
- **Lease monitor actors**: 'lease-monitor' and 'reconciliation' get LEASE_EXPIRY priority only when targeting FAILED.
- **Grace period as pure function**: Not coupled to retry logic — callers check grace period separately before deciding whether to accept a late worker result.

### Next loop should know

- The existing OCC mechanism (version check + increment + VersionConflictError) was already fully implemented in T017/T018. T019 added the priority resolution layer on top.
- `isWithinGracePeriod()` is available but not yet wired into any orchestration flow. The lease reclaim service (T033) or worker supervisor (T044) will need to use it when handling late worker results.
- The retry service only wraps `transitionTask` (not lease/review/merge transitions). Other entity types use status-based concurrency which doesn't need priority-based retry.

## T030 — Implement lease acquisition with exclusivity (2026-03-11)

### What was done

- Created `packages/application/src/ports/lease.ports.ts` — narrow port interfaces for lease acquisition (LeaseTaskRepositoryPort, LeaseRepositoryPort, LeaseUnitOfWork, LeaseTransactionRepositories)
- Created `packages/application/src/services/lease.service.ts` — LeaseService with `acquireLease()` that atomically enforces one-active-lease-per-task invariant
- Added `ExclusivityViolationError` and `TaskNotReadyForLeaseError` to `packages/application/src/errors.ts`
- Created comprehensive test suite with 41 tests covering: happy path (READY, CHANGES_REQUESTED, ESCALATED), exclusivity enforcement, concurrent acquisition, version conflicts, audit events, domain events, transaction atomicity, error propagation
- Updated `packages/application/src/index.ts` to export all new types and the service factory
- All 1,033 tests pass, build and lint clean

### Key design decisions

- **Separate ports from TransitionService**: Created dedicated `lease.ports.ts` rather than extending existing `TransactionRepositories`. Keeps ports narrow and purpose-specific (SRP), avoids breaking existing infrastructure implementations.
- **Domain state machine validation**: Uses `validateTransition()` from `@factory/domain` with `{ leaseAcquired: true, isOperator }` context — same guards that the task state machine defines for READY/CHANGES_REQUESTED/ESCALATED → ASSIGNED.
- **Lease-eligible states**: READY, CHANGES_REQUESTED, ESCALATED (per PRD §2.1 transition table). ESCALATED→ASSIGNED additionally requires `isOperator: true`.
- **Active lease statuses**: LEASED, STARTING, RUNNING, HEARTBEATING, COMPLETING (per task spec). Terminal/inactive: IDLE, TIMED_OUT, CRASHED, RECLAIMED.
- **Factory pattern**: `createLeaseService(unitOfWork, eventEmitter, idGenerator)` — same DI pattern as TransitionService.
- **Events after commit**: Domain events (task.transitioned + task-lease.transitioned) emitted after transaction commits, matching TransitionService pattern.

### Next loop should know

- T030 unblocks: T031 (heartbeat/staleness), T032 (graceful completion), T033 (lease reclaim), T044 (Worker Supervisor)
- The `LeaseUnitOfWork` needs an infrastructure implementation — it's parallel to the existing `UnitOfWork` but with `LeaseTransactionRepositories`. The infrastructure layer in `apps/control-plane/` will need to implement this when repositories are wired up.
- The `LeaseTaskRepositoryPort.updateStatusAndLeaseId()` method is new — it updates both status AND currentLeaseId atomically. The existing infra `TaskRepository` in `apps/control-plane/` has `update()` which can support this but a port adapter is needed.
- The `LeaseRepositoryPort.findActiveByTaskId()` maps directly to the existing `createTaskLeaseRepository().findActiveByTaskId()` in `apps/control-plane/`.

## T009 — Create migrations for Task and TaskDependency tables (2026-03-11)

### What was done

- Defined Task table (26 columns) in `apps/control-plane/src/infrastructure/database/schema.ts` with all fields from PRD 002 §2.3
- Defined TaskDependency table (6 columns) with FK constraints to Task, unique constraint on (task_id, depends_on_task_id)
- Generated migration `0001_melted_doctor_spectrum.sql` via drizzle-kit
- Added 5 missing domain enums to `packages/domain/src/enums.ts`: TaskType, TaskPriority, TaskSource, EstimatedSize, RiskLevel
- Wrote 31 new schema tests (T009 Task table, TaskDependency table, cross-table relationships)
- Wrote 10 new enum tests for the 5 added enums
- All 143 tests pass, build and lint clean

### Key design decisions

- JSON array columns (acceptance_criteria, definition_of_done, required_capabilities, suggested_file_scope) use `text({ mode: "json" })` matching T008 pattern
- FK references to TaskLease (T011), ReviewCycle (T011), MergeQueueItem (T012) are nullable text with NO DB FK constraint yet
- `is_hard_block` stored as integer (SQLite boolean convention), defaults to 1 (true)
- `version` defaults to 1 for optimistic concurrency (PRD 002 §2.4)
- Composite index on (repository_id, status) for scheduling queries
- Missing enums (TaskType, TaskPriority, TaskSource, EstimatedSize, RiskLevel) were added since T007 missed them

### Next loop should know

- T009 completion unblocks T011 (TaskLease, ReviewCycle) and T012 (MergeQueueItem, ValidationRun, Job)
- T010 (WorkerPool, Worker, AgentProfile, PromptTemplate) and T013 (AuditEvent, PolicySet) are also ready (independent of T009)
- The `uniqueIndex` import was added to schema.ts for the task_dependency unique constraint
- Test pattern: use `seedProjectAndRepo()` helper to create prerequisite Project+Repository for task tests

## T010 — WorkerPool, Worker, AgentProfile, PromptTemplate migrations (2026-03-11)

**What was done:**

- Added Drizzle schema definitions for 4 new tables: `worker_pool`, `worker`, `prompt_template`, `agent_profile`
- Generated migration `0002_smart_micromax.sql`
- Added 34 new tests covering all CRUD, FK enforcement, JSON round-trips, defaults, and cross-table relationships
- Total test count: 177 (all passing)

**Patterns used:**

- Same schema patterns as T008/T009: UUID text PKs, `unixepoch()` timestamp defaults, `text({ mode: "json" })` for JSON columns, integer booleans
- FK references to existing tables (tasks) enforced at DB level
- FK references to future tables (PolicySet from T013) stored as nullable text without DB-level FK
- PromptTemplate defined before AgentProfile in schema to support FK reference order

**What next loop should know:**

- T011, T012, T013 migrations are now unblocked (they depend on T006/T007/T009, all done)
- T014 (entity repositories) still needs T010-T013 all done before starting
- The `openTestDb()` helper in schema.test.ts now includes all T008-T010 tables — future tasks should continue this pattern

## T011: Create migrations for TaskLease, ReviewCycle, ReviewPacket, LeadReviewDecision tables

**Status:** Done  
**Date:** 2026-03-11

### What was done

- Added Drizzle schema definitions for 4 tables in `apps/control-plane/src/infrastructure/database/schema.ts`:
  - `task_lease` — tracks worker lease assignments with FK to task and worker_pool
  - `review_cycle` — tracks review cycle lifecycle with FK to task, JSON arrays for reviewers
  - `review_packet` — stores specialist reviewer results with FK to task and review_cycle
  - `lead_review_decision` — stores lead reviewer consolidation with FK to task and review_cycle
- Generated migration `0003_youthful_nicolaos.sql` via `pnpm db:generate`
- Added 39 new tests (128 total in schema.test.ts, up from 89)

### Patterns used

- Same Drizzle schema patterns as T008-T010: text PKs, `{ mode: "json" }` for JSON columns, `{ mode: "timestamp" }` with `(unixepoch())` defaults
- FK constraints enforced at DB level for task_id, pool_id, review_cycle_id
- worker_id is text-only (no FK) since workers may be ephemeral
- Indexes on frequently queried columns: task_id, status, worker_id, verdict

### Next loop notes

- T012 (MergeQueueItem, ValidationRun, Job) and T013 (AuditEvent, PolicySet) are now ready
- T014 (entity repositories) will be ready once T011-T013 are all done
- The test helper `openTestDb()` now creates all T008-T011 tables; future migrations should extend it
- The `seedWorkerPool()` helper was added for tests that need a valid pool_id FK

## T012: MergeQueueItem, ValidationRun, Job Migrations (2026-03-11)

**What was done:**

- Added `ValidationRunStatus` enum to `packages/domain/src/enums.ts` (pending, running, passed, failed, cancelled)
- Added three Drizzle schema table definitions to `apps/control-plane/src/infrastructure/database/schema.ts`:
  - `mergeQueueItems`: merge queue tracking with position, status, approved_commit_sha, timestamps
  - `validationRuns`: validation execution tracking with run_scope, status, tool_name, artifact_refs JSON
  - `jobs`: DB-backed job queue with job_type, payload_json, dependency/group coordination, lease_owner
- Generated migration `0004_greedy_guardsmen.sql`
- Added 35 comprehensive tests covering all three tables, nullable fields, JSON columns, FK constraints, cross-table joins, and the review cycle job coordination pattern
- All 251 tests pass (up from 216 baseline)

**Patterns used:**

- Same Drizzle schema patterns as T008–T011: text PKs, integer timestamps with `(unixepoch())` default, JSON columns via `text("col", { mode: "json" })`, indexes via third argument to `sqliteTable`
- Test pattern: in-memory SQLite DB created from raw SQL in `openTestDb()`, helper functions for generating valid rows

**What the next loop should know:**

- T012 and T013 both unblock T014 (entity repositories). T013 (AuditEvent, PolicySet) is the next critical dependency.
- The Job table's `(status, run_after)` composite index is the hot path for queue polling (T025)
- The `depends_on_job_ids` JSON column stores cross-job dependency references but has no DB-level FK — coordination is enforced at the application layer

## 2026-03-11 — T013: Create migrations for AuditEvent and PolicySet tables

**Status:** Done

**What was done:**

- Added two Drizzle schema table definitions to `apps/control-plane/src/infrastructure/database/schema.ts`:
  - `auditEvents`: append-only audit trail with entity_type+entity_id correlation, actor tracking, state transitions, and metadata_json for event-specific context
  - `policySets`: versioned policy configuration bundles with 6 JSON policy columns (scheduling, review, merge, security, validation, budget)
- Added indexes: composite `(entity_type, entity_id)` and `created_at` on audit_event
- Generated migration `0005_odd_snowbird.sql`
- Added 29 comprehensive tests covering: CRUD, nullable fields, JSON round-trip (including deeply nested objects), auto-populated timestamps, duplicate rejection, multiple events per entity, all actor/entity/event types, cross-table joins (audit→task, policy→project, audit→policy), and full T008-T013 table existence check
- All 280 tests pass (up from 251 baseline)

**Patterns used:**

- Same Drizzle schema patterns as T008-T012: text PKs, integer timestamps with `(unixepoch())` default, JSON columns via `text("col", { mode: "json" })`
- AuditEvent has no FK constraints by design — it references any entity type via entity_type+entity_id text columns
- PolicySet has no FK constraints — referenced by other tables (Project.default_policy_set_id, AgentProfile policy IDs) as nullable text columns

**What the next loop should know:**

- T013 completion unblocks T014 (data access repositories) — the critical path bottleneck
- T014 depends on T008-T013 (all now done). It's the next critical-path task
- The `default_policy_set_id` on Project and various policy ID columns on WorkflowTemplate/AgentProfile are currently nullable text without DB-level FK constraints — T014 repositories should handle this gracefully
- AuditEvent is append-only by design; no UPDATE/DELETE patterns needed in the repository layer

## 2026-03-11 — T014: Implement data access repositories for all entities

**Status:** Done

**What was done:**

- Created `apps/control-plane/src/infrastructure/repositories/` with 18 repository factory functions
- Each repository is a `createXxxRepository(db: BetterSQLite3Database)` factory returning a typed object with CRUD + query methods
- All 18 schema entities covered: WorkflowTemplate, Project, Repository, Task, TaskDependency, WorkerPool, Worker, AgentProfile, PromptTemplate, TaskLease, ReviewCycle, ReviewPacket, LeadReviewDecision, MergeQueueItem, ValidationRun, Job, AuditEvent, PolicySet
- **Task repository**: Optimistic concurrency via version column — `update()` requires `expectedVersion`, atomically checks and increments, throws `VersionConflictError` on mismatch
- **Job repository**: `claimJob()` atomically sets status=CLAIMED + leaseOwner + increments attemptCount, only if job is PENDING
- **AuditEvent repository**: Insert-only by design — no update/delete methods
- **TaskLease repository**: `findActiveByTaskId()` filters out terminal statuses (COMPLETED, TIMED_OUT, CRASHED, RECLAIMED)
- **MergeQueueItem repository**: `findByRepositoryId()` returns items ordered by position
- Central `index.ts` re-exports all factory functions and entity types
- 138 tests in `repositories.test.ts` covering CRUD, special behaviors, and edge cases
- 418 total tests pass (280 existing + 138 new)

**Patterns established:**

- Factory function pattern: `createXxxRepository(db)` — accepts `BetterSQLite3Database` for both standalone and transactional use
- Consistent API: `findById`, `findAll(opts?)`, `create`, `update`, `delete` + entity-specific queries
- `$dynamic()` used for optional limit/offset pagination
- Optimistic concurrency via WHERE clause on version column (Task repository)
- Atomic claim pattern via conditional UPDATE (Job repository)
- Entity types exported as `Xxx` (select) and `NewXxx` (insert) from each repository module

**Next steps:**

- T015: Task state machine (depends on T014 ✅)
- T025: Job queue core (depends on T014 ✅)
- T030: Lease acquisition (depends on T014 ✅)
- T035: DAG validation (depends on T014 ✅)
- T005: CI pipeline (independent — depends on T003 ✅, T004 ✅)
- T020-T024: Zod packet schemas (independent — depends on T004 ✅)

## 2026-03-11 — T015: Implement Task state machine with transition validation

**Status:** Done

**What was done:**

- Created `packages/domain/src/state-machines/task-state-machine.ts` with full implementation of the task state machine from PRD §2.1.
- Implemented all 16 task states and 45 valid transitions (18 explicit normal-flow + 3 ESCALATED resolutions + 12 wildcard→ESCALATED + 12 wildcard→CANCELLED).
- Each transition has a guard function checking preconditions from the PRD transition table.
- Exported `validateTransition(current, target, context)` returning `{valid, reason}`.
- Exported helpers: `getValidTargets()`, `isTerminalState()`, `getAllValidTransitions()`.
- Created 395 exhaustive tests covering every valid transition, every invalid transition pair, self-transitions, terminal state invariants, guard preconditions, lifecycle scenarios, and rework cycles.
- Updated `packages/domain/src/index.ts` to re-export all state machine functions and types.

**Patterns established:**

- State machines live in `packages/domain/src/state-machines/` with one file per machine.
- Transition maps use `Map<TransitionKey, GuardFn>` where `TransitionKey` is `"FROM→TO"`.
- Wildcard transitions (e.g., \* → ESCALATED) are handled separately from the explicit map.
- Guard functions are pure `(ctx: TransitionContext) => TransitionResult`.
- `TransitionContext` is a flat interface where callers supply only relevant fields.
- Tests use `it.each()` for exhaustive transition pair coverage.

**Next ready tasks:**

- T016: Supporting state machines (depends on T007 ✅)
- T017: Transition service (depends on T015 ✅, T016)
- T020: Shared Zod types (depends on T004 ✅)
- T005: CI pipeline (depends on T003 ✅, T004 ✅)

## 2026-03-11 — T016: Implement supporting state machines

**Status:** Done

**What was done:**

- Implemented Worker Lease state machine (`worker-lease-state-machine.ts`) with 9 states, 15 transitions (including HEARTBEATING self-loop), guard functions for all transitions, and full public API (`validateWorkerLeaseTransition`, `getValidWorkerLeaseTargets`, `isTerminalWorkerLeaseState`, `getAllValidWorkerLeaseTransitions`).
- Implemented Review Cycle state machine (`review-cycle-state-machine.ts`) with 8 states, 10 transitions, escalation from multiple states (IN_PROGRESS, AWAITING_REQUIRED_REVIEWS, CONSOLIDATING), and full public API.
- Implemented Merge Queue Item state machine (`merge-queue-item-state-machine.ts`) with 8 states, 12 transitions, REQUEUED→ENQUEUED retry cycle, and full public API.
- Created comprehensive test suites for all three state machines (131 new tests).
- Exported all new functions and types from `@factory/domain` package index.
- All three state machines follow the same Map-based transition table + guard function pattern established by T015's Task state machine.

**Patterns used:**

- `as const` enum objects with derived union types for state values
- Map<TransitionKey, GuardFn> for transition tables
- TransitionContext interfaces with optional fields for guard preconditions
- Separate `reject()` helper for consistent error messages

**Next loop should know:**

- T017 (Transition Service) is now unblocked — it depends on T015 ✅ and T016 ✅ and T014 ✅.
- T005 (CI pipeline) and T020 (Shared Zod types) are also ready.
- Worker Lease HEARTBEATING state has a self-loop (the only self-transition allowed across all state machines).
- TIMED_OUT and CRASHED are NOT terminal for Worker Lease — they transition to RECLAIMED.
- REQUEUED is NOT terminal for Merge Queue Item — it transitions back to ENQUEUED.

## T017: Build Centralized State Transition Service (done)

**Date:** 2026-03-11

**What was done:**

- Created the centralized State Transition Service in `packages/application/src/services/transition.service.ts`
- Defined repository port interfaces in `packages/application/src/ports/repository.ports.ts`
- Defined UnitOfWork port in `packages/application/src/ports/unit-of-work.port.ts`
- Defined DomainEventEmitter port in `packages/application/src/ports/event-emitter.port.ts`
- Defined domain event types in `packages/application/src/events/domain-events.ts`
- Defined application-layer error types in `packages/application/src/errors.ts`
- Added `@factory/domain` as a dependency of `@factory/application`
- Added tsconfig project reference from application → domain
- Wrote 33 unit tests covering all 4 entity transition methods

**Design decisions:**

- Used port-based dependency injection (repository ports + UnitOfWork + DomainEventEmitter) to keep the application layer decoupled from infrastructure. The control-plane wires implementations.
- Tasks use version-based optimistic concurrency; other entities (lease, review cycle, merge queue item) use status-based optimistic concurrency checks.
- Domain events are emitted AFTER transaction commit to prevent events on rollback.
- Audit events are created WITHIN the transaction to guarantee atomicity with state changes.

**Patterns for next loops:**

- The `createTransitionService(unitOfWork, eventEmitter)` factory pattern should be used when wiring up the service in the control-plane.
- All state transitions in downstream tasks (T018, T019, T030, etc.) should go through this service.
- The UnitOfWork port needs a concrete implementation in `apps/control-plane` that wraps `connection.writeTransaction()`.
- Repository ports need adapter implementations that delegate to the existing Drizzle repository factories.

## 2026-03-11 — T018: Implement atomic transition + audit persistence

**Status:** Done

**What was done:**

- Created `SqliteUnitOfWork` in `apps/control-plane/src/infrastructure/unit-of-work/sqlite-unit-of-work.ts` — concrete implementation of the `UnitOfWork` port that delegates to `DatabaseConnection.writeTransaction` (BEGIN IMMEDIATE).
- Created repository port adapters in `apps/control-plane/src/infrastructure/unit-of-work/repository-adapters.ts` — bridges 5 narrow application-layer ports to the full infrastructure repositories:
  - `createTaskPortAdapter` — version-based optimistic concurrency, re-throws infra `VersionConflictError` as application-layer `VersionConflictError`
  - `createTaskLeasePortAdapter` — status-based optimistic concurrency
  - `createReviewCyclePortAdapter` — status-based optimistic concurrency
  - `createMergeQueueItemPortAdapter` — status-based optimistic concurrency
  - `createAuditEventPortAdapter` — maps between port's `NewAuditEvent` and infra's Drizzle schema (handles `mode: "json"` serialization)
- Created 15 integration tests in `sqlite-unit-of-work.integration.test.ts` proving:
  - State change + audit event persisted atomically on success (all 4 entity types)
  - Failed transitions leave no partial state (rollback is complete)
  - Entity not found throws cleanly with no side effects
  - Sequential transitions increment versions correctly
  - Metadata round-trips through audit events
  - Status-based concurrency rejection for leases
  - Audit write failure triggers full rollback (entity state reverted)
  - Stale version detection via optimistic concurrency
- Added `@factory/application` and `@factory/domain` as dependencies of `@factory/control-plane`
- Added project references in `apps/control-plane/tsconfig.json`

**Key patterns:**

- `createSqliteUnitOfWork(conn)` creates a UnitOfWork that can be injected into `createTransitionService`.
- The adapter pattern (narrow port ← full repo) keeps the application layer decoupled from Drizzle/SQLite details.
- For status-based entities, the adapter reads current status and verifies before updating — safe within BEGIN IMMEDIATE.
- The infra task repo's `VersionConflictError` is caught and re-thrown as the application-layer `VersionConflictError` to maintain type compatibility.

**For next loops:**

- T019 (optimistic concurrency) can build on this — the version and status-based concurrency is already implemented and tested.
- T073 (audit event recording) is unblocked — the audit event infrastructure is fully integrated.
- The `createSqliteUnitOfWork` + `createTransitionService` wiring is ready for use in the control-plane bootstrap (T080).

## T020: Define shared Zod types for packets — DONE (2026-03-11)

- Created `packages/schemas/src/shared.ts` with three shared Zod schemas:
  - `FileChangeSummarySchema` — file change description (path, change_type, summary)
  - `IssueSchema` — review/validation issue (severity, code, title, description, file_path?, line?, blocking)
  - `ValidationCheckResultSchema` — validation check outcome (check_type, tool_name, command, status, duration_ms, summary, artifact_refs?)
- Created 13 Zod enum schemas re-exported from `@factory/domain` const-objects via a `zodEnumFromConst()` helper
- All schemas export both Zod schema objects (`*Schema`) and inferred TypeScript types
- Added `zod` and `@factory/domain` as dependencies to `@factory/schemas`
- 116 tests covering spec examples, all enum values, boundary conditions (empty strings, negative numbers, fractional values), and type inference
- Pattern: use `zodEnumFromConst()` to convert domain `{ KEY: "value" } as const` objects to `z.enum()`
