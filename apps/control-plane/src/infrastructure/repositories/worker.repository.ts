/**
 * Worker repository — data access for the worker table.
 *
 * Provides typed CRUD operations and query methods for individual worker
 * instances that belong to pools. Workers track operational status, host
 * info, heartbeat timing, and current task assignment.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Worker
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { workers } from "../database/schema.js";

/** A worker row as read from the database. */
export type Worker = InferSelectModel<typeof workers>;

/** Data required to insert a new worker row. */
export type NewWorker = InferInsertModel<typeof workers>;

/**
 * Create a worker repository bound to the given Drizzle database instance.
 */
export function createWorkerRepository(db: BetterSQLite3Database) {
  return {
    /** Find a worker by its primary key. */
    findById(workerId: string): Worker | undefined {
      return db.select().from(workers).where(eq(workers.workerId, workerId)).get();
    },

    /** Return all workers, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): Worker[] {
      let query = db.select().from(workers).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find all workers belonging to a given pool. */
    findByPoolId(poolId: string): Worker[] {
      return db.select().from(workers).where(eq(workers.poolId, poolId)).all();
    },

    /** Find all workers with a given operational status. */
    findByStatus(status: string): Worker[] {
      return db.select().from(workers).where(eq(workers.status, status)).all();
    },

    /** Find the worker currently assigned to a given task, if any. */
    findByCurrentTaskId(currentTaskId: string): Worker | undefined {
      return db.select().from(workers).where(eq(workers.currentTaskId, currentTaskId)).get();
    },

    /** Insert a new worker row. Returns the inserted row. */
    create(data: NewWorker): Worker {
      return db.insert(workers).values(data).returning().get();
    },

    /** Update a worker by primary key. Returns the updated row or undefined. */
    update(workerId: string, data: Partial<Omit<NewWorker, "workerId">>): Worker | undefined {
      return db.update(workers).set(data).where(eq(workers.workerId, workerId)).returning().get();
    },

    /** Delete a worker by primary key. Returns true if deleted. */
    delete(workerId: string): boolean {
      const result = db.delete(workers).where(eq(workers.workerId, workerId)).returning().get();
      return result !== undefined;
    },
  };
}
