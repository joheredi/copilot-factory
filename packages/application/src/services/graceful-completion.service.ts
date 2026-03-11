/**
 * Graceful completion service — manages the result acceptance protocol
 * for the worker lease lifecycle.
 *
 * This service implements the grace-period-aware result acceptance logic
 * described in PRD §2.8 (Graceful Completion). It determines whether a
 * worker's result can be accepted based on the lease's current state and
 * timing constraints:
 *
 * 1. **COMPLETING leases** — The worker sent a terminal heartbeat and the
 *    lease is in COMPLETING state. The result is accepted if it arrives
 *    before `expiresAt` (which was extended by `gracePeriodSeconds` during
 *    the terminal heartbeat). This is the normal happy path.
 *
 * 2. **TIMED_OUT leases (race condition)** — The staleness detector marked
 *    the lease TIMED_OUT before the terminal heartbeat arrived. The result
 *    is still accepted if it arrives within `gracePeriodSeconds` of the
 *    lease's `expiresAt`, preventing valid work from being lost due to
 *    timing races between heartbeat reception and staleness detection.
 *
 * In both cases, the service verifies the worker ID matches the lease holder
 * to prevent impersonation.
 *
 * The service records audit events for both accepted and rejected results
 * to maintain a complete audit trail of the completion protocol.
 *
 * @see docs/prd/002-data-model.md §2.8 — Graceful Completion
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8 — Lease and Heartbeat Policy
 * @module @factory/application/services/graceful-completion.service
 */

import { WorkerLeaseStatus } from "@factory/domain";

import {
  EntityNotFoundError,
  LeaseNotAcceptingResultsError,
  GracePeriodExpiredError,
  WorkerMismatchError,
} from "../errors.js";

import type { AuditEventRecord } from "../ports/repository.ports.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { ActorInfo } from "../events/domain-events.js";
import type { CompletionUnitOfWork, CompletionLease } from "../ports/graceful-completion.ports.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Lease states from which results can potentially be accepted.
 *
 * - COMPLETING: normal completion flow (worker sent terminal heartbeat)
 * - TIMED_OUT: race condition flow (staleness detector fired before
 *   terminal heartbeat arrived, but result may still be within grace period)
 *
 * @see docs/prd/002-data-model.md §2.8 — Graceful Completion
 */
const RESULT_ACCEPTING_STATES: ReadonlySet<WorkerLeaseStatus> = new Set([
  WorkerLeaseStatus.COMPLETING,
  WorkerLeaseStatus.TIMED_OUT,
]);

// ─── Service Input/Output Types ─────────────────────────────────────────────

/**
 * Parameters for accepting a result from a worker.
 */
