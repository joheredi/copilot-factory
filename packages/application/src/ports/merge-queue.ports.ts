/**
 * Merge queue service port interfaces.
 *
 * These interfaces define the minimal data-access contract that the
 * merge queue service requires for enqueue, dequeue, and position
 * recalculation. They are intentionally narrow — each port exposes
 * only the operations needed for merge queue orchestration.
 *
 * The merge queue ordering contract follows §10.10 of the integration
 * contracts: priority DESC → enqueue time ASC → item ID ASC.
 *
 * @see docs/prd/010-integration-contracts.md §10.10 — Merge Queue Ordering
 * @see docs/prd/002-data-model.md §2.3 MergeQueueItem
 * @module @factory/application/ports/merge-queue.ports
 */

import type { TaskStatus, MergeQueueItemStatus, TaskPriority } from "@factory/domain";
import type { AuditEventRepositoryPort } from "./repository.ports.js";

// ---------------------------------------------------------------------------
// Entity shapes — the minimal fields the merge queue service reads/writes
// ---------------------------------------------------------------------------

/**
 * Minimal task record required for merge queue enqueue validation.
 * Must include the status (for APPROVED check), version (for optimistic
 * concurrency), and priority (for queue ordering).
 */
export interface MergeQueueTask {
  readonly id: string;
  readonly status: TaskStatus;
  readonly version: number;
  readonly priority: TaskPriority;
  readonly repositoryId: string;
}

/**
 * Merge queue item as seen by the merge queue service.
 * Includes ordering-relevant fields: priority, enqueuedAt, and the ID
 * for deterministic tie-breaking.
 */
export interface MergeQueueItemRecord {
  readonly mergeQueueItemId: string;
  readonly taskId: string;
  readonly repositoryId: string;
  readonly status: MergeQueueItemStatus;
  readonly position: number;
  readonly approvedCommitSha: string | null;
  readonly enqueuedAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
}

/**
 * Data required to insert a new merge queue item row.
 */
export interface NewMergeQueueItemData {
  readonly mergeQueueItemId: string;
  readonly taskId: string;
  readonly repositoryId: string;
  readonly status: MergeQueueItemStatus;
  readonly position: number;
  readonly approvedCommitSha: string | null;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

/**
 * Port for task data access within merge queue operations.
 *
 * `findById` retrieves the task for APPROVED state validation.
 * `updateStatus` transitions the task to QUEUED_FOR_MERGE with
 * optimistic concurrency via the version column.
 */
export interface MergeQueueTaskRepositoryPort {
  findById(id: string): MergeQueueTask | undefined;
  updateStatus(id: string, expectedVersion: number, newStatus: TaskStatus): MergeQueueTask;
}

/**
 * Port for merge queue item data access within merge queue operations.
 *
 * Provides create, query, and update operations needed by the
 * enqueue/dequeue/recalculate workflows.
 */
export interface MergeQueueItemDataPort {
  /** Create a new merge queue item. Returns the persisted record. */
  create(data: NewMergeQueueItemData): MergeQueueItemRecord;

  /** Find an existing merge queue item by task ID (to prevent duplicates). */
  findByTaskId(taskId: string): MergeQueueItemRecord | undefined;

  /**
   * Find the next ENQUEUED item for a repository, ordered by the merge
   * queue ordering contract: priority DESC → enqueue time ASC → item ID ASC.
   *
   * Only returns items with status = ENQUEUED.
   */
  findNextEnqueued(repositoryId: string): MergeQueueItemRecord | undefined;

  /**
   * Update a merge queue item's status with status-based optimistic concurrency.
   * Throws VersionConflictError if the current status does not match expectedStatus.
   */
  updateStatus(
    mergeQueueItemId: string,
    expectedStatus: MergeQueueItemStatus,
    newStatus: MergeQueueItemStatus,
    additionalFields?: { startedAt?: Date; completedAt?: Date },
  ): MergeQueueItemRecord;

  /**
   * Find all non-terminal ENQUEUED items for a repository, ordered by the
   * merge queue ordering contract. Used for position recalculation.
   */
  findEnqueuedByRepositoryId(repositoryId: string): MergeQueueItemRecord[];

  /**
   * Batch-update positions for multiple items. Each entry maps
   * mergeQueueItemId → new position value.
   */
  updatePositions(updates: ReadonlyArray<{ mergeQueueItemId: string; position: number }>): void;
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Collection of repository ports available inside a merge queue transaction.
 */
export interface MergeQueueTransactionRepositories {
  readonly task: MergeQueueTaskRepositoryPort;
  readonly mergeQueueItem: MergeQueueItemDataPort;
  readonly auditEvent: AuditEventRepositoryPort;
}

/**
 * Defines the contract for running merge queue operations inside a
 * database transaction.
 *
 * Implementations must:
 * - Begin a write transaction before invoking `fn` (e.g., `BEGIN IMMEDIATE`)
 * - Commit on success, rollback on exception
 * - Provide transaction-scoped repository instances
 * - Guarantee atomicity of all reads and writes within `fn`
 */
export interface MergeQueueUnitOfWork {
  runInTransaction<T>(fn: (repos: MergeQueueTransactionRepositories) => T): T;
}
