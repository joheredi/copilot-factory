/**
 * Lead review decision repository — data access for the lead_review_decision
 * table.
 *
 * Provides typed CRUD operations and query methods for lead reviewer
 * consolidated decisions. Each review cycle has at most one lead review
 * decision.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 LeadReviewDecision
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { leadReviewDecisions } from "../database/schema.js";

/** A lead review decision row as read from the database. */
export type LeadReviewDecision = InferSelectModel<typeof leadReviewDecisions>;

/** Data required to insert a new lead review decision row. */
export type NewLeadReviewDecision = InferInsertModel<typeof leadReviewDecisions>;

/**
 * Create a lead review decision repository bound to the given Drizzle
 * database instance.
 */
export function createLeadReviewDecisionRepository(db: BetterSQLite3Database) {
  return {
    /** Find a lead review decision by its primary key. */
    findById(leadReviewDecisionId: string): LeadReviewDecision | undefined {
      return db
        .select()
        .from(leadReviewDecisions)
        .where(eq(leadReviewDecisions.leadReviewDecisionId, leadReviewDecisionId))
        .get();
    },

    /** Return all lead review decisions, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): LeadReviewDecision[] {
      let query = db.select().from(leadReviewDecisions).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find the lead review decision for a given review cycle, if any. */
    findByReviewCycleId(reviewCycleId: string): LeadReviewDecision | undefined {
      return db
        .select()
        .from(leadReviewDecisions)
        .where(eq(leadReviewDecisions.reviewCycleId, reviewCycleId))
        .get();
    },

    /** Find all lead review decisions for a given task. */
    findByTaskId(taskId: string): LeadReviewDecision[] {
      return db
        .select()
        .from(leadReviewDecisions)
        .where(eq(leadReviewDecisions.taskId, taskId))
        .all();
    },

    /** Insert a new lead review decision row. Returns the inserted row. */
    create(data: NewLeadReviewDecision): LeadReviewDecision {
      return db.insert(leadReviewDecisions).values(data).returning().get();
    },

    /** Update a lead review decision by primary key. Returns the updated row or undefined. */
    update(
      leadReviewDecisionId: string,
      data: Partial<Omit<NewLeadReviewDecision, "leadReviewDecisionId">>,
    ): LeadReviewDecision | undefined {
      return db
        .update(leadReviewDecisions)
        .set(data)
        .where(eq(leadReviewDecisions.leadReviewDecisionId, leadReviewDecisionId))
        .returning()
        .get();
    },

    /** Delete a lead review decision by primary key. Returns true if deleted. */
    delete(leadReviewDecisionId: string): boolean {
      const result = db
        .delete(leadReviewDecisions)
        .where(eq(leadReviewDecisions.leadReviewDecisionId, leadReviewDecisionId))
        .returning()
        .get();
      return result !== undefined;
    },
  };
}