export interface AcceptResultParams {
  /** ID of the lease the result is for. */
  readonly leaseId: string;
  /** ID of the worker submitting the result. Must match the lease holder. */
  readonly workerId: string;
  /**
   * Grace period in seconds for late result acceptance.
   *
   * - For COMPLETING leases: the grace window was already applied to expiresAt
   *   during the terminal heartbeat. The result must arrive before expiresAt.
   * - For TIMED_OUT leases: the result must arrive within gracePeriodSeconds
   *   after the lease's expiresAt (since no terminal heartbeat extended it).
   */
  readonly gracePeriodSeconds: number;
  /** Who is submitting the result. */
  readonly actor: ActorInfo;
  /** Optional metadata about the result (e.g., summary, artifact references). */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Result of a successful result acceptance.
 *
 * Contains the lease state at the time of acceptance and the audit event
 * recording the acceptance. The `lateAcceptance` flag indicates whether
 * the result was accepted via the race-condition grace window (TIMED_OUT)
 * rather than the normal COMPLETING flow.
 */
export interface AcceptResultResult {
  /** The lease at the time of result acceptance. */
  readonly lease: CompletionLease;
  /** Whether this was a late acceptance for a TIMED_OUT lease. */
  readonly lateAcceptance: boolean;
  /** The audit event recording the acceptance. */
  readonly auditEvent: AuditEventRecord;
}

/**
 * Graceful completion service interface.
 *
 * Provides result acceptance with grace period logic for the worker
 * lease protocol. This is the control-plane's responsibility for
 * determining whether a worker's result can be accepted based on lease
 * state and timing constraints.
 */
export interface GracefulCompletionService {
  /**
   * Validate and accept a result from a worker.
   *
   * Checks the lease state, worker identity, and grace period window
   * to determine whether the result can be accepted.
   *
   * @throws EntityNotFoundError if the lease does not exist
   * @throws WorkerMismatchError if the worker ID does not match the lease holder
   * @throws LeaseNotAcceptingResultsError if the lease is not in COMPLETING or TIMED_OUT state
   * @throws GracePeriodExpiredError if the result arrived past the grace deadline
   */
  acceptResult(params: AcceptResultParams): AcceptResultResult;
}

// ─── Grace Period Computation ───────────────────────────────────────────────

/**
 * Compute the grace deadline for a given lease and grace period.
 *
 * For COMPLETING leases: the expiresAt was already extended by the
 * terminal heartbeat, so the deadline IS expiresAt.
 *
 * For TIMED_OUT leases: the terminal heartbeat never arrived (or arrived
 * too late), so expiresAt is the original TTL. We add gracePeriodSeconds
 * to give a window for the race condition.
 *
 * @param lease - The lease to compute the deadline for
 * @param gracePeriodSeconds - The grace window in seconds
 * @returns The absolute deadline by which the result must be received
 */
export function computeGraceDeadline(lease: CompletionLease, gracePeriodSeconds: number): Date {
  if (lease.status === WorkerLeaseStatus.COMPLETING) {
    // Terminal heartbeat already extended expiresAt
    return lease.expiresAt;
  }

  // TIMED_OUT: add grace period to the original expiry
  return new Date(lease.expiresAt.getTime() + gracePeriodSeconds * 1000);
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a graceful completion service with injected dependencies.
 *
 * @param unitOfWork - Transaction boundary for atomic operations
 * @param eventEmitter - Publishes domain events after transaction commit
 * @param clock - Time source for grace period computation (injectable for testing)
 */
export function createGracefulCompletionService(
  unitOfWork: CompletionUnitOfWork,
  eventEmitter: DomainEventEmitter,
  clock: () => Date = () => new Date(),
): GracefulCompletionService {
  return {
    acceptResult(params: AcceptResultParams): AcceptResultResult {
      const { leaseId, workerId, gracePeriodSeconds, actor, metadata } = params;

      const transactionResult = unitOfWork.runInTransaction((repos) => {
        // Step 1: Fetch the lease
        const lease = repos.lease.findById(leaseId);
        if (!lease) {
          throw new EntityNotFoundError("TaskLease", leaseId);
        }

        // Step 2: Verify worker identity — only the lease holder can submit results
        if (lease.workerId !== workerId) {
          throw new WorkerMismatchError(leaseId, lease.workerId, workerId);
        }

        // Step 3: Verify the lease is in a result-accepting state
        if (!RESULT_ACCEPTING_STATES.has(lease.status)) {
          throw new LeaseNotAcceptingResultsError(leaseId, lease.status);
        }

        // Step 4: Compute and enforce the grace deadline
        const now = clock();
        const graceDeadline = computeGraceDeadline(lease, gracePeriodSeconds);

        if (now.getTime() > graceDeadline.getTime()) {
          // Record the rejection as an audit event before throwing
          repos.auditEvent.create({
            entityType: "task-lease",
            entityId: leaseId,
            eventType: "lease.result-rejected",
            actorType: actor.type,
            actorId: actor.id,
            oldState: JSON.stringify({
              status: lease.status,
              expiresAt: lease.expiresAt.toISOString(),
            }),
            newState: JSON.stringify({
              graceDeadline: graceDeadline.toISOString(),
              receivedAt: now.toISOString(),
              reason: "grace_period_expired",
            }),
            metadata: metadata ? JSON.stringify(metadata) : null,
          });

          throw new GracePeriodExpiredError(leaseId, graceDeadline, now);
        }

        // Step 5: Accept the result — record audit event
        const lateAcceptance = lease.status === WorkerLeaseStatus.TIMED_OUT;

        const auditEvent = repos.auditEvent.create({
          entityType: "task-lease",
          entityId: leaseId,
          eventType: lateAcceptance ? "lease.result-accepted-late" : "lease.result-accepted",
          actorType: actor.type,
          actorId: actor.id,
          oldState: JSON.stringify({
            status: lease.status,
            expiresAt: lease.expiresAt.toISOString(),
          }),
          newState: JSON.stringify({
            accepted: true,
            lateAcceptance,
            graceDeadline: graceDeadline.toISOString(),
            receivedAt: now.toISOString(),
          }),
          metadata: metadata ? JSON.stringify(metadata) : null,
        });

        return {
          lease,
          lateAcceptance,
          auditEvent,
        };
      });

      // ── Domain events emitted AFTER successful commit ─────────────────

      eventEmitter.emit({
        type: "task-lease.transitioned",
        entityType: "task-lease",
        entityId: leaseId,
        actor,
        timestamp: clock(),
        fromStatus: transactionResult.lease.status,
        toStatus: transactionResult.lease.status,
      });

      return {
        lease: transactionResult.lease,
        lateAcceptance: transactionResult.lateAcceptance,
        auditEvent: transactionResult.auditEvent,
      };
    },
  };
}
