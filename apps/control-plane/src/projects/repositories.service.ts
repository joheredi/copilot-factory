/**
 * Service layer for repository CRUD operations.
 *
 * Repositories belong to projects and represent Git repositories tracked
 * by the factory. This service uses functional repository factories from
 * the infrastructure layer, with writes wrapped in IMMEDIATE transactions.
 *
 * @module @factory/control-plane
 */
import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { count, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import { repositories } from "../infrastructure/database/schema.js";
import { createRepositoryRepository } from "../infrastructure/repositories/repository.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import type { Repository } from "../infrastructure/repositories/repository.repository.js";
import type { CreateRepositoryDto } from "./dtos/create-repository.dto.js";
import type { UpdateRepositoryDto } from "./dtos/update-repository.dto.js";
import type { PaginatedResponse } from "./projects.service.js";

/**
 * Manages repository lifecycle within projects — creation, listing,
 * retrieval, update, and deletion. Each write generates a UUID and
 * runs inside an IMMEDIATE transaction.
 */
@Injectable()
export class RepositoriesService {
  /** @param conn Injected database connection. */
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection) {}

  /**
   * Create a new repository within a project.
   *
   * @param projectId Parent project UUID.
   * @param dto Validated creation payload.
   * @returns The newly created repository row.
   * @throws ConflictException if a UNIQUE constraint is violated.
   */
  create(projectId: string, dto: CreateRepositoryDto): Repository {
    try {
      return this.conn.writeTransaction((db) => {
        const repo = createRepositoryRepository(db);
        return repo.create({
          repositoryId: randomUUID(),
          projectId,
          name: dto.name,
          remoteUrl: dto.remoteUrl,
          defaultBranch: dto.defaultBranch,
          localCheckoutStrategy: dto.localCheckoutStrategy,
          credentialProfileId: dto.credentialProfileId,
          status: dto.status,
        });
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("FOREIGN KEY constraint failed")) {
        throw new BadRequestException(`Project with ID "${projectId}" does not exist`);
      }
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new ConflictException(`A repository with conflicting unique fields already exists`);
      }
      throw error;
    }
  }

  /**
   * List repositories for a project with page-based pagination.
   *
   * Uses SQL-level LIMIT/OFFSET for efficient pagination rather than
   * fetching all rows and slicing in memory.
   *
   * @param projectId Parent project UUID.
   * @param page 1-based page number.
   * @param limit Items per page.
   * @returns Paginated response with repository data and metadata.
   */
  findByProjectId(projectId: string, page: number, limit: number): PaginatedResponse<Repository> {
    const offset = (page - 1) * limit;

    const totalResult = this.conn.db
      .select({ count: count() })
      .from(repositories)
      .where(eq(repositories.projectId, projectId))
      .get();
    const total = totalResult?.count ?? 0;

    // Use direct Drizzle query with SQL-level pagination instead of
    // fetching all rows via repository.findByProjectId() and slicing.
    const data = this.conn.db
      .select()
      .from(repositories)
      .where(eq(repositories.projectId, projectId))
      .limit(limit)
      .offset(offset)
      .all();

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
   * Find a single repository by ID.
   *
   * @param id Repository UUID.
   * @returns The repository or `undefined` if not found.
   */
  findById(id: string): Repository | undefined {
    const repo = createRepositoryRepository(this.conn.db);
    return repo.findById(id);
  }

  /**
   * Update a repository by ID.
   *
   * @param id Repository UUID.
   * @param dto Validated update payload (partial).
   * @returns The updated repository or `undefined` if not found.
   * @throws ConflictException if the update violates a UNIQUE constraint.
   */
  update(id: string, dto: UpdateRepositoryDto): Repository | undefined {
    try {
      return this.conn.writeTransaction((db) => {
        const repo = createRepositoryRepository(db);
        return repo.update(id, dto);
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new ConflictException(`A repository with conflicting unique fields already exists`);
      }
      throw error;
    }
  }

  /**
   * Delete a repository by ID.
   *
   * @param id Repository UUID.
   * @returns `true` if deleted, `false` if not found.
   */
  delete(id: string): boolean {
    return this.conn.writeTransaction((db) => {
      const repo = createRepositoryRepository(db);
      return repo.delete(id);
    });
  }
}
