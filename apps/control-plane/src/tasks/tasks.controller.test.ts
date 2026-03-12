/**
 * Tests for the tasks controller.
 *
 * Verifies HTTP-layer behavior by mocking the {@link TasksService}.
 * Each test validates a single aspect of the controller: successful
 * responses, proper delegation to the service, and error handling
 * (NotFoundException for missing entities).
 *
 * @module @factory/control-plane
 */
import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TasksController } from "./tasks.controller.js";
import type { TasksService } from "./tasks.service.js";
import type { AuditService } from "../audit/audit.service.js";

/** Factory for a fake task object with sensible defaults. */
function fakeTask(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "task-1",
    repositoryId: "repo-1",
    externalRef: null,
    title: "Test Task",
    description: null,
    taskType: "feature",
    priority: "medium",
    severity: null,
    status: "BACKLOG",
    source: "manual",
    acceptanceCriteria: null,
    definitionOfDone: null,
    estimatedSize: null,
    riskLevel: null,
    requiredCapabilities: null,
    suggestedFileScope: null,
    branchName: null,
    currentLeaseId: null,
    currentReviewCycleId: null,
    mergeQueueItemId: null,
    retryCount: 0,
    reviewRoundCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    version: 1,
    ...overrides,
  };
}

/** Map a fake task to the expected response shape (taskId → id). */
function expectedTask(task: ReturnType<typeof fakeTask>) {
  const { taskId, ...rest } = task;
  return { id: taskId, ...rest };
}

/** Factory for a fake task detail response. */
function fakeTaskDetail(overrides: Record<string, unknown> = {}) {
  return {
    task: fakeTask(),
    currentLease: null,
    currentReviewCycle: null,
    dependencies: [],
    dependents: [],
    ...overrides,
  };
}

describe("TasksController", () => {
  let controller: TasksController;
  let service: {
    create: ReturnType<typeof vi.fn>;
    createBatch: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findDetailById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let auditService: {
    getEntityTimeline: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      create: vi.fn(),
      createBatch: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      findDetailById: vi.fn(),
      update: vi.fn(),
    };
    auditService = {
      getEntityTimeline: vi.fn(),
    };

    controller = new TasksController(
      service as unknown as TasksService,
      auditService as unknown as AuditService,
    );
  });

  /**
   * Validates that create delegates to the service and returns the
   * created task in BACKLOG state.
   */
  it("should create a task", () => {
    const task = fakeTask();
    service.create.mockReturnValue(task);

    const dto = {
      repositoryId: "repo-1",
      title: "Test Task",
      taskType: "feature" as const,
      priority: "medium" as const,
      source: "manual" as const,
    };

    const result = controller.create(dto);

    expect(service.create).toHaveBeenCalledWith(dto);
    expect(result).toEqual(expectedTask(task));
  });

  /**
   * Validates that batch create delegates an array of DTOs and returns
   * all created tasks.
   */
  it("should create tasks in batch", () => {
    const tasks = [fakeTask({ taskId: "task-1" }), fakeTask({ taskId: "task-2" })];
    service.createBatch.mockReturnValue(tasks);

    const dtos = [
      {
        repositoryId: "repo-1",
        title: "Task 1",
        taskType: "feature" as const,
        priority: "high" as const,
        source: "manual" as const,
      },
      {
        repositoryId: "repo-1",
        title: "Task 2",
        taskType: "bug_fix" as const,
        priority: "low" as const,
        source: "manual" as const,
      },
    ];

    const result = controller.createBatch(dtos);

    expect(service.createBatch).toHaveBeenCalledWith(dtos);
    expect(result).toHaveLength(2);
  });

  /**
   * Validates that findAll delegates pagination and filter params to the
   * service. Ensures filter fields are properly extracted from the query DTO.
   */
  it("should list tasks with pagination and filters", () => {
    const response = {
      data: [fakeTask()],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    service.findAll.mockReturnValue(response);

    const result = controller.findAll({
      page: 1,
      limit: 20,
      status: "BACKLOG",
      repositoryId: "repo-1",
      priority: undefined,
      taskType: undefined,
    });

    expect(service.findAll).toHaveBeenCalledWith(1, 20, {
      status: "BACKLOG",
      repositoryId: "repo-1",
      priority: undefined,
      taskType: undefined,
    });
    expect(result).toEqual({
      data: response.data.map(expectedTask),
      meta: response.meta,
    });
  });

  /**
   * Validates that findById returns the enriched task detail when the
   * task exists. Uses findDetailById (not findById) for the detail endpoint.
   */
  it("should return task detail by ID", () => {
    const detail = fakeTaskDetail();
    service.findDetailById.mockReturnValue(detail);

    const result = controller.findById("task-1");

    expect(service.findDetailById).toHaveBeenCalledWith("task-1");
    expect(result).toEqual({ ...detail, task: expectedTask(detail.task) });
  });

  /**
   * Validates that findById throws NotFoundException for missing tasks.
   * The global exception filter maps this to a 404 HTTP response.
   */
  it("should throw NotFoundException when task not found", () => {
    service.findDetailById.mockReturnValue(undefined);

    expect(() => controller.findById("missing")).toThrow(NotFoundException);
  });

  /**
   * Validates that update returns the updated task when it exists.
   * The version field is required for optimistic concurrency control.
   */
  it("should update a task", () => {
    const task = fakeTask({ title: "Updated", version: 2 });
    service.update.mockReturnValue(task);

    const result = controller.update("task-1", { title: "Updated", version: 1 });

    expect(service.update).toHaveBeenCalledWith("task-1", { title: "Updated", version: 1 });
    expect(result).toEqual(expectedTask(task));
  });

  /**
   * Validates that update throws NotFoundException for missing tasks.
   */
  it("should throw NotFoundException when updating non-existent task", () => {
    service.update.mockReturnValue(undefined);

    expect(() => controller.update("missing", { title: "Updated", version: 1 })).toThrow(
      NotFoundException,
    );
  });

  /**
   * Validates that getTimeline delegates to the audit service when
   * the task exists. The timeline is a specialized audit query scoped
   * to a specific task entity.
   */
  it("should return timeline for an existing task", () => {
    service.findById.mockReturnValue(fakeTask());
    const timeline = {
      data: [],
      meta: { page: 1, limit: 50, total: 0, totalPages: 0 },
    };
    auditService.getEntityTimeline.mockReturnValue(timeline);

    const result = controller.getTimeline("task-1", { page: 1, limit: 50 });

    expect(service.findById).toHaveBeenCalledWith("task-1");
    expect(auditService.getEntityTimeline).toHaveBeenCalledWith("task", "task-1", 1, 50);
    expect(result).toEqual(timeline);
  });

  /**
   * Validates that getTimeline throws NotFoundException when the task
   * does not exist. Prevents querying audit events for phantom tasks.
   */
  it("should throw NotFoundException for timeline of non-existent task", () => {
    service.findById.mockReturnValue(undefined);

    expect(() => controller.getTimeline("missing", { page: 1, limit: 50 })).toThrow(
      NotFoundException,
    );
  });
});
