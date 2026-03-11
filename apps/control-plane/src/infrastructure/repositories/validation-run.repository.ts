/**
 * Validation run repository — data access for the validation_run table.
 *
 * Provides typed CRUD operations and query methods for validation executions
 * that occur at lifecycle gates (pre-dev, during-dev, pre-review, pre-merge,
 * post-merge).
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 ValidationRun
 */

import { eq, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { validationRuns } from "../database/schema.js";

/** A validation run row as read from the database. */
export type ValidationRun = InferSelectModel<typeof validationRuns>;

/** Data required to insert a new validation run row. */
export type NewValidationRun = InferInsertModel<typeof validationRuns>;

/**
 * Create a validation run repository bound to the given Drizzle database
 * instance.
 */
export function createValidationRunRepository(db: BetterSQLite3Database) {
  return {
    /** Find a validation run by its primary key. */
    findById(validationRunId: string): ValidationRun | undefined {
      return db
        .select()
        .from(validationRuns)
        .where(eq(validationRuns.validationRunId, validationRunId))
        .get();
    },

    /** Return all validation runs, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): ValidationRun[] {
      let query = db.select().from(validationRuns).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find all validation runs for a given task. */
    findByTaskId(taskId: string): ValidationRun[] {
      return db.select().from(validationRuns).where(eq(validationRuns.taskId, taskId)).all();
    },

    /** Find all validation runs for a task at a specific lifecycle scope. */
    findByTaskIdAndScope(taskId: string, runScope: string): ValidationRun[] {
      return db
        .select()
        .from(validationRuns)
        .where(and(eq(validationRuns.taskId, taskId), eq(validationRuns.runScope, runScope)))
        .all();
    },

    /** Insert a new validation run row. Returns the inserted row with defaults. */
    create(data: NewValidationRun): ValidationRun {
      return db.insert(validationRuns).values(data).returning().get();
    },

    /** Update a validation run by primary key. Returns the updated row or undefined. */
    update(
      validationRunId: string,
      data: Partial<Omit<NewValidationRun, "validationRunId">>,
    ): ValidationRun | undefined {
      return db
        .update(validationRuns)
        .set(data)
        .where(eq(validationRuns.validationRunId, validationRunId))
        .returning()
        .get();
    },

    /** Delete a validation run by primary key. Returns true if deleted. */
    delete(validationRunId: string): boolean {
      const result = db
        .delete(validationRuns)
        .where(eq(validationRuns.validationRunId, validationRunId))
        .returning()
        .get();
      return result !== undefined;
    },
  };
}
