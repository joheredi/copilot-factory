# Task Lease Domain Layer - Complete Type Definitions & Analysis

## 1. TaskLease Entity - Database Schema

**File**: `apps/control-plane/src/infrastructure/database/schema.ts` (lines 774-847)

### Table Definition: `task_leases`

```typescript
export const taskLeases = sqliteTable(
  "task_lease",
  {
    /** Unique identifier (UUID). */
    leaseId: text("lease_id").primaryKey(),

    /** FK to the task being worked on. Enforced at DB level. */
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.taskId),

    /**
     * Identifier of the worker holding this lease.
     * Nullable text — no DB-level FK constraint; the worker may be an
     * ephemeral process not registered in the workers table.
     */
    workerId: text("worker_id").notNull(),

    /**
     * FK to the worker pool that dispatched this lease.
     * Enforced at DB level — the pool must exist for scheduling traceability.
     */
    poolId: text("pool_id")
      .notNull()
      .references(() => workerPools.workerPoolId),

    /** Timestamp when the lease was acquired (Unix epoch seconds). */
    leasedAt: integer("leased_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /**
     * Timestamp when the lease expires if no heartbeat is received.
     * Set at lease acquisition based on the pool's default_timeout_sec.
     */
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),

    /**
     * Timestamp of the most recent heartbeat from the worker.
     * Updated on each heartbeat to track worker liveness. Nullable before
     * the first heartbeat is received.
     */
    heartbeatAt: integer("heartbeat_at", { mode: "timestamp" }),

    /**
     * Current lease status in the worker lease lifecycle.
     * Stored as text; validated at the application layer against
     * WorkerLeaseStatus enum.
     */
    status: text("status").notNull(),

    /**
     * Reason the lease was reclaimed, if applicable.
     * Nullable — only set when the lease transitions to RECLAIMED or
     * TIMED_OUT status. Stored as text for flexibility.
     */
    reclaimReason: text("reclaim_reason"),

    /**
     * JSON array of artifact reference paths captured during crash recovery
     * or lease reclaim. Enables the next worker to access partial results.
     * Nullable — empty when no partial artifacts were captured.
     */
    partialResultArtifactRefs: text("partial_result_artifact_refs", { mode: "json" }),
  },
  (table) => [
    /** Index for lookups by task — "what leases exist for this task?" */
    index("idx_task_lease_task_id").on(table.taskId),
    /** Index for lookups by worker — "what is this worker working on?" */
    index("idx_task_lease_worker_id").on(table.workerId),
    /** Index for filtering leases by status (e.g. all active leases). */
    index("idx_task_lease_status").on(table.status),
  ],
);
```

### Inferred TypeScript Types

```typescript
/** A task lease row as read from the database. */
export type TaskLease = InferSelectModel<typeof taskLeases>;

/** Data required to insert a new task lease row. */
export type NewTaskLease = InferInsertModel<typeof taskLeases>;
```

**Fields Summary**:

- `leaseId` (PK): UUID identifying the lease
- `taskId` (FK): References the task being worked on
- `workerId`: ID of the worker holding the lease
- `poolId` (FK): References the worker pool
- `leasedAt`: When the lease was acquired
- `expiresAt`: Lease expiration timestamp
- `heartbeatAt`: Last heartbeat timestamp (nullable)
- `status`: Current lease status enum value
- `reclaimReason`: Optional reason for reclaim
- `partialResultArtifactRefs`: JSON array of artifact paths (nullable)

---

## 2. WorkerLeaseStatus Enum

**File**: `packages/domain/src/enums.ts` (lines 146-159)

```typescript
export const WorkerLeaseStatus = {
  IDLE: "IDLE",
  LEASED: "LEASED",
  STARTING: "STARTING",
  RUNNING: "RUNNING",
  HEARTBEATING: "HEARTBEATING",
  COMPLETING: "COMPLETING",
  TIMED_OUT: "TIMED_OUT",
  CRASHED: "CRASHED",
  RECLAIMED: "RECLAIMED",
} as const;

/** Union of all valid worker lease status values. */
export type WorkerLeaseStatus = (typeof WorkerLeaseStatus)[keyof typeof WorkerLeaseStatus];
```

