/**
 * Task lease repository — data access for the task_lease table.
 *
 * Provides typed CRUD operations and query methods for task leases that
 * track worker-to-task assignments. Supports querying active (non-terminal)
 * leases per task and per worker.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 TaskLease
 */

import { eq, and, notInArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { taskLeases } from "../database/schema.js";

/** A task lease row as read from the database. */
export type TaskLease = InferSelectModel<typeof taskLeases>;

/** Data required to insert a new task lease row. */
export type NewTaskLease = InferInsertModel<typeof taskLeases>;

/** Terminal lease statuses — leases in these states are no longer active. */
const TERMINAL_LEASE_STATUSES = ["COMPLETED", "TIMED_OUT", "CRASHED", "RECLAIMED"] as const;

/**
 * Create a task lease repository bound to the given Drizzle database instance.
 */
export function createTaskLeaseRepository(db: BetterSQLite3Database) {
  return {
    /** Find a task lease by its primary key. */
    findById(leaseId: string): TaskLease | undefined {
      return db.select().from(taskLeases).where(eq(taskLeases.leaseId, leaseId)).get();
    },

    /** Return all task leases, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): TaskLease[] {
      let query = db.select().from(taskLeases).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find all leases for a given task (active and historical). */
    findByTaskId(taskId: string): TaskLease[] {
      return db.select().from(taskLeases).where(eq(taskLeases.taskId, taskId)).all();
    },

    /** Find all leases held by a given worker. */
    findByWorkerId(workerId: string): TaskLease[] {
      return db.select().from(taskLeases).where(eq(taskLeases.workerId, workerId)).all();
    },

    /** Find all leases with a given status. */
    findByStatus(status: string): TaskLease[] {
      return db.select().from(taskLeases).where(eq(taskLeases.status, status)).all();
    },

    /**
     * Find the active (non-terminal) lease for a given task, if any.
     * At most one active lease may exist per task (enforced at the app layer).
     */
    findActiveByTaskId(taskId: string): TaskLease | undefined {
      return db
        .select()
        .from(taskLeases)
        .where(
          and(
            eq(taskLeases.taskId, taskId),
            notInArray(taskLeases.status, [...TERMINAL_LEASE_STATUSES]),
          ),
        )
        .get();
    },

    /** Insert a new task lease row. Returns the inserted row with defaults. */
    create(data: NewTaskLease): TaskLease {
      return db.insert(taskLeases).values(data).returning().get();
    },

    /** Update a task lease by primary key. Returns the updated row or undefined. */
    update(leaseId: string, data: Partial<Omit<NewTaskLease, "leaseId">>): TaskLease | undefined {
      return db
        .update(taskLeases)
        .set(data)
        .where(eq(taskLeases.leaseId, leaseId))
        .returning()
        .get();
    },

    /** Delete a task lease by primary key. Returns true if deleted. */
    delete(leaseId: string): boolean {
      const result = db.delete(taskLeases).where(eq(taskLeases.leaseId, leaseId)).returning().get();
      return result !== undefined;
    },
  };
}
