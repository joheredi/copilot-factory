/**
 * REST controller for task management operations.
 *
 * Exposes endpoints under the `/tasks` route prefix for creating,
 * listing (with filters), retrieving (with enriched detail), updating,
 * and batch-creating tasks. Pagination is supported on the list endpoint
 * via query parameters.
 *
 * State transitions are NOT handled here — they go through the
 * centralized Transition Service. This controller handles only CRUD
 * and queries.
 *
 * @module @factory/control-plane
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";

import { CreateTaskDto } from "./dtos/create-task.dto.js";
import { TaskFilterQueryDto } from "./dtos/task-filter-query.dto.js";
import { UpdateTaskDto } from "./dtos/update-task.dto.js";
import { TasksService } from "./tasks.service.js";
import type { PaginatedResponse, TaskDetail } from "./tasks.service.js";
import type { Task } from "../infrastructure/repositories/task.repository.js";

/**
 * Handles HTTP requests for task management.
 *
 * All write operations return the created/updated entity. Not-found
 * conditions throw {@link NotFoundException} which the global exception
 * filter maps to 404. Version conflicts on update throw ConflictException
 * (409).
 */
@ApiTags("tasks")
@Controller("tasks")
export class TasksController {
  /** @param tasksService Injected tasks service. */
  constructor(private readonly tasksService: TasksService) {}

  /**
   * Create a new task.
   *
   * The task is initialised in the BACKLOG state. The caller must provide
   * a valid `repositoryId` referencing an existing repository.
   *
   * @param dto Validated creation payload.
   * @returns The newly created task.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a task" })
  @ApiResponse({ status: 201, description: "Task created in BACKLOG state." })
  @ApiResponse({ status: 400, description: "Validation failed." })
  create(@Body() dto: CreateTaskDto): Task {
    return this.tasksService.create(dto);
  }

  /**
   * Create multiple tasks in a single batch.
   *
   * All tasks are created atomically within a single transaction. If any
   * creation fails, the entire batch is rolled back.
   *
   * @param dtos Array of validated creation payloads.
   * @returns Array of newly created tasks.
   */
  @Post("batch")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create multiple tasks in a batch" })
  @ApiResponse({ status: 201, description: "Tasks created in BACKLOG state." })
  @ApiResponse({ status: 400, description: "Validation failed." })
  createBatch(@Body() dtos: CreateTaskDto[]): Task[] {
    return this.tasksService.createBatch(dtos);
  }

  /**
   * List tasks with optional filters and pagination.
   *
   * Supports filtering by status, repositoryId, priority, and taskType.
   * Filters are combined with AND semantics.
   *
   * @param query Pagination and filter parameters.
   * @returns Paginated list of tasks.
   */
  @Get()
  @ApiOperation({ summary: "List tasks with optional filters" })
  @ApiQuery({ name: "status", required: false, description: "Filter by task status" })
  @ApiQuery({ name: "repositoryId", required: false, description: "Filter by repository ID" })
  @ApiQuery({ name: "priority", required: false, description: "Filter by priority" })
  @ApiQuery({ name: "taskType", required: false, description: "Filter by task type" })
  @ApiResponse({ status: 200, description: "Paginated task list." })
  findAll(@Query() query: TaskFilterQueryDto): PaginatedResponse<Task> {
    return this.tasksService.findAll(query.page, query.limit, {
      status: query.status,
      repositoryId: query.repositoryId,
      priority: query.priority,
      taskType: query.taskType,
    });
  }

  /**
   * Get a single task by ID with enriched detail.
   *
   * Returns the task along with its current lease, current review cycle,
   * forward dependencies, and reverse dependencies (dependents).
   *
   * @param id Task UUID.
   * @returns Enriched task detail.
   * @throws NotFoundException if the task does not exist.
   */
  @Get(":id")
  @ApiOperation({ summary: "Get task detail by ID" })
  @ApiParam({ name: "id", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Task detail with related entities." })
  @ApiResponse({ status: 404, description: "Task not found." })
  findById(@Param("id") id: string): TaskDetail {
    const detail = this.tasksService.findDetailById(id);
    if (!detail) {
      throw new NotFoundException(`Task with ID "${id}" not found`);
    }
    return detail;
  }

  /**
   * Update a task's metadata by ID.
   *
   * Requires the current `version` for optimistic concurrency control.
   * If the stored version does not match, returns 409 Conflict.
   * Status transitions are NOT allowed — use the transition API instead.
   *
   * @param id Task UUID.
   * @param dto Validated update payload with version.
   * @returns The updated task.
   * @throws NotFoundException if the task does not exist.
   */
  @Put(":id")
  @ApiOperation({ summary: "Update task metadata" })
  @ApiParam({ name: "id", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Task updated." })
  @ApiResponse({ status: 400, description: "Validation failed." })
  @ApiResponse({ status: 404, description: "Task not found." })
  @ApiResponse({ status: 409, description: "Version conflict (concurrent update)." })
  update(@Param("id") id: string, @Body() dto: UpdateTaskDto): Task {
    const task = this.tasksService.update(id, dto);
    if (!task) {
      throw new NotFoundException(`Task with ID "${id}" not found`);
    }
    return task;
  }
}