**Status Descriptions**:

- **IDLE**: Initial state; lease created but not yet active
- **LEASED**: Scheduler has acquired exclusive lease for worker on task
- **STARTING**: Worker process spawned and initializing
- **RUNNING**: First heartbeat received; worker actively executing
- **HEARTBEATING**: Subsequent heartbeat received; continued execution
- **COMPLETING**: Worker submitted completion signal (schema-valid result packet)
- **TIMED_OUT**: Heartbeat timeout expired without new heartbeat
- **CRASHED**: Worker process exited abnormally (non-zero exit code/signal)
- **RECLAIMED**: Orchestrator forcibly reclaimed lease after failure (terminal)

**Terminal States**: `COMPLETING`, `RECLAIMED`

- No further transitions possible from terminal states
- Note: `TIMED_OUT` and `CRASHED` are NOT terminal; can transition to `RECLAIMED`

---

## 3. Task Entity - Lease-Related Fields

**File**: `apps/control-plane/src/infrastructure/database/schema.ts` (lines 219-377)

### Key Fields:

```typescript
export const tasks = sqliteTable("task", {
  taskId: text("task_id").primaryKey(),

  /**
   * Current state in the task lifecycle state machine.
   * Stored as text; validated at the application layer against TaskStatus enum.
   */
  status: text("status").notNull(),

  /**
   * FK to the current active TaskLease (defined in T011).
   * Nullable text — no DB-level FK constraint until TaskLease table exists.
   */
  currentLeaseId: text("current_lease_id"),

  /**
   * Optimistic concurrency token. Incremented on every state transition.
   * Callers must include the current version in transition requests;
   * conflicting transitions are rejected.
   */
  version: integer("version").notNull().default(1),

  /** Number of times this task has been retried after failure. */
  retryCount: integer("retry_count").notNull().default(0),

  /** Timestamp when the task reached a terminal state. */
  completedAt: integer("completed_at", { mode: "timestamp" }),

  // ... other fields
});
```

---

## 4. TaskStatus Enum

**File**: `packages/domain/src/enums.ts` (lines 26-46)

```typescript
export const TaskStatus = {
  BACKLOG: "BACKLOG",
  READY: "READY",
  BLOCKED: "BLOCKED",
  ASSIGNED: "ASSIGNED",
  IN_DEVELOPMENT: "IN_DEVELOPMENT",
  DEV_COMPLETE: "DEV_COMPLETE",
  IN_REVIEW: "IN_REVIEW",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  APPROVED: "APPROVED",
  QUEUED_FOR_MERGE: "QUEUED_FOR_MERGE",
  MERGING: "MERGING",
  POST_MERGE_VALIDATION: "POST_MERGE_VALIDATION",
  DONE: "DONE",
  FAILED: "FAILED",
  ESCALATED: "ESCALATED",
  CANCELLED: "CANCELLED",
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
```

**Terminal States**: `DONE`, `FAILED`, `CANCELLED`

---

## 5. WorkerLease State Machine

**File**: `packages/domain/src/state-machines/worker-lease-state-machine.ts` (lines 1-389)

### Transition Context Interface

