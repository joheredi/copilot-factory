/**
 * REST controller for project CRUD operations.
 *
 * Exposes endpoints under the `/projects` route prefix for creating,
 * listing, retrieving, updating, and deleting projects. Pagination is
 * supported on the list endpoint via query parameters.
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

import { CreateProjectDto } from "./dtos/create-project.dto.js";
import { PaginationQueryDto } from "./dtos/pagination-query.dto.js";
import { UpdateProjectDto } from "./dtos/update-project.dto.js";
import { ProjectsService } from "./projects.service.js";
import {
  mapProject,
  mapPaginated,
  type ProjectResponse,
  type MappedPaginatedResponse,
} from "../common/response-mappers.js";

/**
 * Handles HTTP requests for project management.
 *
 * All write operations return the created/updated entity. Delete returns
 * 204 No Content. Not-found conditions throw {@link NotFoundException}
 * which the global exception filter maps to 404.
 */
@ApiTags("projects")
@Controller("projects")
export class ProjectsController {
  /** @param projectsService Injected projects service. */
  constructor(@Inject(ProjectsService) private readonly projectsService: ProjectsService) {}

  /**
   * Create a new project.
   *
   * @param dto Validated creation payload.
   * @returns The newly created project.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a project" })
  @ApiResponse({ status: 201, description: "Project created." })
  @ApiResponse({ status: 400, description: "Validation failed." })
  @ApiResponse({ status: 409, description: "Project name already exists." })
  create(@Body() dto: CreateProjectDto): ProjectResponse {
    return mapProject(this.projectsService.create(dto));
  }

  /**
   * List all projects with pagination.
   *
   * @param query Pagination parameters (page, limit).
   * @returns Paginated list of projects.
   */
  @Get()
  @ApiOperation({ summary: "List projects" })
  @ApiResponse({ status: 200, description: "Paginated project list." })
  findAll(@Query() query: PaginationQueryDto): MappedPaginatedResponse<ProjectResponse> {
    return mapPaginated(this.projectsService.findAll(query.page, query.limit), mapProject);
  }

  /**
   * Get a single project by ID.
   *
   * @param id Project UUID.
   * @returns The project.
   * @throws NotFoundException if the project does not exist.
   */
  @Get(":id")
  @ApiOperation({ summary: "Get a project by ID" })
  @ApiParam({ name: "id", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "Project found." })
  @ApiResponse({ status: 404, description: "Project not found." })
  findById(@Param("id") id: string): ProjectResponse {
    const project = this.projectsService.findById(id);
    if (!project) {
      throw new NotFoundException(`Project with ID "${id}" not found`);
    }
    return mapProject(project);
  }

  /**
   * Update a project by ID.
   *
   * @param id Project UUID.
   * @param dto Validated update payload (partial).
   * @returns The updated project.
   * @throws NotFoundException if the project does not exist.
   */
  @Put(":id")
  @ApiOperation({ summary: "Update a project" })
  @ApiParam({ name: "id", description: "Project UUID" })
  @ApiResponse({ status: 200, description: "Project updated." })
  @ApiResponse({ status: 400, description: "Validation failed." })
  @ApiResponse({ status: 404, description: "Project not found." })
  @ApiResponse({ status: 409, description: "Project name already exists." })
  update(@Param("id") id: string, @Body() dto: UpdateProjectDto): ProjectResponse {
    const project = this.projectsService.update(id, dto);
    if (!project) {
      throw new NotFoundException(`Project with ID "${id}" not found`);
    }
    return mapProject(project);
  }

  /**
   * Delete a project by ID.
   *
   * @param id Project UUID.
   * @throws NotFoundException if the project does not exist.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a project" })
  @ApiParam({ name: "id", description: "Project UUID" })
  @ApiResponse({ status: 204, description: "Project deleted." })
  @ApiResponse({ status: 404, description: "Project not found." })
  delete(@Param("id") id: string): void {
    const deleted = this.projectsService.delete(id);
    if (!deleted) {
      throw new NotFoundException(`Project with ID "${id}" not found`);
    }
  }
}
