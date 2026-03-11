/**
 * Merge queue item repository — data access for the merge_queue_item table.
 *
 * Provides typed CRUD operations and query methods for tasks queued for merge.
 * Supports ordered retrieval by queue position for merge executor processing.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 MergeQueueItem
 */

import { eq, asc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { mergeQueueItems } from "../database/schema.js";

/** A merge queue item row as read from the database. */
export type MergeQueueItem = InferSelectModel<typeof mergeQueueItems>;

/** Data required to insert a new merge queue item row. */
export type NewMergeQueueItem = InferInsertModel<typeof mergeQueueItems>;

/**
 * Create a merge queue item repository bound to the given Drizzle database
 * instance.
 */
export function createMergeQueueItemRepository(db: BetterSQLite3Database) {
  return {
    /** Find a merge queue item by its primary key. */
    findById(mergeQueueItemId: string): MergeQueueItem | undefined {
      return db
        .select()
        .from(mergeQueueItems)
        .where(eq(mergeQueueItems.mergeQueueItemId, mergeQueueItemId))
        .get();
    },

    /** Return all merge queue items, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): MergeQueueItem[] {
      let query = db.select().from(mergeQueueItems).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find all merge queue items for a given repository, ordered by position. */
    findByRepositoryId(repositoryId: string): MergeQueueItem[] {
      return db
        .select()
        .from(mergeQueueItems)
        .where(eq(mergeQueueItems.repositoryId, repositoryId))
        .orderBy(asc(mergeQueueItems.position))
        .all();
    },

    /** Find the merge queue item for a given task, if any. */
    findByTaskId(taskId: string): MergeQueueItem | undefined {
      return db.select().from(mergeQueueItems).where(eq(mergeQueueItems.taskId, taskId)).get();
    },

    /** Find all merge queue items with a given status. */
    findByStatus(status: string): MergeQueueItem[] {
      return db.select().from(mergeQueueItems).where(eq(mergeQueueItems.status, status)).all();
    },

    /** Insert a new merge queue item row. Returns the inserted row with defaults. */
    create(data: NewMergeQueueItem): MergeQueueItem {
      return db.insert(mergeQueueItems).values(data).returning().get();
    },

    /** Update a merge queue item by primary key. Returns the updated row or undefined. */
    update(
      mergeQueueItemId: string,
      data: Partial<Omit<NewMergeQueueItem, "mergeQueueItemId">>,
    ): MergeQueueItem | undefined {
      return db
        .update(mergeQueueItems)
        .set(data)
        .where(eq(mergeQueueItems.mergeQueueItemId, mergeQueueItemId))
        .returning()
        .get();
    },

    /** Delete a merge queue item by primary key. Returns true if deleted. */
    delete(mergeQueueItemId: string): boolean {
      const result = db
        .delete(mergeQueueItems)
        .where(eq(mergeQueueItems.mergeQueueItemId, mergeQueueItemId))
        .returning()
        .get();
      return result !== undefined;
    },
  };
}
