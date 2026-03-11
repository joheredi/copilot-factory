/**
 * Lease reclaim port interfaces.
 *
 * These interfaces define the minimal data-access contract that the
 * lease reclaim service requires. They are intentionally narrow — each
 * port exposes only the operations needed for reclaim processing, not
 * the full CRUD surface of the underlying repositories.
 *
 * The reclaim flow handles stale or crashed leases: transitions the lease
 * to a terminal state (TIMED_OUT or CRASHED), evaluates retry/escalation
 * policy, and transitions the task accordingly.
 *
 * @see docs/prd/002-data-model.md §2.8 — Worker Lease Protocol (Crash Recovery)
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.6 — Retry Policy
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.7 — Escalation Policy
 * @module @factory/application/ports/lease-reclaim.ports
 */

import type { TaskStatus, WorkerLeaseStatus } from "@factory/domain";
import type { AuditEventRepositoryPort } from "./repository.ports.js";

// ---------------------------------------------------------------------------
// Entity shapes — the minimal fields the reclaim service reads/writes
// ---------------------------------------------------------------------------

/**
 * Minimal lease record required for reclaim processing.
 *
 * Includes the fields needed to validate the current lease state,
 * determine the target terminal state, and record the reclaim reason.
 */
export interface ReclaimableLease {
  readonly leaseId: string;
  readonly taskId: string;
  readonly workerId: string;
  readonly poolId: string;
  readonly status: WorkerLeaseStatus;
  readonly reclaimReason: string | null;
}

/**
 * Minimal task record required for reclaim processing.
 *
 * Includes retryCount for retry eligibility evaluation and
 * currentLeaseId for cross-referencing the active lease.
 */
export interface ReclaimableTask {
  readonly id: string;
  readonly status: TaskStatus;
  readonly version: number;
  readonly retryCount: number;
  readonly currentLeaseId: string | null;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

/**
 * Port for lease data access within reclaim operations.
 *
 * `updateStatusWithReason` performs a status-based optimistic concurrency
 * check: if the lease's current status does not match `expectedStatus`,
 * it must throw a `VersionConflictError`.
 */
export interface ReclaimLeaseRepositoryPort {
  /** Find a lease by ID for reclaim processing. */
  findById(leaseId: string): ReclaimableLease | undefined;

  /**
   * Atomically update the lease's status and set the reclaim reason.
   *
   * @param leaseId - The lease to update
   * @param expectedStatus - Optimistic concurrency guard; must match current status
   * @param newStatus - The target terminal status (TIMED_OUT or CRASHED)
   * @param reclaimReason - Human-readable reason for the reclaim
   * @throws VersionConflictError if expectedStatus does not match
   */
  updateStatusWithReason(
    leaseId: string,
    expectedStatus: WorkerLeaseStatus,
    newStatus: WorkerLeaseStatus,
    reclaimReason: string,
  ): ReclaimableLease;
}

/**
 * Port for task data access within reclaim operations.
 *
 * `updateStatusAndRetryCount` atomically updates the task's status,
 * retry count, and clears the current lease ID, using optimistic
 * concurrency via the version column.
 */
export interface ReclaimTaskRepositoryPort {
  /** Find a task by ID for reclaim processing. */
  findById(id: string): ReclaimableTask | undefined;

  /**
   * Atomically update the task's status and retry count during reclaim.
   *
   * Clears currentLeaseId since the lease is being reclaimed.
   * Increments the version for optimistic concurrency.
   *
   * @param id - The task to update
   * @param expectedVersion - Optimistic concurrency guard; must match current version
   * @param newStatus - The target status (READY, FAILED, or ESCALATED)
   * @param retryCount - The new retry count (usually current + 1 for retries)
   * @throws VersionConflictError if expectedVersion does not match
   */
  updateStatusAndRetryCount(
    id: string,
    expectedVersion: number,
    newStatus: TaskStatus,
    retryCount: number,
  ): ReclaimableTask;
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Collection of repository ports available inside a reclaim transaction.
 */
export interface ReclaimTransactionRepositories {
  readonly lease: ReclaimLeaseRepositoryPort;
  readonly task: ReclaimTaskRepositoryPort;
  readonly auditEvent: AuditEventRepositoryPort;
}

/**
 * Defines the contract for running reclaim operations inside a database transaction.
 *
 * Implementations must:
 * - Begin a write transaction before invoking `fn` (e.g., `BEGIN IMMEDIATE`)
 * - Commit on success, rollback on exception
 * - Provide transaction-scoped repository instances
 * - Guarantee atomicity of all reads and writes within `fn`
 */
export interface ReclaimUnitOfWork {
  runInTransaction<T>(fn: (repos: ReclaimTransactionRepositories) => T): T;
}
