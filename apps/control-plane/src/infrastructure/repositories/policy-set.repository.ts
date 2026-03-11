/**
 * Policy set repository — data access for the policy_set table.
 *
 * Provides typed CRUD operations and query methods for versioned policy
 * bundles that govern scheduling, review, merge, security, validation,
 * and budget behaviors.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 PolicySet
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { policySets } from "../database/schema.js";

/** A policy set row as read from the database. */
export type PolicySet = InferSelectModel<typeof policySets>;

/** Data required to insert a new policy set row. */
export type NewPolicySet = InferInsertModel<typeof policySets>;

/**
 * Create a policy set repository bound to the given Drizzle database instance.
 */
export function createPolicySetRepository(db: BetterSQLite3Database) {
  return {
    /** Find a policy set by its primary key. */
    findById(policySetId: string): PolicySet | undefined {
      return db.select().from(policySets).where(eq(policySets.policySetId, policySetId)).get();
    },

    /** Return all policy sets, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): PolicySet[] {
      let query = db.select().from(policySets).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find all policy sets with a given name (may span multiple versions). */
    findByName(name: string): PolicySet[] {
      return db.select().from(policySets).where(eq(policySets.name, name)).all();
    },

    /** Insert a new policy set row. Returns the inserted row with defaults. */
    create(data: NewPolicySet): PolicySet {
      return db.insert(policySets).values(data).returning().get();
    },

    /** Update a policy set by primary key. Returns the updated row or undefined. */
    update(
      policySetId: string,
      data: Partial<Omit<NewPolicySet, "policySetId">>,
    ): PolicySet | undefined {
      return db
        .update(policySets)
        .set(data)
        .where(eq(policySets.policySetId, policySetId))
        .returning()
        .get();
    },

    /** Delete a policy set by primary key. Returns true if deleted. */
    delete(policySetId: string): boolean {
      const result = db
        .delete(policySets)
        .where(eq(policySets.policySetId, policySetId))
        .returning()
        .get();
      return result !== undefined;
    },
  };
}
