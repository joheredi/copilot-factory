/**
 * Heartbeat reception and staleness detection service.
 *
 * Provides two core operations for the lease heartbeat protocol:
 *
 * 1. **receiveHeartbeat** — Processes an incoming heartbeat from a worker,
 *    updates the lease's heartbeat timestamp, and transitions the lease
 *    state as appropriate (STARTING → RUNNING, RUNNING → HEARTBEATING,
 *    HEARTBEATING → HEARTBEATING self-loop, or → COMPLETING for terminal
 *    heartbeats). All mutations happen atomically in a single transaction.
 *
 * 2. **detectStaleLeases** — Queries for active leases that have missed
 *    their heartbeat threshold (interval × missed_count + grace) or
 *    exceeded their absolute TTL. Returns classified results for
 *    downstream reclaim processing (T033).
 *
 * The service validates heartbeats against the domain state machine before
 * committing any changes. Invalid heartbeats (wrong lease state, completed
 * leases) are rejected with descriptive errors.
 *
 * @see docs/prd/002-data-model.md §2.8 — Worker Lease Protocol
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8 — Lease and Heartbeat Policy
 * @module @factory/application/services/heartbeat.service
 */

import {
  WorkerLeaseStatus,
  validateWorkerLeaseTransition,
  type WorkerLeaseTransitionContext,
} from "@factory/domain";

import { EntityNotFoundError, InvalidTransitionError, LeaseNotActiveError } from "../errors.js";

import type { AuditEventRecord } from "../ports/repository.ports.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { ActorInfo } from "../events/domain-events.js";
import type {
  HeartbeatUnitOfWork,
  HeartbeatableLease,
  StaleLeaseRecord,
} from "../ports/heartbeat.ports.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Lease states that can receive heartbeats.
 *
 * - STARTING: first heartbeat confirms worker startup → RUNNING
 * - RUNNING: subsequent heartbeat → HEARTBEATING
 * - HEARTBEATING: further heartbeat → HEARTBEATING (self-loop)
 *
 * @see docs/prd/002-data-model.md §2.2 — Worker Lease State Machine
 */
const HEARTBEAT_RECEIVABLE_STATES: ReadonlySet<WorkerLeaseStatus> = new Set([
  WorkerLeaseStatus.STARTING,
  WorkerLeaseStatus.RUNNING,
  WorkerLeaseStatus.HEARTBEATING,
]);

// ─── Service Input/Output Types ─────────────────────────────────────────────

/**
 * Parameters for receiving a heartbeat from a worker.
 */
export interface ReceiveHeartbeatParams {
  /** ID of the lease the heartbeat is for. */
  readonly leaseId: string;
  /**
   * If true, this is a terminal heartbeat indicating the worker is about
   * to emit a result packet. Transitions the lease to COMPLETING.
   *
   * @see docs/prd/009-policy-and-enforcement-spec.md §9.8 — Graceful Completion Protocol
   */
  readonly completing?: boolean;
  /** Optional metadata from the worker (e.g., progress, resource usage). */
  readonly workerMetadata?: Record<string, unknown>;
  /** Who is sending the heartbeat. */
  readonly actor: ActorInfo;
}

/**
 * Result of a successful heartbeat reception.
 */
export interface ReceiveHeartbeatResult {
  /** The lease after updating heartbeat timestamp and status. */
  readonly lease: HeartbeatableLease;
  /** The lease status before the heartbeat was processed. */
  readonly previousStatus: WorkerLeaseStatus;
  /** The audit event recording this heartbeat. */
  readonly auditEvent: AuditEventRecord;
}

/**
 * Staleness policy configuration that controls when a lease is
 * considered stale. Values come from the lease/heartbeat policy.
 *
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8 — Lease and Heartbeat Policy
 */
export interface StalenessPolicy {
  /** How often workers must send heartbeats (default: 30s). */
  readonly heartbeatIntervalSeconds: number;
  /** How many consecutive heartbeat intervals can be missed (default: 2). */
  readonly missedHeartbeatThreshold: number;
  /** Extra grace period after the last missed interval (default: 15s). */
  readonly gracePeriodSeconds: number;
}

/**
 * Reason why a lease was classified as stale.
 *
 * - `missed_heartbeats`: The worker missed too many consecutive heartbeat intervals.
 * - `ttl_expired`: The lease's absolute time-to-live has been exceeded,
 *   regardless of heartbeat status.
 */
export type StalenessReason = "missed_heartbeats" | "ttl_expired";

/**
 * A stale lease with its classified reason for staleness.
 */
