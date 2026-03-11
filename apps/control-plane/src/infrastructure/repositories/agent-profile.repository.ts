/**
 * Agent profile repository — data access for the agent_profile table.
 *
 * Provides typed CRUD operations and query methods for AI agent profiles
 * attached to worker pools. Profiles reference prompt templates and
 * policy sets governing agent behavior.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 AgentProfile
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { agentProfiles } from "../database/schema.js";

/** An agent profile row as read from the database. */
export type AgentProfile = InferSelectModel<typeof agentProfiles>;

/** Data required to insert a new agent profile row. */
export type NewAgentProfile = InferInsertModel<typeof agentProfiles>;

/**
 * Create an agent profile repository bound to the given Drizzle database
 * instance.
 */
export function createAgentProfileRepository(db: BetterSQLite3Database) {
  return {
    /** Find an agent profile by its primary key. */
    findById(agentProfileId: string): AgentProfile | undefined {
      return db
        .select()
        .from(agentProfiles)
        .where(eq(agentProfiles.agentProfileId, agentProfileId))
        .get();
    },

    /** Return all agent profiles, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): AgentProfile[] {
      let query = db.select().from(agentProfiles).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find all agent profiles belonging to a given worker pool. */
    findByPoolId(poolId: string): AgentProfile[] {
      return db.select().from(agentProfiles).where(eq(agentProfiles.poolId, poolId)).all();
    },

    /** Insert a new agent profile row. Returns the inserted row. */
    create(data: NewAgentProfile): AgentProfile {
      return db.insert(agentProfiles).values(data).returning().get();
    },

    /** Update an agent profile by primary key. Returns the updated row or undefined. */
    update(
      agentProfileId: string,
      data: Partial<Omit<NewAgentProfile, "agentProfileId">>,
    ): AgentProfile | undefined {
      return db
        .update(agentProfiles)
        .set(data)
        .where(eq(agentProfiles.agentProfileId, agentProfileId))
        .returning()
        .get();
    },

    /** Delete an agent profile by primary key. Returns true if deleted. */
    delete(agentProfileId: string): boolean {
      const result = db
        .delete(agentProfiles)
        .where(eq(agentProfiles.agentProfileId, agentProfileId))
        .returning()
        .get();
      return result !== undefined;
    },
  };
}
