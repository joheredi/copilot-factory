/**
 * Service layer for merge detail retrieval.
 *
 * Provides read-only access to merge queue items and their associated
 * validation runs for a given task. Assembles a unified merge detail
 * response for UI consumption.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T084-api-artifacts-reviews.md}
 */
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import { createMergeQueueItemRepository } from "../infrastructure/repositories/merge-queue-item.repository.js";
import { createValidationRunRepository } from "../infrastructure/repositories/validation-run.repository.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import type { MergeQueueItem } from "../infrastructure/repositories/merge-queue-item.repository.js";
import type { ValidationRun } from "../infrastructure/repositories/validation-run.repository.js";

/** Merge detail response combining merge queue item and validation runs. */
export interface MergeDetailResponse {
  /** The task these merge details belong to. */
  taskId: string;
  /** The merge queue item, or null if the task has not been queued for merge. */
  mergeQueueItem: MergeQueueItem | null;
  /** Validation runs associated with this task (across all scopes). */
  validationRuns: ValidationRun[];
}

/**
 * Retrieves merge queue status and validation run history for tasks.
 *
 * Combines merge queue item data with associated validation runs to
 * provide a complete picture of a task's merge lifecycle.
 */
@Injectable()
export class MergeDetailsService {
  /** @param conn Injected database connection. */
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection) {}

  /**
   * Get merge details for a task.
   *
   * Returns the merge queue item (if any) and all validation runs
   * associated with the task. This includes pre-merge, post-merge,
   * and other lifecycle validation runs.
   *
   * @param taskId Task UUID.
   * @returns Merge detail response, or `undefined` if task not found.
   */
  getMergeDetails(taskId: string): MergeDetailResponse | undefined {
    const taskRepo = createTaskRepository(this.conn.db);
    const task = taskRepo.findById(taskId);
    if (!task) {
      return undefined;
    }

    const mergeQueueRepo = createMergeQueueItemRepository(this.conn.db);
    const validationRunRepo = createValidationRunRepository(this.conn.db);

    const mergeQueueItem = mergeQueueRepo.findByTaskId(taskId) ?? null;
    const validationRuns = validationRunRepo.findByTaskId(taskId);

    return {
      taskId,
      mergeQueueItem,
      validationRuns,
    };
  }
}
