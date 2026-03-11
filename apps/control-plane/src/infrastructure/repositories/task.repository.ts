/**
 * Task repository — data access for the task table.
 *
 * Provides typed CRUD operations with **optimistic concurrency control**
 * via the `version` column. The `update` method requires the caller to
 * supply the expected version; the update is rejected (returns `undefined`)
 * if the stored version does not match. On success the version is
 * incremented atomically. This prevents lost-update anomalies when
 * concurrent workers/services attempt to transition the same task.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.1 Task State Machine
 * @see {@link file://docs/prd/002-data-model.md} §2.4 Key Invariants
 */

import { eq, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { tasks } from "../database/schema.js";

/** A task row as read from the database. */
export type Task = InferSelectModel<typeof tasks>;

/** Data required to insert a new task row. */
export type NewTask = InferInsertModel<typeof tasks>;

/**
 * Error thrown when an optimistic concurrency version conflict is detected
 * during a task update. The caller should re-read the task and retry.
 */
export class VersionConflictError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly expectedVersion: number,
  ) {
    super(
      `Version conflict on task ${taskId}: expected version ${String(expectedVersion)} but row was already updated`,
    );
    this.name = "VersionConflictError";
  }
}

/**
 * Create a task repository bound to the given Drizzle database instance.
 * Pass `conn.db` for standalone reads or the `db` argument inside
 * `conn.writeTransaction(db => ...)` for transactional writes.
 *
 * The `update` method enforces optimistic concurrency via the task version
 * column — callers must supply the current version they read, and the update
 * is rejected if another writer incremented it in the meantime.
 */
export function createTaskRepository(db: BetterSQLite3Database) {
  return {
    /** Find a task by its primary key. */
    findById(taskId: string): Task | undefined {
      return db.select().from(tasks).where(eq(tasks.taskId, taskId)).get();
    },

    /** Return all tasks, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): Task[] {
      let query = db.select().from(tasks).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find all tasks belonging to a given repository. */
    findByRepositoryId(repositoryId: string): Task[] {
      return db.select().from(tasks).where(eq(tasks.repositoryId, repositoryId)).all();
    },

    /** Find all tasks with a given status (e.g. "READY", "IN_DEVELOPMENT"). */
    findByStatus(status: string): Task[] {
      return db.select().from(tasks).where(eq(tasks.status, status)).all();
    },

    /** Find all tasks with a given priority (e.g. "critical", "high"). */
    findByPriority(priority: string): Task[] {
      return db.select().from(tasks).where(eq(tasks.priority, priority)).all();
    },

    /** Insert a new task row. Returns the inserted row with defaults. */
    create(data: NewTask): Task {
      return db.insert(tasks).values(data).returning().get();
    },

    /**
     * Update a task with optimistic concurrency control.
     *
     * The WHERE clause includes both the task ID and the expected version.
     * If no row matches, the version was changed by another writer and the
     * update is rejected by throwing {@link VersionConflictError}.
     *
     * On success the version is incremented by 1 and `updatedAt` is set to
     * the current timestamp.
     *
     * @param taskId - Primary key of the task to update.
     * @param expectedVersion - The version the caller read; must match the DB.
     * @param data - Fields to update (excluding taskId and version).
     * @returns The updated task row with the new version.
     * @throws {VersionConflictError} If the stored version ≠ expectedVersion.
     */
    update(
      taskId: string,
      expectedVersion: number,
      data: Partial<Omit<NewTask, "taskId" | "version">>,
    ): Task {
      const result = db
        .update(tasks)
        .set({
          ...data,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.taskId, taskId), eq(tasks.version, expectedVersion)))
        .returning()
        .get();

      if (!result) {
        throw new VersionConflictError(taskId, expectedVersion);
      }
      return result;
    },

    /**
     * Delete a task by primary key. Returns true if deleted.
     * Use with caution — tasks are typically cancelled rather than deleted.
     */
    delete(taskId: string): boolean {
      const result = db.delete(tasks).where(eq(tasks.taskId, taskId)).returning().get();
      return result !== undefined;
    },
  };
}
