# Progress Log

## T024: Implement cross-field validation and schema versioning

**Status:** Done
**Date:** 2026-03-11

### What was done

- Added cross-field validation rules (PRD 008 §8.13) using `.superRefine()` to 4 packet schemas:
  - `review-packet.ts` — verdict="approved" requires empty blocking_issues
  - `lead-review-decision-packet.ts` — decision="changes_requested" requires non-empty blocking_issues; decision="approved_with_follow_up" requires non-empty follow_up_task_refs
  - `merge-assist-packet.ts` — confidence="low" requires recommendation to be "reject_to_dev" or "escalate"
  - `post-merge-analysis-packet.ts` — confidence="low" requires recommendation to be "escalate"
- Created `packages/schemas/src/version.ts` — schema version parsing, validation, and compatibility checking (PRD 008 §8.15):
  - `SchemaVersionSchema` — Zod schema for `major.minor` format validation
  - `parseSchemaVersion()` — extracts major/minor numbers from version string
  - `isVersionCompatible()` — checks if version is in expected major family
  - `validatePacketVersion()` — validates packet version with detailed result
- Created `packages/schemas/src/version.test.ts` — comprehensive version utility tests
- Created `packages/schemas/src/cross-field-validation.test.ts` — exhaustive cross-field rule tests with confidence×recommendation matrices
- Updated existing tests in merge-assist-packet.test.ts and post-merge-analysis-packet.test.ts to use cross-field-valid combinations when testing confidence level acceptance
- Updated barrel exports in `index.ts`
- Fixed T027 status discrepancy in backlog index (was pending in index but done in task file)

### Patterns used

- `.superRefine()` for cross-field validation with descriptive error messages and correct paths
- Factory functions in tests for creating valid base packets with overrides
- Exhaustive matrix testing (confidence × recommendation) for complete coverage
- Version format: `major.minor` with regex validation, no leading zeros

### Notes for next loop

- E004 (Packet Schemas & Validation) is now fully complete — all 5 tasks done
- This unblocks E010 (Policy & Configuration) and E011 (Validation Runner) which depend on E004
- Cross-field validation errors target the field that needs to change (e.g., `blocking_issues` path, not `verdict` path) for better debugging
- `validatePacketVersion()` returns `compatible: false` with a reason string rather than throwing — the orchestrator should handle this gracefully
- The version validation is a runtime check separate from the Zod schema — schemas still use `z.literal("1.0")` for the current version; `validatePacketVersion()` will be used by the orchestrator for multi-version acceptance

## T023: Define remaining packet schemas

**Status:** Done
**Date:** 2026-03-11

### What was done

- Created 5 new Zod schemas in `packages/schemas/src/`:
  - `merge-packet.ts` — MergePacket (PRD 008 §8.8) with nested MergePacketDetails
  - `merge-assist-packet.ts` — MergeAssistPacket (PRD 008 §8.9) with MergeAssistFileAffected
  - `validation-result-packet.ts` — ValidationResultPacket (PRD 008 §8.10) with ValidationResultPacketDetails
  - `post-merge-analysis-packet.ts` — PostMergeAnalysisPacket (PRD 008 §8.11) with SuggestedRevertScope
  - `policy-snapshot.ts` — PolicySnapshot (PRD 009 §9.2) with 8 sub-policy schemas
- Added `ValidationRunScopeSchema` to `shared.ts` (needed by ValidationResultPacket)
- Created comprehensive test files for all 5 schemas (107 new tests, 368 total in schemas package)
- Updated `index.ts` to export all new schemas and types

### Patterns used

- One file per schema, matching existing pattern (review-packet.ts, dev-result-packet.ts, etc.)
- Each schema uses `zodEnumFromConst()` helper for domain enum conversion
- All sub-policies in PolicySnapshot are optional (resolved policy may omit inapplicable policies)
- `nullable()` used for PostMergeAnalysisPacket fields that are conditionally required (cross-field validation deferred to T024)
- Test files use spec examples from PRD as primary correctness tests

### Next loop should know

- T024 (cross-field validation) is now unblocked — it needs to add `.refine()` or `.superRefine()` for cross-field invariants like: MergeAssist low confidence requires reject_to_dev/escalate, PostMergeAnalysis low confidence requires escalate, PostMergeAnalysis revert requires suggested_revert_scope
- All 5 new schemas follow the same file-per-schema pattern; look at existing schemas for reference
- `ValidationRunScopeSchema` was added to shared.ts — it's exported from index.ts

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

## T035: Implement DAG validation with circular dependency detection — DONE (2026-03-11)

**Status:** Done

**What was done:**

- Created `packages/application/src/ports/dependency.ports.ts` — port interfaces for DAG validation:
  - `DependencyEdge` / `NewDependencyEdge` — entity shapes
  - `DependencyTaskRepositoryPort` — task existence checks
  - `TaskDependencyRepositoryPort` — forward/reverse graph traversal + CRUD
  - `DependencyUnitOfWork` — transaction boundary for atomic cycle-check + insert
- Created `packages/application/src/services/dependency.service.ts` — DependencyService with:
  - `addDependency()` — validates input, runs DFS cycle detection, inserts atomically
  - `removeDependency()` — deletes edge by ID
  - `getDependencies()` — forward lookup (what does this task depend on?)
  - `getDependents()` — reverse lookup (what tasks depend on this?)
  - `detectCycle()` — DFS from dependsOnTaskId following forward edges to check reachability of taskId
