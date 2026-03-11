/**
 * Prompt template repository — data access for the prompt_template table.
 *
 * Provides typed CRUD operations and query methods for versioned prompt
 * templates used by AI agent profiles. Templates define input/output schemas
 * and stop conditions for each agent role.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 PromptTemplate
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { promptTemplates } from "../database/schema.js";

/** A prompt template row as read from the database. */
export type PromptTemplate = InferSelectModel<typeof promptTemplates>;

/** Data required to insert a new prompt template row. */
export type NewPromptTemplate = InferInsertModel<typeof promptTemplates>;

/**
 * Create a prompt template repository bound to the given Drizzle database
 * instance.
 */
export function createPromptTemplateRepository(db: BetterSQLite3Database) {
  return {
    /** Find a prompt template by its primary key. */
    findById(promptTemplateId: string): PromptTemplate | undefined {
      return db
        .select()
        .from(promptTemplates)
        .where(eq(promptTemplates.promptTemplateId, promptTemplateId))
        .get();
    },

    /** Return all prompt templates, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): PromptTemplate[] {
      let query = db.select().from(promptTemplates).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find all prompt templates for a given agent role. */
    findByRole(role: string): PromptTemplate[] {
      return db.select().from(promptTemplates).where(eq(promptTemplates.role, role)).all();
    },

    /** Insert a new prompt template row. Returns the inserted row with defaults. */
    create(data: NewPromptTemplate): PromptTemplate {
      return db.insert(promptTemplates).values(data).returning().get();
    },

    /** Update a prompt template by primary key. Returns the updated row or undefined. */
    update(
      promptTemplateId: string,
      data: Partial<Omit<NewPromptTemplate, "promptTemplateId">>,
    ): PromptTemplate | undefined {
      return db
        .update(promptTemplates)
        .set(data)
        .where(eq(promptTemplates.promptTemplateId, promptTemplateId))
        .returning()
        .get();
    },

    /** Delete a prompt template by primary key. Returns true if deleted. */
    delete(promptTemplateId: string): boolean {
      const result = db
        .delete(promptTemplates)
        .where(eq(promptTemplates.promptTemplateId, promptTemplateId))
        .returning()
        .get();
      return result !== undefined;
    },
  };
}