```typescript
export interface WorkerLeaseTransitionContext {
  /**
   * Whether the scheduler successfully acquired an exclusive lease for the worker on a task.
   * Required for: IDLE → LEASED
   */
  readonly leaseAcquired?: boolean;

  /**
   * Whether the worker process has been spawned and is initializing.
   * Required for: LEASED → STARTING
   */
  readonly workerProcessSpawned?: boolean;

  /**
   * Whether the worker has sent its first heartbeat confirming successful startup.
   * Required for: STARTING → RUNNING
   */
  readonly firstHeartbeatReceived?: boolean;

  /**
   * Whether a subsequent heartbeat has been received from the running worker.
   * Required for: RUNNING → HEARTBEATING
   */
  readonly heartbeatReceived?: boolean;

  /**
   * Whether the worker has submitted a completion signal (schema-valid result packet).
   * Required for: HEARTBEATING → COMPLETING, RUNNING → COMPLETING
   */
  readonly completionSignalReceived?: boolean;

  /**
   * Whether the heartbeat timeout has expired without receiving a new heartbeat.
   * Required for: RUNNING → TIMED_OUT, HEARTBEATING → TIMED_OUT, STARTING → TIMED_OUT
   */
  readonly heartbeatTimedOut?: boolean;

  /**
   * Whether the worker process has exited abnormally (non-zero exit code, signal).
   * Required for: STARTING → CRASHED, RUNNING → CRASHED, HEARTBEATING → CRASHED
   */
  readonly workerCrashed?: boolean;

  /**
   * Whether the orchestrator is forcibly reclaiming the lease (e.g., stale lease reclaim).
   * Required for: TIMED_OUT → RECLAIMED, CRASHED → RECLAIMED
   */
  readonly reclaimRequested?: boolean;
}
```

### Transition Result Interface

```typescript
export interface WorkerLeaseTransitionResult {
  /** Whether the proposed transition is valid. */
  readonly valid: boolean;
  /** Human-readable explanation when the transition is rejected. */
  readonly reason?: string;
}
```

### Valid Transitions Map

**Happy Path**:

- `IDLE → LEASED`: lease acquired
- `LEASED → STARTING`: worker process spawned
- `STARTING → RUNNING`: first heartbeat received
- `RUNNING → HEARTBEATING`: subsequent heartbeat received
- `HEARTBEATING → HEARTBEATING`: self-loop for continuous heartbeats
- `RUNNING → COMPLETING`: completion signal received
- `HEARTBEATING → COMPLETING`: completion signal received

**Timeout Paths**:

- `STARTING → TIMED_OUT`: heartbeat timeout expired
- `RUNNING → TIMED_OUT`: heartbeat timeout expired
- `HEARTBEATING → TIMED_OUT`: heartbeat timeout expired

**Crash Paths**:

- `STARTING → CRASHED`: worker crashed
- `RUNNING → CRASHED`: worker crashed
- `HEARTBEATING → CRASHED`: worker crashed

**Reclaim Paths**:

- `TIMED_OUT → RECLAIMED`: reclaim requested
- `CRASHED → RECLAIMED`: reclaim requested

### Public API Functions

```typescript
export function validateWorkerLeaseTransition(
  current: WorkerLeaseStatus,
  target: WorkerLeaseStatus,
  context: WorkerLeaseTransitionContext = {},
): WorkerLeaseTransitionResult;

export function getValidWorkerLeaseTargets(
  current: WorkerLeaseStatus,
): readonly WorkerLeaseStatus[];

export function isTerminalWorkerLeaseState(state: WorkerLeaseStatus): boolean;

export function getAllValidWorkerLeaseTransitions(): ReadonlyArray<
  readonly [WorkerLeaseStatus, WorkerLeaseStatus]
>;
```

---

## 6. Task State Machine

**File**: `packages/domain/src/state-machines/task-state-machine.ts` (lines 1-703)

### Transition Context Interface

