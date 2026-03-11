/**
 * Service layer for project CRUD operations.
 *
 * Bridges NestJS dependency injection with the functional repository
 * factories from the infrastructure layer. Reads use the shared Drizzle
 * `db` instance; writes are wrapped in `writeTransaction` for
 * BEGIN IMMEDIATE semantics.
 *
 * @module @factory/control-plane
 */
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { count } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import { projects } from "../infrastructure/database/schema.js";
import { createProjectRepository } from "../infrastructure/repositories/project.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import type { Project } from "../infrastructure/repositories/project.repository.js";
import type { CreateProjectDto } from "./dtos/create-project.dto.js";
import type { UpdateProjectDto } from "./dtos/update-project.dto.js";

/** Shape of a paginated list response. */
export interface PaginatedResponse<T> {
  /** Items for the current page. */
  data: T[];
  /** Pagination metadata. */
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Manages project lifecycle — creation, listing, retrieval, update, and
 * deletion. Each write operation generates a UUID for the new entity and
 * runs inside an IMMEDIATE transaction.
 */
@Injectable()
export class ProjectsService {
  /** @param conn Injected database connection. */
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection) {}

  /**
   * Create a new project.
   *
   * @param dto Validated creation payload.
   * @returns The newly created project row.
   * @throws ConflictException if the project name is already taken.
   */
  create(dto: CreateProjectDto): Project {
    try {
      return this.conn.writeTransaction((db) => {
        const repo = createProjectRepository(db);
        return repo.create({
          projectId: randomUUID(),
          name: dto.name,
          description: dto.description,
          owner: dto.owner,
        });
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new ConflictException(`A project with name "${dto.name}" already exists`);
      }
      throw error;
    }
  }

  /**
   * List projects with page-based pagination.
   *
   * @param page 1-based page number.
   * @param limit Items per page.
   * @returns Paginated response with project data and metadata.
   */
  findAll(page: number, limit: number): PaginatedResponse<Project> {
    const repo = createProjectRepository(this.conn.db);
    const offset = (page - 1) * limit;

    const totalResult = this.conn.db.select({ count: count() }).from(projects).get();
    const total = totalResult?.count ?? 0;

    const data = repo.findAll({ limit, offset });

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find a single project by ID.
   *
   * @param id Project UUID.
   * @returns The project or `undefined` if not found.
   */
  findById(id: string): Project | undefined {
    const repo = createProjectRepository(this.conn.db);
    return repo.findById(id);
  }

  /**
   * Update a project by ID.
   *
   * @param id Project UUID.
   * @param dto Validated update payload (partial).
   * @returns The updated project or `undefined` if not found.
   * @throws ConflictException if the new name conflicts with an existing project.
   */
  update(id: string, dto: UpdateProjectDto): Project | undefined {
    try {
      return this.conn.writeTransaction((db) => {
        const repo = createProjectRepository(db);
        return repo.update(id, dto);
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new ConflictException(`A project with name "${dto.name}" already exists`);
      }
      throw error;
    }
  }

  /**
   * Delete a project by ID.
   *
   * @param id Project UUID.
   * @returns `true` if the project was deleted, `false` if not found.
   */
  delete(id: string): boolean {
    return this.conn.writeTransaction((db) => {
      const repo = createProjectRepository(db);
      return repo.delete(id);
    });
  }
}
