/**
 * REST controller for repository CRUD operations.
 *
 * Provides nested routes under `/projects/:projectId/repositories` for
 * creation and listing, and top-level `/repositories/:id` routes for
 * direct access, update, and deletion.
 *
 * @module @factory/control-plane
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Inject,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";

import { CreateRepositoryDto } from "./dtos/create-repository.dto.js";
import { PaginationQueryDto } from "./dtos/pagination-query.dto.js";
import { UpdateRepositoryDto } from "./dtos/update-repository.dto.js";
import { RepositoriesService } from "./repositories.service.js";
import type { PaginatedResponse } from "./projects.service.js";
import type { Repository } from "../infrastructure/repositories/repository.repository.js";

/**
 * Handles HTTP requests for repository management.
 *
 * Repositories are created and listed within the context of a parent
 * project (nested routes). Individual repository operations (get, update,
 * delete) use a flat `/repositories/:id` prefix for convenience.
 */
@ApiTags("repositories")
@Controller()
export class RepositoriesController {
  /** @param repositoriesService Injected repositories service. */
  constructor(
    @Inject(RepositoriesService) private readonly repositoriesService: RepositoriesService,
  ) {}

  /**
   * Create a new repository within a project.
   *
   * @param projectId Parent project UUID.
   * @param dto Validated creation payload.
   * @returns The newly created repository.
   */
  @Post("projects/:projectId/repositories")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a repository in a project" })
  @ApiParam({ name: "projectId", description: "Parent project UUID" })
  @ApiResponse({ status: 201, description: "Repository created." })
  @ApiResponse({ status: 400, description: "Validation failed." })
  @ApiResponse({ status: 409, description: "Duplicate repository." })
  create(@Param("projectId") projectId: string, @Body() dto: CreateRepositoryDto): Repository {
    return this.repositoriesService.create(projectId, dto);
  }

  /**
   * List repositories for a project with pagination.
   *
   * @param projectId Parent project UUID.
   * @param query Pagination parameters (page, limit).
   * @returns Paginated list of repositories.
   */
  @Get("projects/:projectId/repositories")
  @ApiOperation({ summary: "List repositories for a project" })
  @ApiParam({ name: "projectId", description: "Parent project UUID" })
  @ApiResponse({ status: 200, description: "Paginated repository list." })
  findByProjectId(
    @Param("projectId") projectId: string,
    @Query() query: PaginationQueryDto,
  ): PaginatedResponse<Repository> {
    return this.repositoriesService.findByProjectId(projectId, query.page, query.limit);
  }

  /**
   * Get a single repository by ID.
   *
   * @param id Repository UUID.
   * @returns The repository.
   * @throws NotFoundException if the repository does not exist.
   */
  @Get("repositories/:id")
  @ApiOperation({ summary: "Get a repository by ID" })
  @ApiParam({ name: "id", description: "Repository UUID" })
  @ApiResponse({ status: 200, description: "Repository found." })
  @ApiResponse({ status: 404, description: "Repository not found." })
  findById(@Param("id") id: string): Repository {
    const repository = this.repositoriesService.findById(id);
    if (!repository) {
      throw new NotFoundException(`Repository with ID "${id}" not found`);
    }
    return repository;
  }

  /**
   * Update a repository by ID.
   *
   * @param id Repository UUID.
   * @param dto Validated update payload (partial).
   * @returns The updated repository.
   * @throws NotFoundException if the repository does not exist.
   */
  @Put("repositories/:id")
  @ApiOperation({ summary: "Update a repository" })
  @ApiParam({ name: "id", description: "Repository UUID" })
  @ApiResponse({ status: 200, description: "Repository updated." })
  @ApiResponse({ status: 400, description: "Validation failed." })
  @ApiResponse({ status: 404, description: "Repository not found." })
  update(@Param("id") id: string, @Body() dto: UpdateRepositoryDto): Repository {
    const repository = this.repositoriesService.update(id, dto);
    if (!repository) {
      throw new NotFoundException(`Repository with ID "${id}" not found`);
    }
    return repository;
  }

  /**
   * Delete a repository by ID.
   *
   * @param id Repository UUID.
   * @throws NotFoundException if the repository does not exist.
   */
  @Delete("repositories/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a repository" })
  @ApiParam({ name: "id", description: "Repository UUID" })
  @ApiResponse({ status: 204, description: "Repository deleted." })
  @ApiResponse({ status: 404, description: "Repository not found." })
  delete(@Param("id") id: string): void {
    const deleted = this.repositoriesService.delete(id);
    if (!deleted) {
      throw new NotFoundException(`Repository with ID "${id}" not found`);
    }
  }
}
