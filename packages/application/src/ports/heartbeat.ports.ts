/**
 * Heartbeat reception and staleness detection port interfaces.
 *
 * These interfaces define the minimal data-access contract that the
 * heartbeat service requires. They are intentionally narrow — each port
 * exposes only the operations needed for heartbeat processing and
 * staleness detection, not the full CRUD surface of the lease table.
 *
 * @see docs/prd/002-data-model.md §2.8 — Worker Lease Protocol (Heartbeat Protocol)
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8 — Lease and Heartbeat Policy
 * @module @factory/application/ports/heartbeat.ports
 */

import type { WorkerLeaseStatus } from "@factory/domain";
import type { AuditEventRepositoryPort } from "./repository.ports.js";

// ---------------------------------------------------------------------------
// Entity shapes — the minimal fields the heartbeat service reads/writes
// ---------------------------------------------------------------------------

/**
 * Minimal lease record required for heartbeat reception.
 *
 * Includes the fields needed to validate the heartbeat, determine the
 * correct state transition, and update the heartbeat timestamp.
 */
export interface HeartbeatableLease {
  readonly leaseId: string;
  readonly taskId: string;
  readonly workerId: string;
  readonly status: WorkerLeaseStatus;
  readonly heartbeatAt: Date | null;
  readonly expiresAt: Date;
  readonly leasedAt: Date;
}

/**
 * Lease record returned by the staleness detection query.
 *
 * Includes pool ID for downstream routing (e.g., reassignment to same pool).
 */
export interface StaleLeaseRecord {
  readonly leaseId: string;
  readonly taskId: string;
  readonly workerId: string;
  readonly poolId: string;
  readonly status: WorkerLeaseStatus;
  readonly heartbeatAt: Date | null;
  readonly expiresAt: Date;
  readonly leasedAt: Date;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

/**
 * Port for lease data access within heartbeat operations.
 *
 * `updateHeartbeat` performs a status-based optimistic concurrency check:
 * if the lease's current status does not match `expectedStatus`, it must
 * throw a `VersionConflictError`.
 *
 * `findStaleLeases` queries for active leases that are stale according to
 * either the heartbeat deadline or the TTL deadline. The implementation
 * should return leases where:
 *
 * - Status is in (STARTING, RUNNING, HEARTBEATING) AND the effective last
 *   heartbeat time (heartbeat_at or leased_at if heartbeat_at is null) is
 *   before `heartbeatDeadline`.
 * - OR status is in (LEASED, STARTING, RUNNING, HEARTBEATING) AND
 *   `expires_at` is before `ttlDeadline`.
 *
 * Duplicate leases matching both conditions should be returned only once.
 */
export interface HeartbeatLeaseRepositoryPort {
  /** Find a lease by ID for heartbeat processing. */
  findById(leaseId: string): HeartbeatableLease | undefined;

  /**
   * Atomically update the lease's heartbeat timestamp and status.
   *
   * Used for both regular heartbeats (status may or may not change) and
   * terminal heartbeats (status transitions to COMPLETING).
   *
   * When `newExpiresAt` is provided, the lease's `expires_at` is also updated
   * atomically. This is used during the graceful completion protocol to extend
   * the TTL by the configured grace period, giving the worker time to deliver
   * its result packet after sending the terminal heartbeat.
   *
   * @param leaseId - The lease to update
   * @param expectedStatus - Optimistic concurrency guard; must match current status
   * @param newStatus - The target status after the heartbeat
   * @param heartbeatAt - The new heartbeat timestamp
   * @param newExpiresAt - Optional new expiry time (used for grace period extension)
   * @throws VersionConflictError if expectedStatus does not match
   *
   * @see docs/prd/002-data-model.md §2.8 — Graceful Completion
   */
  updateHeartbeat(
    leaseId: string,
    expectedStatus: WorkerLeaseStatus,
    newStatus: WorkerLeaseStatus,
    heartbeatAt: Date,
    newExpiresAt?: Date,
  ): HeartbeatableLease;

  /**
   * Find all active leases that are stale by heartbeat timeout or TTL expiry.
   *
   * @param heartbeatDeadline - Leases with effective heartbeat before this are stale
   * @param ttlDeadline - Leases with expires_at before this have exceeded TTL
   */
  findStaleLeases(heartbeatDeadline: Date, ttlDeadline: Date): readonly StaleLeaseRecord[];
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Collection of repository ports available inside a heartbeat transaction.
 */
export interface HeartbeatTransactionRepositories {
  readonly lease: HeartbeatLeaseRepositoryPort;
  readonly auditEvent: AuditEventRepositoryPort;
}

/**
 * Defines the contract for running heartbeat operations inside a database transaction.
 *
 * Implementations must:
 * - Begin a write transaction before invoking `fn` (e.g., `BEGIN IMMEDIATE`)
 * - Commit on success, rollback on exception
 * - Provide transaction-scoped repository instances
 * - Guarantee atomicity of all reads and writes within `fn`
 */
export interface HeartbeatUnitOfWork {
  runInTransaction<T>(fn: (repos: HeartbeatTransactionRepositories) => T): T;
}
