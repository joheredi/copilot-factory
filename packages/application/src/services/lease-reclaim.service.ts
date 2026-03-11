/**
 * Lease reclaim service — recovers from worker failures by reclaiming stale
 * or crashed leases and applying retry/escalation policy to the task.
 *
 * This service implements the crash recovery protocol from PRD §2.8:
 *
 * 1. Validates the lease is in an active state eligible for reclaim
 * 2. Transitions the lease to TIMED_OUT or CRASHED based on the reclaim reason
 * 3. Evaluates retry policy to determine if the task can be retried
 * 4. If retry-eligible: transitions the task back to READY for rescheduling
 * 5. If retries exhausted: evaluates escalation policy to determine FAILED or ESCALATED
 * 6. Increments retry_count when a retry is granted
 * 7. Records an audit event capturing all decisions
 * 8. Emits domain events after the transaction commits
 *
 * All steps 1–7 execute inside a single database transaction. If any step
 * fails, the entire operation is rolled back and no domain events are emitted.
 *
 * @see docs/prd/002-data-model.md §2.8 — Worker Lease Protocol (Crash Recovery)
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.6 — Retry Policy
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.7 — Escalation Policy
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8 — Lease and Heartbeat Policy
 * @module @factory/application/services/lease-reclaim.service
 */

import {
  TaskStatus,
  WorkerLeaseStatus,
  validateTransition,
  validateWorkerLeaseTransition,
  type TransitionContext,
  type WorkerLeaseTransitionContext,
  type RetryPolicy,
  type RetryEvaluation,
  shouldRetry,
  type EscalationPolicy,
  type EscalationEvaluation,
  shouldEscalate,
  EscalationTrigger,
} from "@factory/domain";

import {
  EntityNotFoundError,
  InvalidTransitionError,
  LeaseNotReclaimableError,
} from "../errors.js";

import type { AuditEventRecord } from "../ports/repository.ports.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { ActorInfo } from "../events/domain-events.js";
import type {
  ReclaimUnitOfWork,
  ReclaimableLease,
  ReclaimableTask,
} from "../ports/lease-reclaim.ports.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Lease states from which a reclaim can be initiated.
 *
 * Only active leases that are processing work can be reclaimed.
 * LEASED is excluded because the worker hasn't started yet — that
 * would be handled by a different timeout mechanism.
 *
 * @see docs/prd/002-data-model.md §2.2 — Worker Lease State Machine
 */
const RECLAIMABLE_STATES: ReadonlySet<WorkerLeaseStatus> = new Set([
  WorkerLeaseStatus.STARTING,
  WorkerLeaseStatus.RUNNING,
  WorkerLeaseStatus.HEARTBEATING,
]);

/**
 * Task states from which a reclaim can transition the task.
 *
 * The task may be in ASSIGNED (worker never sent first heartbeat)
 * or IN_DEVELOPMENT (worker was actively working).
 */
const RECLAIM_ELIGIBLE_TASK_STATES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.ASSIGNED,
  TaskStatus.IN_DEVELOPMENT,
]);

// ─── Service Input/Output Types ─────────────────────────────────────────────

/**
 * Reason for reclaiming a lease, used to determine the target lease state.
 *
 * - `missed_heartbeats`: Worker stopped sending heartbeats → TIMED_OUT
 * - `ttl_expired`: Lease absolute TTL exceeded → TIMED_OUT
 * - `worker_crashed`: Worker process exited abnormally → CRASHED
 */
export type ReclaimReason = "missed_heartbeats" | "ttl_expired" | "worker_crashed";

/**
 * Parameters for reclaiming a stale or crashed lease.
 */
export interface ReclaimLeaseParams {
  /** ID of the lease to reclaim. */
  readonly leaseId: string;
  /** Why the lease is being reclaimed. Determines target lease state. */
  readonly reason: ReclaimReason;
  /** The effective retry policy for this task. */
  readonly retryPolicy: RetryPolicy;
  /** The effective escalation policy for this task. */
  readonly escalationPolicy: EscalationPolicy;
  /**
   * Whether a failure summary packet exists for this run.
   * Required by some retry policies before permitting a retry.
   */
  readonly hasFailureSummary?: boolean;
  /** Who is initiating the reclaim (typically "system" for automated reclaim). */
  readonly actor: ActorInfo;
  /** Optional metadata to include in the audit event. */
  readonly metadata?: Record<string, unknown>;
}