```typescript
export interface TransitionContext {
  /**
   * Whether all hard-block dependencies for the task are resolved.
   * Required for: BACKLOG → READY, BLOCKED → READY
   */
  readonly allDependenciesResolved?: boolean;

  /**
   * Whether policy blockers exist for the task.
   * Required for: BACKLOG → READY (must be false), BACKLOG → BLOCKED, BLOCKED → READY (must be false)
   */
  readonly hasPolicyBlockers?: boolean;

  /**
   * Whether a hard-block dependency was added or policy blocker detected.
   * Required for: BACKLOG → BLOCKED
   */
  readonly hasBlockers?: boolean;

  /**
   * Whether the scheduler selected the task and a lease was successfully acquired.
   * Required for: READY → ASSIGNED, CHANGES_REQUESTED → ASSIGNED, ESCALATED → ASSIGNED
   */
  readonly leaseAcquired?: boolean;

  /**
   * Whether the worker has sent its first heartbeat confirming session start.
   * Required for: ASSIGNED → IN_DEVELOPMENT
   */
  readonly hasHeartbeat?: boolean;

  /**
   * Whether the worker has emitted a schema-valid DevResultPacket.
   * Required for: IN_DEVELOPMENT → DEV_COMPLETE
   */
  readonly hasDevResultPacket?: boolean;

  /**
   * Whether required validations have passed (e.g., default-dev profile checks).
   * Required for: IN_DEVELOPMENT → DEV_COMPLETE
   */
  readonly requiredValidationsPassed?: boolean;

  /**
   * Whether the Review Router has emitted a routing decision and ReviewCycle was created.
   * Required for: DEV_COMPLETE → IN_REVIEW
   */
  readonly hasReviewRoutingDecision?: boolean;

  /**
   * The lead reviewer's decision.
   * Required for: IN_REVIEW → CHANGES_REQUESTED, IN_REVIEW → APPROVED
   */
  readonly leadReviewDecision?:
    | "approved"
    | "approved_with_follow_up"
    | "changes_requested"
    | "escalated";

  /**
   * Whether the merge completed successfully.
   * Required for: MERGING → POST_MERGE_VALIDATION
   */
  readonly mergeSuccessful?: boolean;

  /**
   * Classification of merge conflict per merge_policy.conflict_classification.
   * Required for: MERGING → CHANGES_REQUESTED, MERGING → FAILED
   */
  readonly mergeConflictClassification?: "reworkable" | "non_reworkable";

  /**
   * Whether all required post-merge checks passed.
   * Required for: POST_MERGE_VALIDATION → DONE, POST_MERGE_VALIDATION → FAILED
   */
  readonly postMergeValidationPassed?: boolean;

  /**
   * Whether an unrecoverable execution failure occurred.
   * Required for: IN_DEVELOPMENT → FAILED
   */
  readonly hasUnrecoverableFailure?: boolean;

  /**
   * Whether the lease timed out with no retries remaining.
   * Required for: IN_DEVELOPMENT → FAILED
   */
  readonly leaseTimedOutNoRetry?: boolean;

  /**
   * Whether the caller is an operator (human or escalation policy).
   * Required for: * → ESCALATED, * → CANCELLED, ESCALATED → *
   */
  readonly isOperator?: boolean;

  /**
   * Whether an automatic escalation trigger fired (per §2.7 escalation policy).
   * Required for: * → ESCALATED (when not operator-initiated)
   */
  readonly hasEscalationTrigger?: boolean;
}
```

### States Allowing Lease Acquisition

The following task states require `leaseAcquired: true` in their transition preconditions:

1. **READY → ASSIGNED**: Scheduler selects task and acquires first lease
2. **CHANGES_REQUESTED → ASSIGNED**: Scheduler re-selects task for rework; new lease acquired
3. **ESCALATED → ASSIGNED**: Operator resolves escalation by retrying task; new lease acquired

**Summary**: Lease acquisition is required whenever a task transitions INTO the `ASSIGNED` state, from any source state (READY, CHANGES_REQUESTED, or ESCALATED).

### Valid Transitions Map (Excerpt - Lease-Relevant)

