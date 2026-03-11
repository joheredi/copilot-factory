/**
 * Lease acquisition port interfaces.
 *
 * These interfaces define the minimal data-access contract that the
 * lease service requires for acquiring task leases. They are intentionally
 * narrow — each port exposes only the operations needed for lease
 * acquisition, not the full CRUD surface of the underlying repositories.
 *
 * @see docs/prd/002-data-model.md §2.3 TaskLease entity
 * @see docs/prd/002-data-model.md §2.8 Worker Lease Protocol
 * @module @factory/application/ports/lease.ports
 */

import type { TaskStatus, WorkerLeaseStatus } from "@factory/domain";
import type { AuditEventRepositoryPort } from "./repository.ports.js";

// ---------------------------------------------------------------------------
// Entity shapes — the minimal fields the lease service reads/writes
// ---------------------------------------------------------------------------

/**
 * Minimal task record required by the lease service.
 * Includes the fields needed to validate lease eligibility and
 * perform optimistic concurrency on the task row.
 */
export interface LeaseAcquisitionTask {
  readonly id: string;
  readonly status: TaskStatus;
  readonly version: number;
  readonly currentLeaseId: string | null;
}

/**
 * Minimal active lease record returned when checking for exclusivity.
 * Only the fields needed to identify an existing active lease.
 */
export interface ActiveLeaseInfo {
  readonly leaseId: string;
  readonly taskId: string;
  readonly status: WorkerLeaseStatus;
}

/**
 * Data required to insert a new lease row.
 */
export interface NewLeaseData {
  readonly leaseId: string;
  readonly taskId: string;
  readonly workerId: string;
  readonly poolId: string;
  readonly status: WorkerLeaseStatus;
  readonly expiresAt: Date;
}

/**
 * Lease record as returned after creation. Includes server-generated
 * fields like leasedAt.
 */
export interface CreatedLease {
  readonly leaseId: string;
  readonly taskId: string;
  readonly workerId: string;
  readonly poolId: string;
  readonly status: WorkerLeaseStatus;
  readonly leasedAt: Date;
  readonly expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

/**
 * Port for task data access within lease acquisition.
 *
 * `updateStatusAndLeaseId` atomically transitions the task state and
 * links the new lease, using optimistic concurrency via the version column.
 * If `expectedVersion` does not match, it must throw a `VersionConflictError`.
 */
export interface LeaseTaskRepositoryPort {
  findById(id: string): LeaseAcquisitionTask | undefined;
  updateStatusAndLeaseId(
    id: string,
    expectedVersion: number,
    newStatus: TaskStatus,
    leaseId: string,
  ): LeaseAcquisitionTask;
}

/**
 * Port for lease data access within lease acquisition.
 *
 * `findActiveByTaskId` checks for any non-terminal lease on the task.
 * Active lease statuses: LEASED, STARTING, RUNNING, HEARTBEATING, COMPLETING.
 *
 * `create` inserts a new lease row and returns the persisted record.
 */
export interface LeaseRepositoryPort {
  findActiveByTaskId(taskId: string): ActiveLeaseInfo | undefined;
  create(data: NewLeaseData): CreatedLease;
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Collection of repository ports available inside a lease acquisition transaction.
 */
export interface LeaseTransactionRepositories {
  readonly task: LeaseTaskRepositoryPort;
  readonly lease: LeaseRepositoryPort;
  readonly auditEvent: AuditEventRepositoryPort;
}

/**
 * Defines the contract for running lease operations inside a database transaction.
 *
 * Implementations must:
 * - Begin a write transaction before invoking `fn` (e.g., `BEGIN IMMEDIATE`)
 * - Commit on success, rollback on exception
 * - Provide transaction-scoped repository instances
 * - Guarantee atomicity of all reads and writes within `fn`
 */
export interface LeaseUnitOfWork {
  runInTransaction<T>(fn: (repos: LeaseTransactionRepositories) => T): T;
}
