/**
 * Repository port adapters for the transition service.
 *
 * These adapters bridge the full CRUD infrastructure repositories
 * (in `apps/control-plane/src/infrastructure/repositories/`) to the
 * narrow port interfaces required by the application-layer transition
 * service (in `packages/application/src/ports/repository.ports.ts`).
 *
 * Each adapter:
 * - Accepts a Drizzle `db` instance scoped to the current transaction
 * - Creates the full infrastructure repository internally
 * - Exposes only the methods the transition service needs
 * - Maps between the full entity shape and the minimal port shape
 *
 * For status-based entities (TaskLease, ReviewCycle, MergeQueueItem),
 * the adapter implements optimistic concurrency by checking the current
 * status before updating. This is safe within a BEGIN IMMEDIATE
 * transaction because the write lock prevents concurrent modifications.
 *
 * @see docs/prd/010-integration-contracts.md §10.3 — Transaction boundaries
 * @module
 */

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  TaskRepositoryPort,
  TaskLeaseRepositoryPort,
  ReviewCycleRepositoryPort,
  MergeQueueItemRepositoryPort,
  AuditEventRepositoryPort,
  TransitionableTask,
  TransitionableTaskLease,
  TransitionableReviewCycle,
  TransitionableMergeQueueItem,
  AuditEventRecord,
  NewAuditEvent,
} from "@factory/application";
import { VersionConflictError } from "@factory/application";
import type {
  TaskStatus,
  WorkerLeaseStatus,
  ReviewCycleStatus,
  MergeQueueItemStatus,
} from "@factory/domain";

import {
  createTaskRepository,
  VersionConflictError as InfraVersionConflictError,
} from "../repositories/task.repository.js";
import { createTaskLeaseRepository } from "../repositories/task-lease.repository.js";
import { createReviewCycleRepository } from "../repositories/review-cycle.repository.js";
import { createMergeQueueItemRepository } from "../repositories/merge-queue-item.repository.js";
import { createAuditEventRepository } from "../repositories/audit-event.repository.js";

/**
 * Create a TaskRepositoryPort adapter backed by the infrastructure task repository.
 *
 * Maps the full `Task` entity to the minimal `TransitionableTask` shape and
 * delegates `updateStatus` to the infrastructure repo's `update` method
 * with optimistic version concurrency.
 */
export function createTaskPortAdapter(db: BetterSQLite3Database): TaskRepositoryPort {
  const repo = createTaskRepository(db);
  return {
    findById(id: string): TransitionableTask | undefined {
      const task = repo.findById(id);
      if (!task) return undefined;
      return { id: task.taskId, status: task.status as TaskStatus, version: task.version };
    },

    updateStatus(id: string, expectedVersion: number, newStatus: TaskStatus): TransitionableTask {
      try {
        const updated = repo.update(id, expectedVersion, { status: newStatus });
        return {
          id: updated.taskId,
          status: updated.status as TaskStatus,
          version: updated.version,
        };
      } catch (err) {
        if (err instanceof InfraVersionConflictError) {
          throw new VersionConflictError("Task", id, expectedVersion);
        }
        throw err;
      }
    },
  };
}

/**
 * Create a TaskLeaseRepositoryPort adapter backed by the infrastructure task lease repository.
 *
 * Implements status-based optimistic concurrency: reads the current lease,
 * verifies the status matches `expectedStatus`, then updates. Within a
 * BEGIN IMMEDIATE transaction, the write lock prevents races.
 */
export function createTaskLeasePortAdapter(db: BetterSQLite3Database): TaskLeaseRepositoryPort {
  const repo = createTaskLeaseRepository(db);
  return {
    findById(id: string): TransitionableTaskLease | undefined {
      const lease = repo.findById(id);
      if (!lease) return undefined;
      return { id: lease.leaseId, status: lease.status as WorkerLeaseStatus };
    },

    updateStatus(
      id: string,
      expectedStatus: WorkerLeaseStatus,
      newStatus: WorkerLeaseStatus,
    ): TransitionableTaskLease {
      const current = repo.findById(id);
      if (!current) {
        throw new VersionConflictError("TaskLease", id, expectedStatus);
      }
      if (current.status !== expectedStatus) {
        throw new VersionConflictError("TaskLease", id, expectedStatus);
      }
      const updated = repo.update(id, { status: newStatus });
      if (!updated) {
        throw new VersionConflictError("TaskLease", id, expectedStatus);
      }
      return { id: updated.leaseId, status: updated.status as WorkerLeaseStatus };
    },
  };
}