/**
 * The outcome of the reclaim operation with respect to the task.
 *
 * - `retried`: Task returned to READY for rescheduling
 * - `failed`: Task moved to FAILED (no retry, escalation says fail)
 * - `escalated`: Task moved to ESCALATED (no retry, escalation says escalate)
 */
export type ReclaimOutcome = "retried" | "failed" | "escalated";

/**
 * Result of a successful lease reclaim operation.
 *
 * Contains the final state of both the lease and the task, the outcome
 * decision, the retry and escalation evaluations that led to the decision,
 * and the audit event recording all details.
 */
export interface ReclaimLeaseResult {
  /** The lease after transitioning to TIMED_OUT or CRASHED. */
  readonly lease: ReclaimableLease;
  /** The task after transitioning to READY, FAILED, or ESCALATED. */
  readonly task: ReclaimableTask;
  /** What happened to the task as a result of the reclaim. */
  readonly outcome: ReclaimOutcome;
  /** The retry evaluation that determined retry eligibility. */
  readonly retryEvaluation: RetryEvaluation;
  /** The escalation evaluation (only present when retry was not eligible). */
  readonly escalationEvaluation: EscalationEvaluation | null;
  /** The audit event recording this reclaim. */
  readonly auditEvent: AuditEventRecord;
}

/**
 * Lease reclaim service interface.
 *
 * Provides the `reclaimLease` operation that atomically reclaims a stale
 * or crashed lease and applies retry/escalation policy to the task.
 */
