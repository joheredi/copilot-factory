/**
 * Application-layer error types for the transition service.
 *
 * These errors represent domain-meaningful failures that occur during
 * state transitions. They are thrown by the transition service and its
 * port implementations to communicate specific failure modes to callers.
 *
 * @module @factory/application/errors
 */

/**
 * Thrown when an entity required for a transition cannot be found.
 *
 * This typically indicates a stale reference — the caller has an ID
 * for an entity that no longer exists (or never existed).
 */
export class EntityNotFoundError extends Error {
  public readonly entityType: string;
  public readonly entityId: string;

  constructor(entityType: string, entityId: string) {
    super(`${entityType} not found: ${entityId}`);
    this.name = "EntityNotFoundError";
    this.entityType = entityType;
    this.entityId = entityId;
  }
}

/**
 * Thrown when a requested state transition violates the domain state machine.
 *
 * The transition was rejected by the domain-layer validation function.
 * The `reason` field contains the human-readable explanation from the
 * state machine guard that rejected the transition.
 */
export class InvalidTransitionError extends Error {
  public readonly entityType: string;
  public readonly entityId: string;
  public readonly fromStatus: string;
  public readonly toStatus: string;
  public readonly reason: string | undefined;

  constructor(
    entityType: string,
    entityId: string,
    fromStatus: string,
    toStatus: string,
    reason?: string,
  ) {
    const base = `Invalid transition for ${entityType} ${entityId}: ${fromStatus} → ${toStatus}`;
    super(reason ? `${base} — ${reason}` : base);
    this.name = "InvalidTransitionError";
    this.entityType = entityType;
    this.entityId = entityId;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
    this.reason = reason;
  }
}

/**
 * Thrown when an optimistic concurrency check fails during a state transition.
 *
 * This means another process modified the entity between when it was read
 * and when the transition service attempted to update it. The caller should
 * retry the operation with fresh data.
 */
export class VersionConflictError extends Error {
  public readonly entityType: string;
  public readonly entityId: string;
  public readonly expectedVersion: number | string;

  constructor(entityType: string, entityId: string, expectedVersion: number | string) {
    super(
      `Version conflict for ${entityType} ${entityId}: expected version ${String(expectedVersion)} is stale`,
    );
    this.name = "VersionConflictError";
    this.entityType = entityType;
    this.entityId = entityId;
    this.expectedVersion = expectedVersion;
  }
}

/**
 * Thrown when lease acquisition fails because the task already has an active lease.
 *
 * This enforces the one-active-lease-per-task invariant from PRD §2.1.
 * An active lease is one with status in (LEASED, STARTING, RUNNING,
 * HEARTBEATING, COMPLETING). The caller should not retry — the existing
 * lease must complete or be reclaimed before a new one can be acquired.
 *
 * @see docs/prd/002-data-model.md §2.1 — "only one active development lease per task"
 */
export class ExclusivityViolationError extends Error {
  public readonly taskId: string;
  public readonly existingLeaseId: string;

  constructor(taskId: string, existingLeaseId: string) {
    super(
      `Lease exclusivity violation for Task ${taskId}: active lease ${existingLeaseId} already exists`,
    );
    this.name = "ExclusivityViolationError";
    this.taskId = taskId;
    this.existingLeaseId = existingLeaseId;
  }
}

/**
 * Thrown when lease acquisition is attempted on a task whose current state
 * does not permit lease acquisition.
 *
 * Lease-eligible states are: READY, CHANGES_REQUESTED, ESCALATED.
 * Any other state (e.g., BACKLOG, IN_DEVELOPMENT, DONE) rejects acquisition.
 *
 * @see docs/prd/002-data-model.md §2.1 — Transitions to ASSIGNED
 */