export interface StaleLeaseInfo {
  /** ID of the stale lease. */
  readonly leaseId: string;
  /** ID of the task this lease is for. */
  readonly taskId: string;
  /** ID of the worker holding this lease. */
  readonly workerId: string;
  /** ID of the pool the worker belongs to. */
  readonly poolId: string;
  /** Current lease status. */
  readonly status: WorkerLeaseStatus;
  /** Last heartbeat timestamp (null if no heartbeat ever received). */
  readonly heartbeatAt: Date | null;
  /** When the lease expires (absolute TTL). */
  readonly expiresAt: Date;
  /** When the lease was acquired. */
  readonly leasedAt: Date;
  /** Why this lease was classified as stale. */
  readonly reason: StalenessReason;
}

/**
 * Result of staleness detection.
 */
export interface DetectStaleLeasesResult {
  /** All leases classified as stale, with reasons. */
  readonly staleLeases: readonly StaleLeaseInfo[];
}

/**
 * Heartbeat service interface.
 *
 * Provides heartbeat reception and staleness detection for the worker
 * lease protocol. These are the control-plane's responsibilities in the
 * heartbeat lifecycle — workers send heartbeats, this service processes them.
 */
export interface HeartbeatService {
  /**
   * Process an incoming heartbeat from a worker.
   *
   * Updates the lease's heartbeat timestamp and transitions the lease
   * state as appropriate. For terminal heartbeats (completing=true),
   * transitions the lease to COMPLETING.
   *
   * @throws EntityNotFoundError if the lease does not exist
   * @throws LeaseNotActiveError if the lease is not in a heartbeat-receivable state
   * @throws InvalidTransitionError if the domain state machine rejects the transition
   * @throws VersionConflictError if another process modified the lease concurrently
   */
  receiveHeartbeat(params: ReceiveHeartbeatParams): ReceiveHeartbeatResult;

