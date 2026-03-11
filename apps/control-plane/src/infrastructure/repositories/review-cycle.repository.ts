/**
 * Review cycle repository — data access for the review_cycle table.
 *
 * Provides typed CRUD operations and query methods for review cycles
 * that track specialist + lead review for tasks. A task may have multiple
 * review cycles (one per rework round).
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 ReviewCycle
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { reviewCycles } from "../database/schema.js";

/** A review cycle row as read from the database. */
export type ReviewCycle = InferSelectModel<typeof reviewCycles>;

/** Data required to insert a new review cycle row. */
export type NewReviewCycle = InferInsertModel<typeof reviewCycles>;

/**
 * Create a review cycle repository bound to the given Drizzle database instance.
 */
export function createReviewCycleRepository(db: BetterSQLite3Database) {
  return {
    /** Find a review cycle by its primary key. */
    findById(reviewCycleId: string): ReviewCycle | undefined {
      return db
        .select()
        .from(reviewCycles)
        .where(eq(reviewCycles.reviewCycleId, reviewCycleId))
        .get();
    },

    /** Return all review cycles, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): ReviewCycle[] {
      let query = db.select().from(reviewCycles).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find all review cycles for a given task. */
    findByTaskId(taskId: string): ReviewCycle[] {
      return db.select().from(reviewCycles).where(eq(reviewCycles.taskId, taskId)).all();
    },

    /** Find all review cycles with a given status. */
    findByStatus(status: string): ReviewCycle[] {
      return db.select().from(reviewCycles).where(eq(reviewCycles.status, status)).all();
    },

    /** Insert a new review cycle row. Returns the inserted row with defaults. */
    create(data: NewReviewCycle): ReviewCycle {
      return db.insert(reviewCycles).values(data).returning().get();
    },

    /** Update a review cycle by primary key. Returns the updated row or undefined. */
    update(
      reviewCycleId: string,
      data: Partial<Omit<NewReviewCycle, "reviewCycleId">>,
    ): ReviewCycle | undefined {
      return db
        .update(reviewCycles)
        .set(data)
        .where(eq(reviewCycles.reviewCycleId, reviewCycleId))
        .returning()
        .get();
    },

    /** Delete a review cycle by primary key. Returns true if deleted. */
    delete(reviewCycleId: string): boolean {
      const result = db
        .delete(reviewCycles)
        .where(eq(reviewCycles.reviewCycleId, reviewCycleId))
        .returning()
        .get();
      return result !== undefined;
    },
  };
}