/**
 * Create a ReviewCycleRepositoryPort adapter backed by the infrastructure review cycle repository.
 *
 * Implements status-based optimistic concurrency: reads the current cycle,
 * verifies the status matches `expectedStatus`, then updates.
 */
export function createReviewCyclePortAdapter(db: BetterSQLite3Database): ReviewCycleRepositoryPort {
  const repo = createReviewCycleRepository(db);
  return {
    findById(id: string): TransitionableReviewCycle | undefined {
      const cycle = repo.findById(id);
      if (!cycle) return undefined;
      return { id: cycle.reviewCycleId, status: cycle.status as ReviewCycleStatus };
    },

    updateStatus(
      id: string,
      expectedStatus: ReviewCycleStatus,
      newStatus: ReviewCycleStatus,
    ): TransitionableReviewCycle {
      const current = repo.findById(id);
      if (!current) {
        throw new VersionConflictError("ReviewCycle", id, expectedStatus);
      }
      if (current.status !== expectedStatus) {
        throw new VersionConflictError("ReviewCycle", id, expectedStatus);
      }
      const updated = repo.update(id, { status: newStatus });
      if (!updated) {
        throw new VersionConflictError("ReviewCycle", id, expectedStatus);
      }
      return { id: updated.reviewCycleId, status: updated.status as ReviewCycleStatus };
    },
  };
}

/**
 * Create a MergeQueueItemRepositoryPort adapter backed by the infrastructure merge queue item repository.
 *
 * Implements status-based optimistic concurrency: reads the current item,
 * verifies the status matches `expectedStatus`, then updates.
 */
export function createMergeQueueItemPortAdapter(
  db: BetterSQLite3Database,
): MergeQueueItemRepositoryPort {
  const repo = createMergeQueueItemRepository(db);
  return {
    findById(id: string): TransitionableMergeQueueItem | undefined {
      const item = repo.findById(id);
      if (!item) return undefined;
      return { id: item.mergeQueueItemId, status: item.status as MergeQueueItemStatus };
    },

    updateStatus(
      id: string,
      expectedStatus: MergeQueueItemStatus,
      newStatus: MergeQueueItemStatus,
    ): TransitionableMergeQueueItem {
      const current = repo.findById(id);
      if (!current) {
        throw new VersionConflictError("MergeQueueItem", id, expectedStatus);
      }
      if (current.status !== expectedStatus) {
        throw new VersionConflictError("MergeQueueItem", id, expectedStatus);
      }
      const updated = repo.update(id, { status: newStatus });
      if (!updated) {
        throw new VersionConflictError("MergeQueueItem", id, expectedStatus);
      }
      return { id: updated.mergeQueueItemId, status: updated.status as MergeQueueItemStatus };
    },
  };
}

/**
 * Create an AuditEventRepositoryPort adapter backed by the infrastructure audit event repository.
 *
 * Maps between the application-layer `NewAuditEvent` shape and the
 * infrastructure `NewAuditEvent` shape (field name differences for metadata).
 */
export function createAuditEventPortAdapter(db: BetterSQLite3Database): AuditEventRepositoryPort {
  const repo = createAuditEventRepository(db);
  return {
    create(event: NewAuditEvent): AuditEventRecord {
      const row = repo.create({
        auditEventId: crypto.randomUUID(),
        entityType: event.entityType,
        entityId: event.entityId,
        eventType: event.eventType,
        actorType: event.actorType,
        actorId: event.actorId,
        oldState: event.oldState,
        newState: event.newState,
        // The schema uses mode: "json" so Drizzle expects a parsed value.
        // The port passes metadata as a JSON string, so parse it for storage.
        metadataJson: event.metadata != null ? (JSON.parse(event.metadata) as unknown) : null,
      });
      return {
        id: row.auditEventId,
        entityType: row.entityType,
        entityId: row.entityId,
        eventType: row.eventType,
        actorType: row.actorType,
        actorId: row.actorId,
        oldState: row.oldState,
        newState: row.newState,
        metadata: row.metadataJson != null ? JSON.stringify(row.metadataJson) : null,
        createdAt:
          row.createdAt instanceof Date ? row.createdAt : new Date(Number(row.createdAt) * 1000),
      };
    },
  };
}
