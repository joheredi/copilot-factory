/**
 * Unit of Work port — defines the transaction boundary contract.
 *
 * The transition service uses this interface to execute multiple
 * repository operations atomically within a single database transaction.
 * The infrastructure layer provides the concrete implementation
 * (e.g., SQLite `BEGIN IMMEDIATE` via better-sqlite3).
 *
 * @see docs/prd/010-integration-contracts.md §10.3 — Transaction boundaries
 * @module @factory/application/ports/unit-of-work.port
 */

import type {
  TaskRepositoryPort,
  TaskLeaseRepositoryPort,
  ReviewCycleRepositoryPort,
  MergeQueueItemRepositoryPort,
  AuditEventRepositoryPort,
} from "./repository.ports.js";

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