  /**
   * Detect all active leases that are stale according to the given policy.
   *
   * A lease is stale when:
   * - Its effective heartbeat time (heartbeat_at, or leased_at if null)
   *   is older than `now - (interval × missed_threshold + grace_period)`.
   * - OR its absolute TTL has been exceeded (expires_at < now).
   *
   * This is a read-only operation suitable for background reconciliation.
   * The returned leases should be processed by reclaim logic (T033).
   */
  detectStaleLeases(policy: StalenessPolicy): DetectStaleLeasesResult;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Compute the target lease state for a heartbeat based on the current state
 * and whether this is a terminal (completing) heartbeat.
 *
 * @param currentStatus - The lease's current state
 * @param completing - Whether this is a terminal heartbeat
 * @returns The target WorkerLeaseStatus
 */
function computeTargetStatus(
  currentStatus: WorkerLeaseStatus,
  completing: boolean,
): WorkerLeaseStatus {
  if (completing) {
    return WorkerLeaseStatus.COMPLETING;
  }

  switch (currentStatus) {
    case WorkerLeaseStatus.STARTING:
      return WorkerLeaseStatus.RUNNING;
    case WorkerLeaseStatus.RUNNING:
      return WorkerLeaseStatus.HEARTBEATING;
    case WorkerLeaseStatus.HEARTBEATING:
      return WorkerLeaseStatus.HEARTBEATING;
    default:
      // Should not reach here — HEARTBEAT_RECEIVABLE_STATES guard prevents it
      return currentStatus;
  }
}

/**
 * Build the domain state machine context for the given heartbeat transition.
 *
 * Maps each (from, to) pair to the guard flags expected by the
 * worker lease state machine.
 *
 * @param currentStatus - The lease's current state
 * @param targetStatus - The proposed target state
 * @returns The WorkerLeaseTransitionContext for the state machine validation
 */
function buildTransitionContext(
  currentStatus: WorkerLeaseStatus,
  targetStatus: WorkerLeaseStatus,
): WorkerLeaseTransitionContext {
  if (targetStatus === WorkerLeaseStatus.COMPLETING) {
    return { completionSignalReceived: true };
  }

  if (currentStatus === WorkerLeaseStatus.STARTING && targetStatus === WorkerLeaseStatus.RUNNING) {
    return { firstHeartbeatReceived: true };
  }

  // RUNNING → HEARTBEATING or HEARTBEATING → HEARTBEATING
  return { heartbeatReceived: true };
}

/**
 * Classify a stale lease record into a StaleLeaseInfo with a reason.
 *
 * TTL expiry takes priority when a lease is both heartbeat-stale and TTL-expired,
 * because TTL is an absolute bound that supersedes heartbeat status.
 *
 * @param record - The raw stale lease record from the repository
 * @param now - Current time for TTL comparison
 * @returns Classified stale lease info with reason
 */
function classifyStaleRecord(record: StaleLeaseRecord, now: Date): StaleLeaseInfo {
  const reason: StalenessReason =
    record.expiresAt.getTime() < now.getTime() ? "ttl_expired" : "missed_heartbeats";

  return {
    leaseId: record.leaseId,
    taskId: record.taskId,
    workerId: record.workerId,
    poolId: record.poolId,
    status: record.status,
    heartbeatAt: record.heartbeatAt,
    expiresAt: record.expiresAt,
    leasedAt: record.leasedAt,
    reason,
  };
}

/**
 * Create a heartbeat service with injected dependencies.
 *
 * @param unitOfWork - Transaction boundary for atomic heartbeat operations
 * @param eventEmitter - Publishes domain events after transaction commit
 * @param clock - Time source for staleness computation (injectable for testing)
 */
export function createHeartbeatService(
  unitOfWork: HeartbeatUnitOfWork,
  eventEmitter: DomainEventEmitter,
  clock: () => Date = () => new Date(),
): HeartbeatService {
  return {
    receiveHeartbeat(params: ReceiveHeartbeatParams): ReceiveHeartbeatResult {
      const { leaseId, completing = false, workerMetadata, actor } = params;

      const transactionResult = unitOfWork.runInTransaction((repos) => {
        // Step 1: Fetch the lease
        const lease = repos.lease.findById(leaseId);
        if (!lease) {
          throw new EntityNotFoundError("TaskLease", leaseId);
        }

        // Step 2: Verify the lease is in a heartbeat-receivable state
        if (!HEARTBEAT_RECEIVABLE_STATES.has(lease.status)) {
          throw new LeaseNotActiveError(leaseId, lease.status);
        }

        // Step 3: Determine the target state
        const targetStatus = computeTargetStatus(lease.status, completing);

        // Step 4: Validate via the domain state machine
        const transitionCtx = buildTransitionContext(lease.status, targetStatus);
        const validation = validateWorkerLeaseTransition(lease.status, targetStatus, transitionCtx);
        if (!validation.valid) {
          throw new InvalidTransitionError(
            "TaskLease",
            leaseId,
            lease.status,
            targetStatus,
            validation.reason,
          );
        }

        // Step 5: Update heartbeat timestamp and status atomically
        const now = clock();
        const updatedLease = repos.lease.updateHeartbeat(leaseId, lease.status, targetStatus, now);

        // Step 6: Record audit event
        const auditEvent = repos.auditEvent.create({
          entityType: "task-lease",
          entityId: leaseId,
          eventType: completing ? "lease.completing" : "lease.heartbeat",
          actorType: actor.type,
          actorId: actor.id,
          oldState: JSON.stringify({
            status: lease.status,
            heartbeatAt: lease.heartbeatAt?.toISOString() ?? null,
          }),
          newState: JSON.stringify({
            status: updatedLease.status,
            heartbeatAt: updatedLease.heartbeatAt?.toISOString() ?? null,
          }),
          metadata: workerMetadata ? JSON.stringify(workerMetadata) : null,
        });

        return {
          lease: updatedLease,
          previousStatus: lease.status,
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
        fromStatus: transactionResult.previousStatus,
        toStatus: transactionResult.lease.status,
      });

      return {
        lease: transactionResult.lease,
        previousStatus: transactionResult.previousStatus,
        auditEvent: transactionResult.auditEvent,
      };
    },

    detectStaleLeases(policy: StalenessPolicy): DetectStaleLeasesResult {
      const now = clock();

      // Compute heartbeat deadline: leases with effective heartbeat before this are stale.
      // staleness = interval × missed_threshold + grace_period
      const stalenessWindowMs =
        (policy.heartbeatIntervalSeconds * policy.missedHeartbeatThreshold +
          policy.gracePeriodSeconds) *
        1000;
      const heartbeatDeadline = new Date(now.getTime() - stalenessWindowMs);

      // TTL deadline is simply "now" — any lease past its expires_at is TTL-expired
      const ttlDeadline = now;

      const staleRecords = unitOfWork.runInTransaction((repos) => {
        return repos.lease.findStaleLeases(heartbeatDeadline, ttlDeadline);
      });

      const staleLeases = staleRecords.map((record) => classifyStaleRecord(record, now));

      return { staleLeases };
    },
  };
}
