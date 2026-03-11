/**
 * Graceful completion port interfaces.
 *
 * These interfaces define the minimal data-access contract that the
 * graceful completion service requires for accepting worker results.
 * They are intentionally narrow — each port exposes only the operations
 * needed for result acceptance with grace period logic.
 *
 * The graceful completion protocol handles two scenarios:
 *
 * 1. **Normal completion**: The worker sent a terminal heartbeat (completing: true),
 *    the lease transitioned to COMPLETING, and the result arrives within the
 *    extended expiry window.
 *
 * 2. **Late completion (race condition)**: The staleness detector marked the lease
 *    TIMED_OUT before the terminal heartbeat arrived, but the result arrives
 *    within `grace_period_seconds` of the original expiry. The result is accepted
 *    to avoid losing valid work due to timing races.
 *
 * @see docs/prd/002-data-model.md §2.8 — Graceful Completion
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8 — Lease and Heartbeat Policy
 * @module @factory/application/ports/graceful-completion.ports
 */

import type { WorkerLeaseStatus } from "@factory/domain";
import type { AuditEventRepositoryPort } from "./repository.ports.js";

// ---------------------------------------------------------------------------
// Entity shapes — the minimal fields the graceful completion service reads
// ---------------------------------------------------------------------------

/**
 * Lease record required for result acceptance validation.
 *
 * Includes the fields needed to verify the worker identity, check the
 * grace period window, and determine whether the result can be accepted.
 */
export interface CompletionLease {
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
 * Port for lease data access within graceful completion operations.
 *
 * Provides read-only access to the lease for result acceptance validation.
 * The graceful completion service does not modify the lease status — it only
 * determines whether a result can be accepted and records the decision via
 * an audit event. Downstream processing (T046) handles the actual result
 * packet ingestion and any subsequent state changes.
 */
export interface CompletionLeaseRepositoryPort {
  /**
   * Find a lease by ID for result acceptance validation.
   *
   * Returns the lease record if it exists, or undefined if not found.
   * The caller must check the lease status and grace period before accepting.
   */
  findById(leaseId: string): CompletionLease | undefined;
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Collection of repository ports available inside a graceful completion transaction.
 */
export interface CompletionTransactionRepositories {
  readonly lease: CompletionLeaseRepositoryPort;
  readonly auditEvent: AuditEventRepositoryPort;
}

/**
 * Defines the contract for running graceful completion operations inside a
 * database transaction.
 *
 * Implementations must:
 * - Begin a write transaction before invoking `fn` (e.g., `BEGIN IMMEDIATE`)
 * - Commit on success, rollback on exception
 * - Provide transaction-scoped repository instances
 * - Guarantee atomicity of all reads and writes within `fn`
 */
export interface CompletionUnitOfWork {
  runInTransaction<T>(fn: (repos: CompletionTransactionRepositories) => T): T;
}
