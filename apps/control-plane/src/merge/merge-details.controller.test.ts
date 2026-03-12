/**
 * Tests for the merge details controller.
 *
 * Verifies HTTP-layer behavior by mocking the {@link MergeDetailsService}.
 * Each test validates a single aspect: successful responses, delegation
 * to the service, and NotFoundException for missing entities.
 *
 * @module @factory/control-plane
 */
import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MergeDetailsController } from "./merge-details.controller.js";
import type { MergeDetailsService } from "./merge-details.service.js";

/** Factory for a fake merge detail response with sensible defaults. */
function fakeMergeDetail(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "task-1",
    mergeQueueItem: null,
    validationRuns: [],
    ...overrides,
  };
}

describe("MergeDetailsController", () => {
  let controller: MergeDetailsController;
  let service: {
    getMergeDetails: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      getMergeDetails: vi.fn(),
    };

    controller = new MergeDetailsController(service as unknown as MergeDetailsService);
  });

  /**
   * Validates that getMergeDetails delegates to the service and returns
   * merge queue item and validation runs when the task exists.
   */
  it("should return merge details for an existing task", () => {
    const details = fakeMergeDetail({
      mergeQueueItem: {
        mergeQueueItemId: "mqi-1",
        taskId: "task-1",
        position: 1,
        status: "queued",
      },
      validationRuns: [
        {
          validationRunId: "vr-1",
          taskId: "task-1",
          runScope: "pre_merge",
          status: "passed",
        },
      ],
    });
    service.getMergeDetails.mockReturnValue(details);

    const result = controller.getMergeDetails("task-1");

    expect(service.getMergeDetails).toHaveBeenCalledWith("task-1");
    expect(result).toEqual(details);
  });

  /**
   * Validates that getMergeDetails returns null mergeQueueItem when
   * the task has not been queued for merge.
   */
  it("should return null mergeQueueItem for task not queued for merge", () => {
    const details = fakeMergeDetail();
    service.getMergeDetails.mockReturnValue(details);

    const result = controller.getMergeDetails("task-1");

    expect(result.mergeQueueItem).toBeNull();
    expect(result.validationRuns).toEqual([]);
  });

  /**
   * Validates that getMergeDetails throws NotFoundException when the
   * task does not exist. The global exception filter maps this to 404.
   */
  it("should throw NotFoundException when task not found", () => {
    service.getMergeDetails.mockReturnValue(undefined);

    expect(() => controller.getMergeDetails("missing")).toThrow(NotFoundException);
  });
});
