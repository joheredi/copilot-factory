/**
 * Worker pool repository — data access for the worker_pool table.
 *
 * Provides typed CRUD operations and query methods for worker pools that
 * define shared configuration for concurrency, timeouts, capabilities,
 * and repo scope rules.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 WorkerPool
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { workerPools } from "../database/schema.js";

/** A worker pool row as read from the database. */
export type WorkerPool = InferSelectModel<typeof workerPools>;

/** Data required to insert a new worker pool row. */
export type NewWorkerPool = InferInsertModel<typeof workerPools>;

/**
 * Create a worker pool repository bound to the given Drizzle database instance.
 */
export function createWorkerPoolRepository(db: BetterSQLite3Database) {
  return {
    /** Find a worker pool by its primary key. */
    findById(workerPoolId: string): WorkerPool | undefined {
      return db.select().from(workerPools).where(eq(workerPools.workerPoolId, workerPoolId)).get();
    },

    /** Return all worker pools, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): WorkerPool[] {
      let query = db.select().from(workerPools).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find all worker pools of a given type (e.g. "developer", "reviewer"). */
    findByPoolType(poolType: string): WorkerPool[] {
      return db.select().from(workerPools).where(eq(workerPools.poolType, poolType)).all();
    },

    /** Find all enabled worker pools (enabled = 1). */
    findEnabled(): WorkerPool[] {
      return db.select().from(workerPools).where(eq(workerPools.enabled, 1)).all();
    },

    /** Insert a new worker pool row. Returns the inserted row with defaults. */
    create(data: NewWorkerPool): WorkerPool {
      return db.insert(workerPools).values(data).returning().get();
    },

    /** Update a worker pool by primary key. Returns the updated row or undefined. */
    update(
      workerPoolId: string,
      data: Partial<Omit<NewWorkerPool, "workerPoolId">>,
    ): WorkerPool | undefined {
      return db
        .update(workerPools)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(workerPools.workerPoolId, workerPoolId))
        .returning()
        .get();
    },

    /** Delete a worker pool by primary key. Returns true if deleted. */
    delete(workerPoolId: string): boolean {
      const result = db
        .delete(workerPools)
        .where(eq(workerPools.workerPoolId, workerPoolId))
        .returning()
        .get();
      return result !== undefined;
    },
  };
}