```
BACKLOG → READY (dependencies resolved, no policy blockers)
BACKLOG → BLOCKED (blockers detected)
BLOCKED → READY (dependencies resolved, no policy blockers)
READY → ASSIGNED (lease acquired) ← LEASE ACQUISITION REQUIRED
ASSIGNED → IN_DEVELOPMENT (has heartbeat)
IN_DEVELOPMENT → DEV_COMPLETE (has dev result packet, validations passed)
IN_DEVELOPMENT → FAILED (unrecoverable failure OR lease timeout no retry)
DEV_COMPLETE → IN_REVIEW (review routing decision)
IN_REVIEW → CHANGES_REQUESTED (lead reviewer decision)
IN_REVIEW → APPROVED (lead reviewer decision)
CHANGES_REQUESTED → ASSIGNED (lease acquired) ← LEASE ACQUISITION REQUIRED
APPROVED → QUEUED_FOR_MERGE
QUEUED_FOR_MERGE → MERGING
MERGING → POST_MERGE_VALIDATION (merge successful)
MERGING → CHANGES_REQUESTED (merge conflict reworkable)
MERGING → FAILED (merge conflict non-reworkable)
POST_MERGE_VALIDATION → DONE (post-merge validation passed)
POST_MERGE_VALIDATION → FAILED (post-merge validation failed)

* → ESCALATED (operator action OR automatic trigger)
ESCALATED → ASSIGNED (operator action + lease acquired) ← LEASE ACQUISITION REQUIRED
ESCALATED → CANCELLED (operator action)
ESCALATED → DONE (operator action)

* → CANCELLED (operator action, excluding terminal states)
```

### Public API Functions

```typescript
export function validateTransition(
  current: TaskStatus,
  target: TaskStatus,
  context: TransitionContext = {},
): TransitionResult;

export function getValidTargets(current: TaskStatus): readonly TaskStatus[];

export function isTerminalState(state: TaskStatus): boolean;

export function getAllValidTransitions(): ReadonlyArray<readonly [TaskStatus, TaskStatus]>;
```

---

## 7. Transition Service

**File**: `packages/application/src/services/transition.service.ts` (lines 1-451)

### Result Types

```typescript
/**
 * Result of a successful state transition.
 * Contains the updated entity and the audit event that was persisted
 * atomically within the same transaction.
 */
export interface TransitionResult<T> {
  /** The entity after the status update (with new version for tasks). */
  readonly entity: T;
  /** The audit event persisted alongside the state change. */
  readonly auditEvent: AuditEventRecord;
}
```

### TransitionService Interface

```typescript
export interface TransitionService {
  /**
   * Transition a task to a new status.
   *
   * Uses the task state machine from `@factory/domain` for validation
   * and the task's `version` column for optimistic concurrency.
   *
   * @throws {EntityNotFoundError} If the task does not exist.
   * @throws {InvalidTransitionError} If the state machine rejects the transition.
   * @throws {VersionConflictError} If the task was modified concurrently.
   */
  transitionTask(
    taskId: string,
    targetStatus: TaskStatus,
    context: TransitionContext,
    actor: ActorInfo,
    metadata?: Record<string, unknown>,
  ): TransitionResult<TransitionableTask>;

  /**
   * Transition a task lease to a new status.
   *
   * Uses the worker lease state machine from `@factory/domain` for
   * validation and status-based optimistic concurrency.
   *
   * @throws {EntityNotFoundError} If the lease does not exist.
   * @throws {InvalidTransitionError} If the state machine rejects the transition.
   * @throws {VersionConflictError} If the lease was modified concurrently.
   */
  transitionLease(
    leaseId: string,
    targetStatus: WorkerLeaseStatus,
    context: WorkerLeaseTransitionContext,
    actor: ActorInfo,
    metadata?: Record<string, unknown>,
  ): TransitionResult<TransitionableTaskLease>;

  /**
   * Transition a review cycle to a new status.
   */
  transitionReviewCycle(
    reviewCycleId: string,
    targetStatus: ReviewCycleStatus,
    context: ReviewCycleTransitionContext,
    actor: ActorInfo,
    metadata?: Record<string, unknown>,
  ): TransitionResult<TransitionableReviewCycle>;

  /**
   * Transition a merge queue item to a new status.
   */
  transitionMergeQueueItem(
    itemId: string,
    targetStatus: MergeQueueItemStatus,
    context: MergeQueueItemTransitionContext,
    actor: ActorInfo,
    metadata?: Record<string, unknown>,
  ): TransitionResult<TransitionableMergeQueueItem>;
}
```