export interface LeaseReclaimService {
  /**
   * Reclaim a stale or crashed lease and apply retry/escalation policy.
   *
   * Atomically transitions the lease to a terminal state, evaluates
   * retry eligibility, transitions the task accordingly, and records
   * an audit event. Emits domain events after commit.
   *
   * @throws EntityNotFoundError if the lease or task does not exist
   * @throws LeaseNotReclaimableError if the lease is not in an active state
   * @throws InvalidTransitionError if the domain state machine rejects the transition
   * @throws VersionConflictError if another process modified the task concurrently
   */
  reclaimLease(params: ReclaimLeaseParams): ReclaimLeaseResult;
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Determine the target lease state based on the reclaim reason.
 *
 * Heartbeat timeout and TTL expiry both map to TIMED_OUT.
 * Worker process crash maps to CRASHED.
 *
 * @param reason - The reason for the reclaim
 * @returns The target WorkerLeaseStatus for the lease
 */
function determineLeaseTargetState(reason: ReclaimReason): WorkerLeaseStatus {
  switch (reason) {
    case "missed_heartbeats":
    case "ttl_expired":
      return WorkerLeaseStatus.TIMED_OUT;
    case "worker_crashed":
      return WorkerLeaseStatus.CRASHED;
  }
}

/**
 * Build the worker lease state machine context for the reclaim transition.
 *
 * @param targetState - The target lease state (TIMED_OUT or CRASHED)
 * @returns The context for the worker lease state machine validation
 */
function buildLeaseTransitionContext(targetState: WorkerLeaseStatus): WorkerLeaseTransitionContext {
  if (targetState === WorkerLeaseStatus.TIMED_OUT) {
    return { heartbeatTimedOut: true };
  }
  return { workerCrashed: true };
}

/**
 * Determine the task outcome based on retry and escalation evaluation.
 *
 * Evaluates retry eligibility first. If the task can be retried, it
 * returns to READY. If retries are exhausted, escalation policy
 * determines whether the task is FAILED or ESCALATED.
 *
 * @param task - The current task state
 * @param retryPolicy - The effective retry policy
 * @param escalationPolicy - The effective escalation policy
 * @param hasFailureSummary - Whether a failure summary packet exists
 * @returns Object with outcome, target task status, retry evaluation, escalation evaluation, and new retry count
 */
function evaluateTaskOutcome(
  task: ReclaimableTask,
  retryPolicy: RetryPolicy,
  escalationPolicy: EscalationPolicy,
  hasFailureSummary: boolean,
): {
  outcome: ReclaimOutcome;
  targetStatus: TaskStatus;
  retryEvaluation: RetryEvaluation;
  escalationEvaluation: EscalationEvaluation | null;
  newRetryCount: number;
} {
  // Step 1: Evaluate retry eligibility
  const retryEvaluation = shouldRetry(
    {
      retry_count: task.retryCount,
      has_failure_summary: hasFailureSummary,
    },
    retryPolicy,
  );

  // Step 2: If retry is eligible, task returns to READY
  if (retryEvaluation.eligible) {
    return {
      outcome: "retried",
      targetStatus: TaskStatus.READY,
      retryEvaluation,
      escalationEvaluation: null,
      newRetryCount: task.retryCount + 1,
    };
  }

  // Step 3: Retry exhausted — evaluate escalation policy
  const escalationEvaluation = shouldEscalate(
    {
      trigger: EscalationTrigger.HEARTBEAT_TIMEOUT,
      retry_count: task.retryCount,
      max_attempts: retryPolicy.max_attempts,
    },
    escalationPolicy,
  );

  // Step 4: Determine task outcome from escalation action
  if (escalationEvaluation.should_escalate) {
    const action = escalationEvaluation.action;

    if (action === "fail_then_escalate") {
      // fail_then_escalate: move to FAILED first; escalation is a follow-up
      return {
        outcome: "failed",
        targetStatus: TaskStatus.FAILED,
        retryEvaluation,
        escalationEvaluation,
        newRetryCount: task.retryCount,
      };
    }

    // "escalate", "retry_or_escalate" (retry already failed), "disable_profile_and_escalate"
    return {
      outcome: "escalated",
      targetStatus: TaskStatus.ESCALATED,
      retryEvaluation,
      escalationEvaluation,
      newRetryCount: task.retryCount,
    };
  }

  // Escalation did not fire — default to FAILED
  return {
    outcome: "failed",
    targetStatus: TaskStatus.FAILED,
    retryEvaluation,
    escalationEvaluation,
    newRetryCount: task.retryCount,
  };
}

/**
 * Build the task state machine context for the reclaim-driven transition.
 *
 * @param targetStatus - The target task status
 * @returns The TransitionContext for the task state machine validation
 */
function buildTaskTransitionContext(targetStatus: TaskStatus): TransitionContext {
  switch (targetStatus) {
    case TaskStatus.READY:
      return { leaseReclaimedRetryEligible: true };
    case TaskStatus.FAILED:
      return { leaseTimedOutNoRetry: true };
    case TaskStatus.ESCALATED:
      return { hasEscalationTrigger: true };
    default:
      return {};
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a lease reclaim service with injected dependencies.
 *
 * @param unitOfWork - Transaction boundary for atomic operations
 * @param eventEmitter - Publishes domain events after transaction commit
 */
export function createLeaseReclaimService(
  unitOfWork: ReclaimUnitOfWork,
  eventEmitter: DomainEventEmitter,
): LeaseReclaimService {
  return {
    reclaimLease(params: ReclaimLeaseParams): ReclaimLeaseResult {
      const {
        leaseId,
        reason,
        retryPolicy,
        escalationPolicy,
        hasFailureSummary = false,
        actor,
        metadata,
      } = params;

      // Determine the target lease state from the reclaim reason
      const leaseTargetState = determineLeaseTargetState(reason);

      const transactionResult = unitOfWork.runInTransaction((repos) => {
        // Step 1: Fetch the lease
        const lease = repos.lease.findById(leaseId);
        if (!lease) {
          throw new EntityNotFoundError("TaskLease", leaseId);
        }

        // Step 2: Verify the lease is in a reclaimable state
        if (!RECLAIMABLE_STATES.has(lease.status)) {
          throw new LeaseNotReclaimableError(leaseId, lease.status);
        }

        // Step 3: Validate lease transition via the domain state machine
        const leaseTransitionCtx = buildLeaseTransitionContext(leaseTargetState);
        const leaseValidation = validateWorkerLeaseTransition(
          lease.status,
          leaseTargetState,
          leaseTransitionCtx,
        );
        if (!leaseValidation.valid) {
          throw new InvalidTransitionError(
            "TaskLease",
            leaseId,
            lease.status,
            leaseTargetState,
            leaseValidation.reason,
          );
        }

        // Step 4: Update lease status atomically
        const updatedLease = repos.lease.updateStatusWithReason(
          leaseId,
          lease.status,
          leaseTargetState,
          reason,
        );

        // Step 5: Fetch the associated task
        const task = repos.task.findById(lease.taskId);
        if (!task) {
          throw new EntityNotFoundError("Task", lease.taskId);
        }

        // Step 6: Verify the task is in a reclaim-eligible state
        if (!RECLAIM_ELIGIBLE_TASK_STATES.has(task.status)) {
          // Task has already been transitioned by another process (race condition).
          // This is not an error — we still record the lease reclaim.
          // Return the current state without modifying the task.
          const noopRetryEvaluation: RetryEvaluation = {
            eligible: false,
            backoff_seconds: 0,
            next_attempt: task.retryCount + 1,
            reason: `Task is not in a reclaim-eligible state: ${task.status}`,
          };

          const auditEvent = repos.auditEvent.create({
            entityType: "task-lease",
            entityId: leaseId,
            eventType: "lease.reclaimed",
            actorType: actor.type,
            actorId: actor.id,
            oldState: JSON.stringify({
              leaseStatus: lease.status,
              taskStatus: task.status,
              taskVersion: task.version,
              retryCount: task.retryCount,
            }),
            newState: JSON.stringify({
              leaseStatus: updatedLease.status,
              taskStatus: task.status,
              taskVersion: task.version,
              outcome: "noop_task_already_transitioned",
              reason,
            }),
            metadata: metadata ? JSON.stringify(metadata) : null,
          });

          return {
            lease: updatedLease,
            task,
            outcome: "failed" as ReclaimOutcome,
            retryEvaluation: noopRetryEvaluation,
            escalationEvaluation: null,
            auditEvent,
            previousLeaseStatus: lease.status,
            previousTaskStatus: task.status,
          };
        }

        // Step 7: Evaluate retry/escalation policy
        const taskOutcome = evaluateTaskOutcome(
          task,
          retryPolicy,
          escalationPolicy,
          hasFailureSummary,
        );

        // Step 8: Validate task transition via the domain state machine
        const taskTransitionCtx = buildTaskTransitionContext(taskOutcome.targetStatus);
        const taskValidation = validateTransition(
          task.status,
          taskOutcome.targetStatus,
          taskTransitionCtx,
        );
        if (!taskValidation.valid) {
          throw new InvalidTransitionError(
            "Task",
            task.id,
            task.status,
            taskOutcome.targetStatus,
            taskValidation.reason,
          );
        }

        // Step 9: Update task status and retry count atomically
        const updatedTask = repos.task.updateStatusAndRetryCount(
          task.id,
          task.version,
          taskOutcome.targetStatus,
          taskOutcome.newRetryCount,
        );

        // Step 10: Record audit event
        const auditEvent = repos.auditEvent.create({
          entityType: "task-lease",
          entityId: leaseId,
          eventType: "lease.reclaimed",
          actorType: actor.type,
          actorId: actor.id,
          oldState: JSON.stringify({
            leaseStatus: lease.status,
            taskStatus: task.status,
            taskVersion: task.version,
            retryCount: task.retryCount,
          }),
          newState: JSON.stringify({
            leaseStatus: updatedLease.status,
            taskStatus: updatedTask.status,
            taskVersion: updatedTask.version,
            retryCount: updatedTask.retryCount,
            outcome: taskOutcome.outcome,
            reason,
            retryEligible: taskOutcome.retryEvaluation.eligible,
            escalationAction: taskOutcome.escalationEvaluation?.action ?? null,
          }),
          metadata: metadata ? JSON.stringify(metadata) : null,
        });

        return {
          lease: updatedLease,
          task: updatedTask,
          outcome: taskOutcome.outcome,
          retryEvaluation: taskOutcome.retryEvaluation,
          escalationEvaluation: taskOutcome.escalationEvaluation,
          auditEvent,
          previousLeaseStatus: lease.status,
          previousTaskStatus: task.status,
        };
      });

      // ── Domain events emitted AFTER successful commit ─────────────────
      // Lease transition event
      eventEmitter.emit({
        type: "task-lease.transitioned",
        entityType: "task-lease",
        entityId: leaseId,
        actor,
        timestamp: new Date(),
        fromStatus: transactionResult.previousLeaseStatus,
        toStatus: transactionResult.lease.status,
      });

      // Task transition event
      eventEmitter.emit({
        type: "task.transitioned",
        entityType: "task",
        entityId: transactionResult.task.id,
        actor,
        timestamp: new Date(),
        fromStatus: transactionResult.previousTaskStatus,
        toStatus: transactionResult.task.status,
        newVersion: transactionResult.task.version,
      });

      return {
        lease: transactionResult.lease,
        task: transactionResult.task,
        outcome: transactionResult.outcome,
        retryEvaluation: transactionResult.retryEvaluation,
        escalationEvaluation: transactionResult.escalationEvaluation,
        auditEvent: transactionResult.auditEvent,
      };
    },
  };
}
