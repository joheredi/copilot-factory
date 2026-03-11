/**
 * Workflow template repository — data access for the workflow_template table.
 *
 * Provides typed CRUD operations and query methods for reusable orchestration
 * policy templates. Workflow templates define task selection, review routing,
 * merge strategy, and policy references used by projects.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 WorkflowTemplate
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { workflowTemplates } from "../database/schema.js";

/** A workflow template row as read from the database. */
export type WorkflowTemplate = InferSelectModel<typeof workflowTemplates>;

/** Data required to insert a new workflow template row. */
export type NewWorkflowTemplate = InferInsertModel<typeof workflowTemplates>;

/**
 * Create a workflow template repository bound to the given Drizzle database
 * instance. Pass `conn.db` for standalone reads or the `db` argument inside
 * `conn.writeTransaction(db => ...)` for transactional writes.
 */
export function createWorkflowTemplateRepository(db: BetterSQLite3Database) {
  return {
    /**
     * Find a workflow template by its primary key.
     * @returns The template row, or `undefined` if not found.
     */
    findById(workflowTemplateId: string): WorkflowTemplate | undefined {
      return db
        .select()
        .from(workflowTemplates)
        .where(eq(workflowTemplates.workflowTemplateId, workflowTemplateId))
        .get();
    },

    /**
     * Return all workflow templates, optionally with limit/offset pagination.
     */
    findAll(opts?: { limit?: number; offset?: number }): WorkflowTemplate[] {
      let query = db.select().from(workflowTemplates).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /**
     * Find a workflow template by its unique name.
     * @returns The template row, or `undefined` if not found.
     */
    findByName(name: string): WorkflowTemplate | undefined {
      return db.select().from(workflowTemplates).where(eq(workflowTemplates.name, name)).get();
    },

    /**
     * Insert a new workflow template row.
     * @returns The inserted row with server-generated defaults applied.
     */
    create(data: NewWorkflowTemplate): WorkflowTemplate {
      return db.insert(workflowTemplates).values(data).returning().get();
    },

    /**
     * Update an existing workflow template by primary key.
     * @returns The updated row, or `undefined` if the row was not found.
     */
    update(
      workflowTemplateId: string,
      data: Partial<Omit<NewWorkflowTemplate, "workflowTemplateId">>,
    ): WorkflowTemplate | undefined {
      return db
        .update(workflowTemplates)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(workflowTemplates.workflowTemplateId, workflowTemplateId))
        .returning()
        .get();
    },

    /**
     * Delete a workflow template by primary key.
     * @returns `true` if a row was deleted, `false` if not found.
     */
    delete(workflowTemplateId: string): boolean {
      const result = db
        .delete(workflowTemplates)
        .where(eq(workflowTemplates.workflowTemplateId, workflowTemplateId))
        .returning()
        .get();
      return result !== undefined;
    },
  };
}
