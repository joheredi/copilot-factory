/**
 * Review packet repository — data access for the review_packet table.
 *
 * Provides typed CRUD operations and query methods for specialist reviewer
 * assessment packets produced within review cycles.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 ReviewPacket
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { reviewPackets } from "../database/schema.js";

/** A review packet row as read from the database. */
export type ReviewPacket = InferSelectModel<typeof reviewPackets>;

/** Data required to insert a new review packet row. */
export type NewReviewPacket = InferInsertModel<typeof reviewPackets>;

/**
 * Create a review packet repository bound to the given Drizzle database instance.
 */
export function createReviewPacketRepository(db: BetterSQLite3Database) {
  return {
    /** Find a review packet by its primary key. */
    findById(reviewPacketId: string): ReviewPacket | undefined {
      return db
        .select()
        .from(reviewPackets)
        .where(eq(reviewPackets.reviewPacketId, reviewPacketId))
        .get();
    },

    /** Return all review packets, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): ReviewPacket[] {
      let query = db.select().from(reviewPackets).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find all review packets within a given review cycle. */
    findByReviewCycleId(reviewCycleId: string): ReviewPacket[] {
      return db
        .select()
        .from(reviewPackets)
        .where(eq(reviewPackets.reviewCycleId, reviewCycleId))
        .all();
    },

    /** Find all review packets for a given task (across all cycles). */
    findByTaskId(taskId: string): ReviewPacket[] {
      return db.select().from(reviewPackets).where(eq(reviewPackets.taskId, taskId)).all();
    },

    /** Find all review packets with a given verdict. */
    findByVerdict(verdict: string): ReviewPacket[] {
      return db.select().from(reviewPackets).where(eq(reviewPackets.verdict, verdict)).all();
    },

    /** Insert a new review packet row. Returns the inserted row with defaults. */
    create(data: NewReviewPacket): ReviewPacket {
      return db.insert(reviewPackets).values(data).returning().get();
    },

    /** Update a review packet by primary key. Returns the updated row or undefined. */
    update(
      reviewPacketId: string,
      data: Partial<Omit<NewReviewPacket, "reviewPacketId">>,
    ): ReviewPacket | undefined {
      return db
        .update(reviewPackets)
        .set(data)
        .where(eq(reviewPackets.reviewPacketId, reviewPacketId))
        .returning()
        .get();
    },

    /** Delete a review packet by primary key. Returns true if deleted. */
    delete(reviewPacketId: string): boolean {
      const result = db
        .delete(reviewPackets)
        .where(eq(reviewPackets.reviewPacketId, reviewPacketId))
        .returning()
        .get();
      return result !== undefined;
    },
  };
}
