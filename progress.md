# Progress Log

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

---

## T039: Git Worktree Creation — Done

**What was implemented:**

- T039: Implemented git worktree creation per task
- Created `packages/infrastructure/src/workspace/` module with:
  - `WorkspaceManager` class for workspace provisioning
  - `GitOperations` interface + `createExecGitOperations()` production impl using `execFile`
  - `FileSystem` interface + `createNodeFileSystem()` production impl
  - Branch naming: `factory/{taskId}` and `factory/{taskId}/r{attempt}` for retries
  - Workspace reuse on retry when worktree is clean
  - Error types: `GitOperationError`, `WorkspaceBranchExistsError`, `WorkspaceDirtyError`
- 31 new tests (17 unit tests for WorkspaceManager with mocks, 14 integration tests with real git repos)

**Patterns used:**

- Constructor injection of `GitOperations` + `FileSystem` interfaces for testability

**Next loop should know:**

- T040 (workspace mounting), T041 (workspace cleanup), T044 (worker supervisor) are now unblocked

## T036: Implement readiness computation (2026-03-11)

### What was done

- Created `packages/application/src/ports/readiness.ports.ts` — port interfaces for readiness computation (ReadinessTaskRepositoryPort, ReadinessTaskDependencyRepositoryPort, ReadinessUnitOfWork)
- Created `packages/application/src/services/readiness.service.ts` — ReadinessService with `computeReadiness()` and `checkParentChildReadiness()`
- Created `packages/application/src/services/readiness.service.test.ts` — 57 tests covering all acceptance criteria
- Updated `packages/application/src/index.ts` — exported new service, types, and port interfaces

### Patterns used

- Hexagonal architecture: narrow port interfaces following the same pattern as dependency.ports.ts
- Pure query service: computeReadiness does NOT trigger transitions (caller's responsibility)
- ReadinessUnitOfWork for consistent reads within a transaction
- Discriminated union results (ReadinessResultReady | ReadinessResultBlocked)

### Key design decisions

- Only `blocks` edges with `isHardBlock=true` affect readiness; all other edge types are informational
- Only DONE satisfies a hard-block; FAILED, CANCELLED, ESCALATED do NOT
- parent_child semantics are separate: checkParentChildReadiness() handles DONE/CANCELLED child checks
- Service is a pure query — deterministic orchestration principle preserved

### What the next loop should know

- T036 unblocks T037 (reverse-dependency recalculation) which should wire up readiness recomputation on task status changes
- The ReadinessService ports (ReadinessTaskRepositoryPort, ReadinessTaskDependencyRepositoryPort) need infrastructure implementations in apps/control-plane — these can adapt the existing task.repository.ts and task-dependency.repository.ts
- The readiness service is intentionally decoupled from the transition service — the reconciliation loop or dependency module should call computeReadiness() and then call transitionService.transitionTask() with the appropriate TransitionContext

---

## T037 — Implement reverse-dependency recalculation

### Task

T037 - Implement reverse-dependency recalculation (Epic E007: Dependency & Readiness Engine)

### What was done

Created ReverseDependencyService in `packages/application` that automatically recalculates readiness for downstream tasks when a prerequisite completes. The service composes ReadinessService (query) and TransitionService (command). Only DONE triggers recalculation; FAILED/CANCELLED leave dependents BLOCKED. 35 tests covering: single/multiple dependents, multi-dependency chains, edge type filtering, error handling, idempotency, and complex graph topologies.

### Files created

- `packages/application/src/ports/reverse-dependency.ports.ts`
- `packages/application/src/services/reverse-dependency.service.ts`
- `packages/application/src/services/reverse-dependency.service.test.ts`

### Files modified

- `packages/application/src/index.ts` (exports)

### Patterns

- Service composition pattern (composes ReadinessService + TransitionService)
- Hexagonal ports for reverse-dependency repository queries
- Idempotent recalculation with graceful error handling for InvalidTransitionError and VersionConflictError

## 2026-03-11 — T048: Implement command policy model and enforcement

**Status:** Done

**What was done:**

- Created `packages/domain/src/policies/command-policy.ts` — full command policy type model and enforcement logic per PRD §9.3
  - `CommandPolicyMode` (allowlist/denylist), `CommandViolationAction`, `CommandViolationReason` const enums
  - `AllowedCommand`, `DeniedPattern`, `ForbiddenArgPattern`, `CommandPolicy` interfaces
  - `parseCommandString()` — splits raw command into base command + arg tokens
  - `evaluateCommandPolicy()` — evaluates a command against a policy with 5-step evaluation order: invalid → shell operators → denied patterns → allowlist/denylist → forbidden arg patterns
  - Glob-style pattern matching for denied patterns (`*` wildcards)
  - Regex matching for forbidden argument patterns
- Created `packages/config/src/defaults/command-policy.ts` — default V1 policy and merge utility
  - `DEFAULT_COMMAND_POLICY` — allowlist mode with curated development commands (pnpm, npm, npx, git, tsc, node, cat, ls, find, grep, head, tail, wc, mkdir, diff)
  - Default denied patterns: rm -rf /, curl|sh, wget|bash, sudo, ssh, scp, chmod 777, eval
  - Default forbidden arg patterns: deep path traversal (3+ levels), /etc/, /proc/, /sys/
  - `mergeCommandPolicies(base, override)` — last-writer-wins field merge for hierarchical config
- Added `@factory/domain` dependency to `@factory/config` package with TypeScript project reference
- 66 new tests (44 domain + 22 config), all passing. 1,963 total tests.

**Patterns established:**

- Policy types live in `packages/domain/src/policies/` (domain owns enforcement rules)
- Default policy values live in `packages/config/src/defaults/` (config owns concrete defaults)
- Policy interfaces use `readonly` throughout for immutability
- Evaluation functions return structured results with reason codes for audit logging
- `as const` + union type pattern for policy enums (consistent with existing domain enums)

**Next steps:**

- T049 (file scope policy), T050 (validation policy), T051 (retry/escalation policy) — same pattern in domain/config
- T052 (hierarchical config resolution) — the merge utility here is the foundation
- T053 (policy snapshot generation) — combines all resolved policies into snapshot