- Added 3 new error classes in `errors.ts`:
  - `CyclicDependencyError` — includes the cycle path for diagnostics
  - `DuplicateDependencyError` — prevents duplicate edges
  - `SelfDependencyError` — prevents a task depending on itself
- Created 33 tests in `dependency.service.test.ts` covering:
  - Input validation (self-dep, missing tasks, duplicates)
  - Cycle detection: 2-node, 3-node, long chain, diamond, mixed types
  - Valid DAGs: linear chain, diamond, tree, disconnected, fan-out, fan-in
  - isHardBlock defaults per dependency type
  - Edge removal and re-addition
  - Complex graph scenarios with mixed accept/reject

**Key patterns:**

- Follows the same functional factory pattern as other application services
- Uses hexagonal architecture: service depends on ports, not concrete repos
- DFS cycle detection runs inside the same transaction as the insert (atomic)
- All dependency types (blocks, relates_to, parent_child) participate in cycle detection per PRD §2.3
- isHardBlock defaults: true for BLOCKS, false for RELATES_TO and PARENT_CHILD

**For next loops:**

- T036 (readiness computation) is now unblocked — can use DependencyService for dependency queries
- T037 (reverse-dependency recalculation) is now unblocked — getDependents() provides reverse lookups
- Infrastructure adapter for DependencyUnitOfWork will be needed when wiring into the control plane

## T027: Implement Scheduler Service (2026-03-11)

**What was done:**

- Created `packages/application/src/ports/scheduler.ports.ts` with `SchedulerTaskRepositoryPort` and `SchedulerPoolRepositoryPort` interfaces
- Created `packages/application/src/services/scheduler.service.ts` implementing the full `SchedulerService` with `scheduleNext()` method
- Created comprehensive test suite with 33 tests covering priority ordering, capability matching, concurrency limits, duplicate assignment prevention, and error propagation
- Exported all new types and functions from `packages/application/src/index.ts`

**Patterns used:**

- Factory function pattern (`createSchedulerService()`) consistent with existing services
- Service composition: Scheduler orchestrates `LeaseService` and `JobQueueService` rather than owning their transactions
- Pure helper functions exported for unit testing: `isPoolCompatible`, `hasPoolCapacity`, `selectBestPool`, `comparePriority`
- Discriminated union result type (`ScheduleResult = ScheduleSuccessResult | ScheduleNoAssignmentResult`) with skip reasons for observability

**Next loop should know:**

- T028 (scheduler tick loop) is now unblocked — it will need to call `scheduleNext()` on a periodic tick
- The scheduler ports (`SchedulerTaskRepositoryPort`, `SchedulerPoolRepositoryPort`) need infrastructure implementations in `packages/infrastructure/` when the repository adapters are built
- The `SchedulablePool.activeLeaseCount` field requires a COUNT query joining task_leases with active statuses — this is the most complex query the infra layer needs to implement
- Pool type assignment is hardcoded to DEVELOPER for now; future tasks may need REVIEWER/PLANNER pool matching

## T043: Define Worker Runtime Interface (2026-03-11)

**What was done:**

- Created `packages/infrastructure/src/worker-runtime/types.ts` with all runtime types: `RunContext`, `PreparedRun`, `FinalizeResult`, `RunOutputStream`, `RunLogEntry`, `CancelResult`, `CollectedArtifacts`, `WorkspacePaths`, `TimeoutSettings`, `OutputSchemaExpectation`, `RunStatus`
- Created `packages/infrastructure/src/worker-runtime/runtime.interface.ts` with the `WorkerRuntime` interface defining all 6 lifecycle methods: `prepareRun`, `startRun`, `streamRun`, `cancelRun`, `collectArtifacts`, `finalizeRun`
- Created `packages/infrastructure/src/worker-runtime/registry.ts` with `RuntimeRegistry` (singleton factory pattern), `RuntimeNotFoundError`, and `DuplicateRuntimeError`
- Created barrel exports via `worker-runtime/index.ts` and updated `packages/infrastructure/src/index.ts`
- Added `@factory/schemas` as workspace dependency and TypeScript project reference
- Created 22 tests across two test files covering interface satisfaction, full lifecycle, concurrent runs, registry CRUD, error handling

**Patterns used:**

- Lifecycle method signatures match PRD 010 §10.8.2: prepare → start → stream → cancel → collect → finalize
- `RunContext` imports `TaskPacket` and `PolicySnapshot` types from `@factory/schemas` for type-safe adapter contracts
- `streamRun` returns `AsyncIterable<RunOutputStream>` for live output streaming
- Registry uses factory pattern (`WorkerRuntimeFactory = () => WorkerRuntime`) for lazy, per-retrieval adapter instantiation
- All types use `readonly` fields for immutability
- Comprehensive JSDoc with PRD cross-references on every type and method

**Next loop should know:**

- T044 (Worker Supervisor) is now unblocked — it will orchestrate the `WorkerRuntime` lifecycle and manage heartbeat tracking
- T045 (Copilot CLI Adapter) is now unblocked — it must implement the `WorkerRuntime` interface with Copilot CLI process spawning
- The `RuntimeRegistry` is a singleton; bootstrap code should call `RuntimeRegistry.create()` and register adapters before dispatch
- `streamRun` uses `AsyncIterable` — adapters should implement it as an async generator function