### Transaction Pattern (Per Transition Method)

Each transition method follows this atomic pattern:

1. **Fetch**: Retrieve the entity via its repository port
2. **Validate**: Run the state machine validation
3. **Update**: Update the entity status with optimistic concurrency
4. **Create**: Create an audit event atomically in the same transaction
5. **Emit**: Emit a domain event AFTER the transaction commits

### Optimistic Concurrency

- **Tasks**: Use explicit `version` column (incremented on every update)
- **TaskLease** (and other entities): Use status-based checks — the update verifies current status matches expectations before writing

### Factory Function

```typescript
export function createTransitionService(
  unitOfWork: UnitOfWork,
  eventEmitter: DomainEventEmitter,
): TransitionService;
```

---

## 8. Repository Port Interfaces

**File**: `packages/application/src/ports/repository.ports.ts` (lines 1-167)

### Transitional Entity Shapes

```typescript
/**
 * Minimal task record required by the transition service.
 * The full entity may have many more fields; the port only exposes
 * what transitions need.
 */
export interface TransitionableTask {
  readonly id: string;
  readonly status: TaskStatus;
  readonly version: number;
}

/**
 * Minimal task lease record required by the transition service.
 * Uses status-based optimistic concurrency (no version column).
 */
export interface TransitionableTaskLease {
  readonly id: string;
  readonly status: WorkerLeaseStatus;
}
```

### Task Repository Port

```typescript
/**
 * Port for task data access within a transition.
 *
 * `updateStatus` performs an optimistic concurrency check using the
 * task's `version` column. If `expectedVersion` does not match the
 * current version in the database, it must throw a `VersionConflictError`.
 */
export interface TaskRepositoryPort {
  findById(id: string): TransitionableTask | undefined;
  updateStatus(id: string, expectedVersion: number, newStatus: TaskStatus): TransitionableTask;
}
```

### TaskLease Repository Port

```typescript
/**
 * Port for task lease data access within a transition.
 *
 * `updateStatus` performs a status-based optimistic concurrency check.
 * If the entity's current status does not match `expectedStatus`, it
 * must throw a `VersionConflictError`.
 */
export interface TaskLeaseRepositoryPort {
  findById(id: string): TransitionableTaskLease | undefined;
  updateStatus(
    id: string,
    expectedStatus: WorkerLeaseStatus,
    newStatus: WorkerLeaseStatus,
  ): TransitionableTaskLease;
}
```

### Audit Event Repository Port

```typescript
export interface AuditEventRepositoryPort {
  create(event: NewAuditEvent): AuditEventRecord;
}

export interface AuditEventRecord {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly eventType: string;
  readonly actorType: string;
  readonly actorId: string;
  readonly oldState: string | null;
  readonly newState: string | null;
  readonly metadata: string | null;
  readonly createdAt: Date;
}

export interface NewAuditEvent {
  readonly entityType: string;
  readonly entityId: string;
  readonly eventType: string;
  readonly actorType: string;
  readonly actorId: string;
  readonly oldState: string | null;
  readonly newState: string | null;
  readonly metadata: string | null;
}
```

---

## 9. Unit of Work Port

**File**: `packages/application/src/ports/unit-of-work.port.ts` (lines 1-56)

