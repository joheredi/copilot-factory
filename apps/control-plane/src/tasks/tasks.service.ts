/**
 * Service layer for task CRUD operations with filtering and detail enrichment.
 *
 * Bridges NestJS dependency injection with the functional repository
 * factories from the infrastructure layer. Reads use the shared Drizzle
 * `db` instance; writes are wrapped in `writeTransaction` for
 * BEGIN IMMEDIATE semantics.
 *
 * The detail endpoint enriches the task with related entities: current
 * lease, current review cycle, and dependency edges.
 *
 * @module @factory/control-plane
 */
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { and, count, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import { tasks } from "../infrastructure/database/schema.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { VersionConflictError } from "../infrastructure/repositories/task.repository.js";
import { createTaskDependencyRepository } from "../infrastructure/repositories/task-dependency.repository.js";
import { createTaskLeaseRepository } from "../infrastructure/repositories/task-lease.repository.js";
import { createReviewCycleRepository } from "../infrastructure/repositories/review-cycle.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import type { Task, NewTask } from "../infrastructure/repositories/task.repository.js";
import type { TaskDependency } from "../infrastructure/repositories/task-dependency.repository.js";
import type { TaskLease } from "../infrastructure/repositories/task-lease.repository.js";
import type { ReviewCycle } from "../infrastructure/repositories/review-cycle.repository.js";
import type { CreateTaskDto } from "./dtos/create-task.dto.js";
import type { UpdateTaskDto } from "./dtos/update-task.dto.js";

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

/** Enriched task detail including related entities. */
export interface TaskDetail {
  /** The task entity. */
  task: Task;
  /** The currently active lease, if any. */
  currentLease: TaskLease | null;
  /** The current review cycle, if any. */
  currentReviewCycle: ReviewCycle | null;
  /** Dependencies: tasks this task depends on. */
  dependencies: TaskDependency[];
  /** Dependents: tasks that depend on this task. */
  dependents: TaskDependency[];
}

/** Filter criteria for listing tasks. */
export interface TaskFilters {
  status?: string;
  repositoryId?: string;
  priority?: string;
  taskType?: string;
}

/**
 * Manages task lifecycle — creation, listing with filters, detail retrieval
 * with related entities, metadata update, and batch creation.
 *
 * Task status transitions are NOT handled here — they go through the
 * centralized Transition Service (T017). This service only handles
 * CRUD and queries.
 */
@Injectable()
export class TasksService {
  /** @param conn Injected database connection. */
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection) {}

  /**
   * Create a new task in BACKLOG state.
   *
   * @param dto Validated creation payload.
   * @returns The newly created task row.
   */
  create(dto: CreateTaskDto): Task {
    return this.conn.writeTransaction((db) => {
      const repo = createTaskRepository(db);
      return repo.create({
        taskId: randomUUID(),
        repositoryId: dto.repositoryId,
        title: dto.title,
        description: dto.description,
        taskType: dto.taskType,
        priority: dto.priority,
        source: dto.source,
        status: "BACKLOG",
        externalRef: dto.externalRef,
        severity: dto.severity,
        acceptanceCriteria: dto.acceptanceCriteria ?? null,
        definitionOfDone: dto.definitionOfDone ?? null,
        estimatedSize: dto.estimatedSize,
        riskLevel: dto.riskLevel,
        requiredCapabilities: dto.requiredCapabilities ?? null,
        suggestedFileScope: dto.suggestedFileScope ?? null,
      });
    });
  }

  /**
   * Create multiple tasks in a single transaction.
   *
   * All tasks start in BACKLOG state. If any creation fails, the
   * entire batch is rolled back.
   *
   * @param dtos Array of validated creation payloads.
   * @returns Array of newly created task rows.
   */
  createBatch(dtos: CreateTaskDto[]): Task[] {
    return this.conn.writeTransaction((db) => {
      const repo = createTaskRepository(db);
      return dtos.map((dto) =>
        repo.create({
          taskId: randomUUID(),
          repositoryId: dto.repositoryId,
          title: dto.title,
          description: dto.description,
          taskType: dto.taskType,
          priority: dto.priority,
          source: dto.source,
          status: "BACKLOG",
          externalRef: dto.externalRef,
          severity: dto.severity,
          acceptanceCriteria: dto.acceptanceCriteria ?? null,
          definitionOfDone: dto.definitionOfDone ?? null,
          estimatedSize: dto.estimatedSize,
          riskLevel: dto.riskLevel,
          requiredCapabilities: dto.requiredCapabilities ?? null,
          suggestedFileScope: dto.suggestedFileScope ?? null,
        }),
      );
    });
  }

  /**
   * List tasks with optional filters and page-based pagination.
   *
   * Filters are combined with AND semantics — only tasks matching all
   * provided filters are returned.
   *
   * @param page 1-based page number.
   * @param limit Items per page.
   * @param filters Optional filter criteria.
   * @returns Paginated response with task data and metadata.
   */
  findAll(page: number, limit: number, filters: TaskFilters = {}): PaginatedResponse<Task> {
    const offset = (page - 1) * limit;
    const conditions = this.buildFilterConditions(filters);

    const countQuery = conditions
      ? this.conn.db.select({ count: count() }).from(tasks).where(conditions)
      : this.conn.db.select({ count: count() }).from(tasks);

    const totalResult = countQuery.get();
    const total = totalResult?.count ?? 0;

    let dataQuery = conditions
      ? this.conn.db.select().from(tasks).where(conditions).$dynamic()
      : this.conn.db.select().from(tasks).$dynamic();

    dataQuery = dataQuery.limit(limit).offset(offset);
    const data = dataQuery.all();

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
   * Find a single task by ID.
   *
   * @param id Task UUID.
   * @returns The task or `undefined` if not found.
   */
  findById(id: string): Task | undefined {
    const repo = createTaskRepository(this.conn.db);
    return repo.findById(id);
  }

  /**
   * Get enriched task detail including related entities.
   *
   * Fetches the task along with its current lease, current review cycle,
   * forward dependencies, and reverse dependencies (dependents).
   *
   * @param id Task UUID.
   * @returns Enriched task detail or `undefined` if task not found.
   */
  findDetailById(id: string): TaskDetail | undefined {
    const taskRepo = createTaskRepository(this.conn.db);
    const task = taskRepo.findById(id);
    if (!task) {
      return undefined;
    }

    const depRepo = createTaskDependencyRepository(this.conn.db);
    const leaseRepo = createTaskLeaseRepository(this.conn.db);
    const reviewRepo = createReviewCycleRepository(this.conn.db);

    const currentLease = task.currentLeaseId
      ? (leaseRepo.findById(task.currentLeaseId) ?? null)
      : null;

    const currentReviewCycle = task.currentReviewCycleId
      ? (reviewRepo.findById(task.currentReviewCycleId) ?? null)
      : null;

    const dependencies = depRepo.findByTaskId(id);
    const dependents = depRepo.findByDependsOnTaskId(id);

    return {
      task,
      currentLease,
      currentReviewCycle,
      dependencies,
      dependents,
    };
  }

  /**
   * Update task metadata with optimistic concurrency control.
   *
   * The caller must provide the current `version` in the DTO. If the
   * stored version does not match, a ConflictException is thrown (409).
   *
   * Status transitions are NOT allowed through this method.
   *
   * @param id Task UUID.
   * @param dto Validated update payload with version.
   * @returns The updated task or `undefined` if not found.
   * @throws ConflictException if the version does not match (concurrent update).
   */
  update(id: string, dto: UpdateTaskDto): Task | undefined {
    const { version, ...updateFields } = dto;

    const data: Partial<Omit<NewTask, "taskId" | "version">> = {};
    if (updateFields.title !== undefined) data["title"] = updateFields.title;
    if (updateFields.description !== undefined) data["description"] = updateFields.description;
    if (updateFields.priority !== undefined) data["priority"] = updateFields.priority;
    if (updateFields.externalRef !== undefined) data["externalRef"] = updateFields.externalRef;
    if (updateFields.severity !== undefined) data["severity"] = updateFields.severity;
    if (updateFields.acceptanceCriteria !== undefined)
      data["acceptanceCriteria"] = updateFields.acceptanceCriteria;
    if (updateFields.definitionOfDone !== undefined)
      data["definitionOfDone"] = updateFields.definitionOfDone;
    if (updateFields.estimatedSize !== undefined)
      data["estimatedSize"] = updateFields.estimatedSize;
    if (updateFields.riskLevel !== undefined) data["riskLevel"] = updateFields.riskLevel;
    if (updateFields.requiredCapabilities !== undefined)
      data["requiredCapabilities"] = updateFields.requiredCapabilities;
    if (updateFields.suggestedFileScope !== undefined)
      data["suggestedFileScope"] = updateFields.suggestedFileScope;

    try {
      return this.conn.writeTransaction((db) => {
        const repo = createTaskRepository(db);
        // First check if the task exists at all
        const existing = repo.findById(id);
        if (!existing) {
          return undefined;
        }
        return repo.update(id, version, data);
      });
    } catch (error: unknown) {
      if (error instanceof VersionConflictError) {
        throw new ConflictException(
          `Task "${id}" was modified concurrently. Expected version ${String(version)} but the task was already updated. Re-read and retry.`,
        );
      }
      throw error;
    }
  }

  /**
   * Build Drizzle filter conditions from task filter criteria.
   *
   * Combines all provided filters with AND semantics.
   *
   * @param filters Task filter criteria.
   * @returns Combined SQL condition or undefined if no filters.
   */
  private buildFilterConditions(filters: TaskFilters) {
    const conditions = [];

    if (filters.status) {
      conditions.push(eq(tasks.status, filters.status));
    }
    if (filters.repositoryId) {
      conditions.push(eq(tasks.repositoryId, filters.repositoryId));
    }
    if (filters.priority) {
      conditions.push(eq(tasks.priority, filters.priority));
    }
    if (filters.taskType) {
      conditions.push(eq(tasks.taskType, filters.taskType));
    }

    if (conditions.length === 0) return undefined;
    if (conditions.length === 1) return conditions[0];
    return and(...conditions);
  }
}
