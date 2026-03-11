/**
 * SQLite-backed UnitOfWork implementation.
 *
 * Bridges the application-layer `UnitOfWork` port to the infrastructure-layer
 * `DatabaseConnection.writeTransaction` method. Each call to `runInTransaction`
 * creates a new set of transaction-scoped repository port adapters and executes
 * the callback within a `BEGIN IMMEDIATE` SQLite transaction.
 *
 * This ensures that all state changes and audit events within a single
 * transition are committed atomically — if any step fails, the entire
 * transaction is rolled back and no partial state is persisted.
 *
 * @see docs/prd/010-integration-contracts.md §10.3 — Transaction boundaries
 * @see docs/prd/010-integration-contracts.md §10.2.3 — Concurrency control
 * @module
 */

import type { UnitOfWork, TransactionRepositories } from "@factory/application";
import type { DatabaseConnection } from "../database/connection.js";
import {
  createTaskPortAdapter,
  createTaskLeasePortAdapter,
  createReviewCyclePortAdapter,
  createMergeQueueItemPortAdapter,
  createAuditEventPortAdapter,
} from "./repository-adapters.js";

/**
 * Create a SQLite-backed UnitOfWork that executes operations within
 * `BEGIN IMMEDIATE` transactions.
 *
 * Each call to `runInTransaction` creates fresh repository port adapters
 * scoped to the transaction's Drizzle `db` instance. All reads and writes
 * through these adapters participate in the same atomic transaction.
 *
 * @param conn - The database connection providing `writeTransaction`.
 * @returns A `UnitOfWork` implementation suitable for use with the transition service.
 *
 * @example
 * ```typescript
 * const conn = createDatabaseConnection({ filePath: './data/factory.db' });
 * const unitOfWork = createSqliteUnitOfWork(conn);
 * const transitionService = createTransitionService(unitOfWork, eventEmitter);
 * ```
 */
export function createSqliteUnitOfWork(conn: DatabaseConnection): UnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: TransactionRepositories) => T): T {
      return conn.writeTransaction((db) => {
        const repos: TransactionRepositories = {
          task: createTaskPortAdapter(db),
          taskLease: createTaskLeasePortAdapter(db),
          reviewCycle: createReviewCyclePortAdapter(db),
          mergeQueueItem: createMergeQueueItemPortAdapter(db),
          auditEvent: createAuditEventPortAdapter(db),
        };
        return fn(repos);
      });
    },
  };
}
