/**
 * Tests for the merge queue controller.
 *
 * Verifies HTTP-layer behavior by mocking the {@link MergeQueueService}.
 * Each test validates a single aspect: successful paginated responses,
 * delegation with filters, and empty result handling.
 *
 * @module @factory/control-plane
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MergeQueueController } from "./merge-queue.controller.js";
import type { MergeQueueService } from "./merge-queue.service.js";
import type { MergeQueueFilterQueryDto } from "./dtos/merge-queue-filter-query.dto.js";

/** Factory for a fake paginated merge queue response with sensible defaults. */
function fakePaginatedResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: [],
    meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    ...overrides,
  };
}

/** Factory for a fake merge queue item with task data. */
function fakeMergeQueueItem(overrides: Record<string, unknown> = {}) {
  return {
    mergeQueueItemId: "mqi-1",
    taskId: "task-1",
    repositoryId: "repo-1",
    status: "ENQUEUED",
    position: 1,
    approvedCommitSha: null,
    enqueuedAt: new Date("2025-01-01T00:00:00Z"),
    startedAt: null,
    completedAt: null,
    taskTitle: "Test Task",
    taskStatus: "MERGE_QUEUED",
    ...overrides,
  };
}

describe("MergeQueueController", () => {
  let controller: MergeQueueController;
  let service: {
    findAll: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      findAll: vi.fn(),
    };

    controller = new MergeQueueController(service as unknown as MergeQueueService);
  });

  /**
   * Validates that findAll delegates to the service with correct
   * pagination and filter parameters and returns the paginated response.
   */
  it("should return paginated merge queue items", () => {
    const items = [
      fakeMergeQueueItem({ position: 1 }),
      fakeMergeQueueItem({
        mergeQueueItemId: "mqi-2",
        taskId: "task-2",
        position: 2,
        status: "MERGING",
        taskTitle: "Second Task",
      }),
    ];
    const response = fakePaginatedResponse({
      data: items,
      meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });
    service.findAll.mockReturnValue(response);

    const query: MergeQueueFilterQueryDto = {
      page: 1,
      limit: 20,
    };
    const result = controller.findAll(query);

    expect(service.findAll).toHaveBeenCalledWith(1, 20, {
      status: undefined,
      repositoryId: undefined,
    });
    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(2);
  });

  /**
   * Validates that status filter is correctly forwarded to the service.
   */
  it("should forward status filter to service", () => {
    service.findAll.mockReturnValue(fakePaginatedResponse());

    const query: MergeQueueFilterQueryDto = {
      page: 1,
      limit: 20,
      status: "ENQUEUED",
    };
    controller.findAll(query);

    expect(service.findAll).toHaveBeenCalledWith(1, 20, {
      status: "ENQUEUED",
      repositoryId: undefined,
    });
  });

  /**
   * Validates that repositoryId filter is correctly forwarded to the service.
   */
  it("should forward repositoryId filter to service", () => {
    service.findAll.mockReturnValue(fakePaginatedResponse());

    const query: MergeQueueFilterQueryDto = {
      page: 1,
      limit: 20,
      repositoryId: "repo-1",
    };
    controller.findAll(query);

    expect(service.findAll).toHaveBeenCalledWith(1, 20, {
      status: undefined,
      repositoryId: "repo-1",
    });
  });

  /**
   * Validates that an empty result set returns zero items with
   * correct pagination metadata.
   */
  it("should return empty result when no items match", () => {
    service.findAll.mockReturnValue(fakePaginatedResponse());

    const query: MergeQueueFilterQueryDto = {
      page: 1,
      limit: 20,
    };
    const result = controller.findAll(query);

    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
    expect(result.meta.totalPages).toBe(0);
  });
});