/**
 * Thrown when adding a dependency edge would create a cycle in the
 * task dependency graph.
 *
 * The dependency graph must be a DAG (Directed Acyclic Graph). This error
 * is raised when the DependencyService detects that inserting the proposed
 * edge would violate this invariant.
 *
 * The `path` field contains the cycle path for diagnostic purposes,
 * e.g. ["task-A", "task-B", "task-C", "task-A"].
 *
 * @see docs/prd/002-data-model.md §2.3 — "Circular dependencies are rejected at creation time"
 */
export class CyclicDependencyError extends Error {
  public readonly taskId: string;
  public readonly dependsOnTaskId: string;
  public readonly path: readonly string[];

  constructor(taskId: string, dependsOnTaskId: string, path: readonly string[]) {
    super(
      `Circular dependency detected: adding ${taskId} → ${dependsOnTaskId} would create cycle: ${path.join(" → ")}`,
    );
    this.name = "CyclicDependencyError";
    this.taskId = taskId;
    this.dependsOnTaskId = dependsOnTaskId;
    this.path = path;
  }
}

/**
 * Thrown when attempting to add a dependency edge that already exists.
 *
 * The task dependency graph enforces a unique constraint on
 * (taskId, dependsOnTaskId) pairs — duplicate edges are not allowed.
 */
export class DuplicateDependencyError extends Error {
  public readonly taskId: string;
  public readonly dependsOnTaskId: string;

  constructor(taskId: string, dependsOnTaskId: string) {
    super(`Dependency already exists: ${taskId} → ${dependsOnTaskId}`);
    this.name = "DuplicateDependencyError";
    this.taskId = taskId;
    this.dependsOnTaskId = dependsOnTaskId;
  }
}

/**
 * Thrown when a dependency references a task that does not exist.
 *
 * Both the dependent task and the prerequisite task must exist in the
 * system before a dependency edge can be created.
 */
export class SelfDependencyError extends Error {
  public readonly taskId: string;

  constructor(taskId: string) {
    super(`A task cannot depend on itself: ${taskId}`);
    this.name = "SelfDependencyError";
    this.taskId = taskId;
  }
}

/**
 * Thrown when a heartbeat is received for a lease that is not in an active
 * state capable of receiving heartbeats.
 *
 * Heartbeat-receivable states are: STARTING, RUNNING, HEARTBEATING.
 * Any other state (e.g., IDLE, LEASED, TIMED_OUT, COMPLETING) rejects
 * the heartbeat.
 *
 * @see docs/prd/002-data-model.md §2.8 — Heartbeat Protocol
 */
export class LeaseNotActiveError extends Error {
  public readonly leaseId: string;
  public readonly currentStatus: string;

  constructor(leaseId: string, currentStatus: string) {
    super(
      `Lease ${leaseId} is not in an active state for heartbeat reception: current status is ${currentStatus}`,
    );
    this.name = "LeaseNotActiveError";
    this.leaseId = leaseId;
    this.currentStatus = currentStatus;
  }
}

export class TaskNotReadyForLeaseError extends Error {
  public readonly taskId: string;
  public readonly currentStatus: string;

  constructor(taskId: string, currentStatus: string) {
    super(
      `Task ${taskId} is not eligible for lease acquisition: current status is ${currentStatus}`,
    );
    this.name = "TaskNotReadyForLeaseError";
    this.taskId = taskId;
    this.currentStatus = currentStatus;
  }
}

/**
 * Thrown when a result is submitted for a lease that is not in a state
 * capable of accepting results (neither COMPLETING nor within the grace
 * period after TIMED_OUT).
 *
 * Valid result-accepting states: COMPLETING (normal), TIMED_OUT (within grace).
 * Any other state (e.g., RUNNING, HEARTBEATING, CRASHED, RECLAIMED) rejects results.
 *
 * @see docs/prd/002-data-model.md §2.8 — Graceful Completion
 */
export class LeaseNotAcceptingResultsError extends Error {
  public readonly leaseId: string;
  public readonly currentStatus: string;

