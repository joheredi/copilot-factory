/**
 * Git repository repository — data access for the repository table.
 *
 * Provides typed CRUD operations and query methods for git repositories
 * that belong to projects. Each repository tracks remote URL, default branch,
 * checkout strategy, and operational status.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Repository
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { repositories } from "../database/schema.js";

/** A repository row as read from the database. */
export type Repository = InferSelectModel<typeof repositories>;

/** Data required to insert a new repository row. */
export type NewRepository = InferInsertModel<typeof repositories>;

/**
 * Create a git repository repository bound to the given Drizzle database
 * instance. Pass `conn.db` for standalone reads or the `db` argument inside
 * `conn.writeTransaction(db => ...)` for transactional writes.
 */
export function createRepositoryRepository(db: BetterSQLite3Database) {
  return {
    /** Find a repository by its primary key. */
    findById(repositoryId: string): Repository | undefined {
      return db
        .select()
        .from(repositories)
        .where(eq(repositories.repositoryId, repositoryId))
        .get();
    },

    /** Return all repositories, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): Repository[] {
      let query = db.select().from(repositories).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find all repositories belonging to a given project. */
    findByProjectId(projectId: string): Repository[] {
      return db.select().from(repositories).where(eq(repositories.projectId, projectId)).all();
    },

    /** Find all repositories with a given operational status. */
    findByStatus(status: string): Repository[] {
      return db.select().from(repositories).where(eq(repositories.status, status)).all();
    },

    /** Insert a new repository row. Returns the inserted row with defaults. */
    create(data: NewRepository): Repository {
      return db.insert(repositories).values(data).returning().get();
    },

    /** Update a repository by primary key. Returns the updated row or undefined. */
    update(
      repositoryId: string,
      data: Partial<Omit<NewRepository, "repositoryId">>,
    ): Repository | undefined {
      return db
        .update(repositories)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(repositories.repositoryId, repositoryId))
        .returning()
        .get();
    },

    /** Delete a repository by primary key. Returns true if deleted. */
    delete(repositoryId: string): boolean {
      const result = db
        .delete(repositories)
        .where(eq(repositories.repositoryId, repositoryId))
        .returning()
        .get();
      return result !== undefined;
    },
  };
}
