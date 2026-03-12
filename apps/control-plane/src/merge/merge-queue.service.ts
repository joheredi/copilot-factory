/**
 * Service layer for merge queue listing.
 *
 * Provides paginated, filterable access to merge queue items with
 * enriched task data (title, status) for UI display. Supports
 * filtering by merge queue item status and repository ID.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T098-build-merge-queue-view.md}
 */
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import { mergeQueueItems } from "../infrastructure/database/schema.js";
import { tasks } from "../infrastructure/database/schema.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

/** Enriched merge queue item with task context for UI display. */
export interface MergeQueueItemWithTask {
  /** Merge queue item ID (PK). */
  mergeQueueItemId: string;
  /** Associated task ID. */
  taskId: string;
  /** Repository ID the item belongs to. */
  repositoryId: string;
  /** Current merge queue item status. */
  status: string;
  /** Position in the merge queue (lower = higher priority). */
  position: number;
  /** Approved commit SHA, if any. */
  approvedCommitSha: string | null;
  /** When the item was enqueued. */
  enqueuedAt: Date;
  /** When merge processing started. */
  startedAt: Date | null;
  /** When merge processing completed. */
  completedAt: Date | null;
  /** Title of the associated task. */
  taskTitle: string;
  /** Current status of the associated task. */
  taskStatus: string;
}

/** Paginated response shape for merge queue items. */
export interface PaginatedMergeQueueResponse {
  data: MergeQueueItemWithTask[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** Filters for merge queue list queries. */
export interface MergeQueueFilters {
  status?: string;
  repositoryId?: string;
}

/**
 * Retrieves paginated, filterable merge queue items enriched with task data.
 *
 * Joins merge_queue_item with task to provide task title and status
 * alongside merge queue metadata. Results are ordered by position
 * (ascending) for correct queue ordering.
 */
@Injectable()
export class MergeQueueService {
  /** @param conn Injected database connection. */
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection) {}

  /**
   * List merge queue items with pagination and optional filters.
   *
   * @param page - 1-based page number.
   * @param limit - Items per page.
   * @param filters - Optional status and repositoryId filters.
   * @returns Paginated response with enriched merge queue items.
   */
  findAll(
    page: number,
    limit: number,
    filters: MergeQueueFilters = {},
  ): PaginatedMergeQueueResponse {
    const offset = (page - 1) * limit;
    const conditions = this.buildFilterConditions(filters);

    const countQuery = conditions
      ? this.conn.db.select({ count: count() }).from(mergeQueueItems).where(conditions)
      : this.conn.db.select({ count: count() }).from(mergeQueueItems);

    const totalResult = countQuery.get();
    const total = totalResult?.count ?? 0;

    let dataQuery = conditions
      ? this.conn.db
          .select({
            mergeQueueItemId: mergeQueueItems.mergeQueueItemId,
            taskId: mergeQueueItems.taskId,
            repositoryId: mergeQueueItems.repositoryId,
            status: mergeQueueItems.status,
            position: mergeQueueItems.position,
            approvedCommitSha: mergeQueueItems.approvedCommitSha,
            enqueuedAt: mergeQueueItems.enqueuedAt,
            startedAt: mergeQueueItems.startedAt,
            completedAt: mergeQueueItems.completedAt,
            taskTitle: tasks.title,
            taskStatus: tasks.status,
          })
          .from(mergeQueueItems)
          .innerJoin(tasks, eq(mergeQueueItems.taskId, tasks.taskId))
          .where(conditions)
          .orderBy(asc(mergeQueueItems.position))
          .$dynamic()
      : this.conn.db
          .select({
            mergeQueueItemId: mergeQueueItems.mergeQueueItemId,
            taskId: mergeQueueItems.taskId,
            repositoryId: mergeQueueItems.repositoryId,
            status: mergeQueueItems.status,
            position: mergeQueueItems.position,
            approvedCommitSha: mergeQueueItems.approvedCommitSha,
            enqueuedAt: mergeQueueItems.enqueuedAt,
            startedAt: mergeQueueItems.startedAt,
            completedAt: mergeQueueItems.completedAt,
            taskTitle: tasks.title,
            taskStatus: tasks.status,
          })
          .from(mergeQueueItems)
          .innerJoin(tasks, eq(mergeQueueItems.taskId, tasks.taskId))
          .orderBy(asc(mergeQueueItems.position))
          .$dynamic();

    dataQuery = dataQuery.limit(limit).offset(offset);
    const data = dataQuery.all();

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    };
  }

  /**
   * Build Drizzle SQL filter conditions from the given filters.
   *
   * Combines active filters with AND semantics. Returns undefined
   * when no filters are active (no WHERE clause needed).
   */
  private buildFilterConditions(filters: MergeQueueFilters): SQL | undefined {
    const conditions: SQL[] = [];

    if (filters.status) {
      conditions.push(eq(mergeQueueItems.status, filters.status));
    }
    if (filters.repositoryId) {
      conditions.push(eq(mergeQueueItems.repositoryId, filters.repositoryId));
    }

    if (conditions.length === 0) return undefined;
    if (conditions.length === 1) return conditions[0];
    return and(...conditions);
  }
}