  constructor(leaseId: string, currentStatus: string) {
    super(`Lease ${leaseId} is not accepting results: current status is ${currentStatus}`);
    this.name = "LeaseNotAcceptingResultsError";
    this.leaseId = leaseId;
    this.currentStatus = currentStatus;
  }
}

/**
 * Thrown when a result is submitted past the grace period deadline.
 *
 * For COMPLETING leases, the grace deadline is `expiresAt` (which was
 * extended by `gracePeriodSeconds` when the terminal heartbeat was received).
 * For TIMED_OUT leases, the grace deadline is `expiresAt + gracePeriodSeconds`.
 *
 * @see docs/prd/002-data-model.md §2.8 — Graceful Completion
 */
export class GracePeriodExpiredError extends Error {
  public readonly leaseId: string;
  public readonly graceDeadline: Date;
  public readonly receivedAt: Date;

  constructor(leaseId: string, graceDeadline: Date, receivedAt: Date) {
    super(
      `Grace period expired for lease ${leaseId}: deadline was ${graceDeadline.toISOString()}, result received at ${receivedAt.toISOString()}`,
    );
    this.name = "GracePeriodExpiredError";
    this.leaseId = leaseId;
    this.graceDeadline = graceDeadline;
    this.receivedAt = receivedAt;
  }
}

/**
 * Thrown when a result is submitted by a worker that does not match the
 * worker assigned to the lease. This prevents impersonation and ensures
 * only the lease holder can submit results.
 *
 * @see docs/prd/002-data-model.md §2.8 — "Verify IDs match"
 */
export class WorkerMismatchError extends Error {
  public readonly leaseId: string;
  public readonly expectedWorkerId: string;
  public readonly actualWorkerId: string;

  constructor(leaseId: string, expectedWorkerId: string, actualWorkerId: string) {
    super(
      `Worker mismatch for lease ${leaseId}: expected ${expectedWorkerId}, got ${actualWorkerId}`,
    );
    this.name = "WorkerMismatchError";
    this.leaseId = leaseId;
    this.expectedWorkerId = expectedWorkerId;
    this.actualWorkerId = actualWorkerId;
  }
}

/**
 * Thrown when a lease reclaim is attempted on a lease that is not in
 * a reclaimable state (STARTING, RUNNING, or HEARTBEATING).
 *
 * Only active leases that have been detected as stale or crashed can
 * be reclaimed. Terminal or idle leases cannot be reclaimed.
 *
 * @see docs/prd/002-data-model.md §2.8 — Stale Detection and Reclaim
 */
export class LeaseNotReclaimableError extends Error {
  public readonly leaseId: string;
  public readonly currentStatus: string;

  constructor(leaseId: string, currentStatus: string) {
    super(`Lease ${leaseId} is not in a reclaimable state: current status is ${currentStatus}`);
    this.name = "LeaseNotReclaimableError";
    this.leaseId = leaseId;
    this.currentStatus = currentStatus;
  }
}

/**
 * Thrown when a state transition is blocked by a validation gate.
 *
 * Gated transitions require the latest validation run for a specific
 * profile to have passed before the transition is allowed. This error
 * is raised when no passing validation run exists.
 *
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.5.2 — Validation Gates
 * @see docs/backlog/tasks/T057-validation-gates.md
 */
export class ValidationGateError extends Error {
  public readonly taskId: string;
  public readonly fromStatus: string;
  public readonly toStatus: string;
  public readonly requiredProfile: string;
  public readonly reason: string;

  constructor(
    taskId: string,
    fromStatus: string,
    toStatus: string,
    requiredProfile: string,
    reason: string,
  ) {
    super(`Validation gate blocked ${fromStatus} → ${toStatus} for task ${taskId}: ${reason}`);
    this.name = "ValidationGateError";
    this.taskId = taskId;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
    this.requiredProfile = requiredProfile;
    this.reason = reason;
  }
}
