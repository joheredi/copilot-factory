/**
 * Task dependency repository — data access for the task_dependency table.
 *
 * Provides typed CRUD operations and query methods for the directed edges
 * in the task dependency graph. Supports both forward lookups ("what does
 * this task depend on?") and reverse lookups ("what tasks depend on this
 * one?").
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 TaskDependency
 */

import { eq, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { taskDependencies } from "../database/schema.js";

/** A task dependency row as read from the database. */
export type TaskDependency = InferSelectModel<typeof taskDependencies>;

/** Data required to insert a new task dependency row. */
export type NewTaskDependency = InferInsertModel<typeof taskDependencies>;

/**
 * Create a task dependency repository bound to the given Drizzle database
 * instance.
 */
export function createTaskDependencyRepository(db: BetterSQLite3Database) {
  return {
    /** Find a task dependency by its primary key. */
    findById(taskDependencyId: string): TaskDependency | undefined {
      return db
        .select()
        .from(taskDependencies)
        .where(eq(taskDependencies.taskDependencyId, taskDependencyId))
        .get();
    },

    /** Return all task dependencies, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): TaskDependency[] {
      let query = db.select().from(taskDependencies).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /**
     * Forward lookup: find all dependencies of a given task.
     * Returns edges where `taskId` is the dependent (waiting) task.
     */
    findByTaskId(taskId: string): TaskDependency[] {
      return db.select().from(taskDependencies).where(eq(taskDependencies.taskId, taskId)).all();
    },

    /**
     * Reverse lookup: find all tasks that depend on a given task.
     * Returns edges where `dependsOnTaskId` is the prerequisite task.
     */
    findByDependsOnTaskId(dependsOnTaskId: string): TaskDependency[] {
      return db
        .select()
        .from(taskDependencies)
        .where(eq(taskDependencies.dependsOnTaskId, dependsOnTaskId))
        .all();
    },

    /**
     * Find a specific dependency edge between two tasks.
     * @returns The edge, or `undefined` if no dependency exists.
     */
    findByTaskIdPair(taskId: string, dependsOnTaskId: string): TaskDependency | undefined {
      return db
        .select()
        .from(taskDependencies)
        .where(
          and(
            eq(taskDependencies.taskId, taskId),
            eq(taskDependencies.dependsOnTaskId, dependsOnTaskId),
          ),
        )
        .get();
    },

    /** Insert a new task dependency edge. Returns the inserted row. */
    create(data: NewTaskDependency): TaskDependency {
      return db.insert(taskDependencies).values(data).returning().get();
    },

    /** Delete a task dependency by primary key. Returns true if deleted. */
    delete(taskDependencyId: string): boolean {
      const result = db
        .delete(taskDependencies)
        .where(eq(taskDependencies.taskDependencyId, taskDependencyId))
        .returning()
        .get();
      return result !== undefined;
    },
  };
}
