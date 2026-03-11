/**
 * Project repository — data access for the project table.
 *
 * Provides typed CRUD operations and query methods for top-level projects
 * that group repositories. Projects reference default workflow templates
 * and policy sets inherited by child tasks.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Project
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { projects } from "../database/schema.js";

/** A project row as read from the database. */
export type Project = InferSelectModel<typeof projects>;

/** Data required to insert a new project row. */
export type NewProject = InferInsertModel<typeof projects>;

/**
 * Create a project repository bound to the given Drizzle database instance.
 * Pass `conn.db` for standalone reads or the `db` argument inside
 * `conn.writeTransaction(db => ...)` for transactional writes.
 */
export function createProjectRepository(db: BetterSQLite3Database) {
  return {
    /** Find a project by its primary key. */
    findById(projectId: string): Project | undefined {
      return db.select().from(projects).where(eq(projects.projectId, projectId)).get();
    },

    /** Return all projects, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): Project[] {
      let query = db.select().from(projects).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find all projects belonging to a specific owner. */
    findByOwner(owner: string): Project[] {
      return db.select().from(projects).where(eq(projects.owner, owner)).all();
    },

    /** Find a project by its unique name. */
    findByName(name: string): Project | undefined {
      return db.select().from(projects).where(eq(projects.name, name)).get();
    },

    /** Insert a new project row. Returns the inserted row with defaults. */
    create(data: NewProject): Project {
      return db.insert(projects).values(data).returning().get();
    },

    /** Update a project by primary key. Returns the updated row or undefined. */
    update(projectId: string, data: Partial<Omit<NewProject, "projectId">>): Project | undefined {
      return db
        .update(projects)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(projects.projectId, projectId))
        .returning()
        .get();
    },

    /** Delete a project by primary key. Returns true if deleted. */
    delete(projectId: string): boolean {
      const result = db.delete(projects).where(eq(projects.projectId, projectId)).returning().get();
      return result !== undefined;
    },
  };
}