```typescript
/**
 * Collection of repository ports available inside a transaction.
 *
 * Each repository instance is scoped to the current transaction so that
 * all reads and writes participate in the same atomic unit.
 */
export interface TransactionRepositories {
  readonly task: TaskRepositoryPort;
  readonly taskLease: TaskLeaseRepositoryPort;
  readonly reviewCycle: ReviewCycleRepositoryPort;
  readonly mergeQueueItem: MergeQueueItemRepositoryPort;
  readonly auditEvent: AuditEventRepositoryPort;
}

/**
 * Defines the contract for running operations inside a database transaction.
 *
 * Implementations must:
 * - Begin a write transaction before invoking `fn`
 * - Commit on success, rollback on exception
 * - Provide transaction-scoped repository instances via `TransactionRepositories`
 * - Guarantee that all writes within `fn` are atomic
 */
export interface UnitOfWork {
  /**
   * Execute `fn` inside a write transaction.
   *
   * The callback receives transaction-scoped repositories. All reads and
   * writes through these repositories participate in the same transaction.
   * If `fn` throws, the transaction is rolled back and the error propagates.
   *
   * @returns The value returned by `fn` after a successful commit.
   */
  runInTransaction<T>(fn: (repos: TransactionRepositories) => T): T;
}
```

---

## 10. TaskLease Repository Implementation

**File**: `apps/control-plane/src/infrastructure/repositories/task-lease.repository.ts` (lines 1-102)

### Type Exports

```typescript
/** A task lease row as read from the database. */
export type TaskLease = InferSelectModel<typeof taskLeases>;

/** Data required to insert a new task lease row. */
export type NewTaskLease = InferInsertModel<typeof taskLeases>;
```

### Repository API

```typescript
export function createTaskLeaseRepository(db: BetterSQLite3Database) {
  return {
    /** Find a task lease by its primary key. */
    findById(leaseId: string): TaskLease | undefined;

    /** Return all task leases, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): TaskLease[];

    /** Find all leases for a given task (active and historical). */
    findByTaskId(taskId: string): TaskLease[];

    /** Find all leases held by a given worker. */
    findByWorkerId(workerId: string): TaskLease[];

    /** Find all leases with a given status. */
    findByStatus(status: string): TaskLease[];

    /**
     * Find the active (non-terminal) lease for a given task, if any.
     * At most one active lease may exist per task (enforced at the app layer).
     */
    findActiveByTaskId(taskId: string): TaskLease | undefined;

    /** Insert a new task lease row. Returns the inserted row with defaults. */
    create(data: NewTaskLease): TaskLease;

    /** Update a task lease by primary key. Returns the updated row or undefined. */
    update(leaseId: string, data: Partial<Omit<NewTaskLease, "leaseId">>): TaskLease | undefined;

    /** Delete a task lease by primary key. Returns true if deleted. */
    delete(leaseId: string): boolean;
  };
}
```

**Terminal Lease Statuses** (as per repository implementation):

- `COMPLETED`
- `TIMED_OUT`
- `CRASHED`
- `RECLAIMED`

Note: The repository defines `COMPLETED` but the domain enums use `COMPLETING`. This represents the final terminal state.

---

## Summary of Lease-Related Connections

### Task State Machine & Lease Acquisition

**States that require lease acquisition** (all three require `leaseAcquired: true`):

1. `READY → ASSIGNED`: Initial lease for task execution
2. `CHANGES_REQUESTED → ASSIGNED`: Rework lease after review feedback
3. `ESCALATED → ASSIGNED`: Retry lease after escalation by operator

### Lease State Flow

**Typical Happy Path**:

```
IDLE → LEASED → STARTING → RUNNING → HEARTBEATING → COMPLETING
```

**Abnormal Paths**:

```
(STARTING|RUNNING|HEARTBEATING) → TIMED_OUT → RECLAIMED
(STARTING|RUNNING|HEARTBEATING) → CRASHED → RECLAIMED
```

### Lease-Task Integration Points

1. **Task.currentLeaseId**: FK field linking to the active lease
2. **Task.status**: Must be ASSIGNED or IN_DEVELOPMENT when lease is active
3. **Lease.taskId**: FK back to the task
4. **Lease.workerId**: Identifies the worker holding the lease
5. **Lease.poolId**: References the worker pool that dispatched the lease

### State Transition Authority

- **Lease transitions**: Validated by `WorkerLeaseStateMachine` (domain layer)
- **Task transitions**: Validated by `TaskStateMachine` (domain layer)
- **All transitions**: Committed atomically via `TransitionService` with optimistic concurrency and audit trails
