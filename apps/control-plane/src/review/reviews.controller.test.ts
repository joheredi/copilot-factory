/**
 * Tests for the reviews controller.
 *
 * Verifies HTTP-layer behavior by mocking the {@link ReviewsService}.
 * Each test validates a single aspect: successful responses, delegation
 * to the service, and NotFoundException for missing entities.
 *
 * @module @factory/control-plane
 */
import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewsController } from "./reviews.controller.js";
import type { ReviewsService } from "./reviews.service.js";

/** Factory for a fake review history response. */
function fakeReviewHistory(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "task-1",
    reviewCycles: [],
    ...overrides,
  };
}

/** Factory for a fake review cycle packets response. */
function fakeReviewCyclePackets(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "task-1",
    reviewCycleId: "cycle-1",
    specialistPackets: [],
    leadReviewDecision: null,
    ...overrides,
  };
}

describe("ReviewsController", () => {
  let controller: ReviewsController;
  let service: {
    getReviewHistory: ReturnType<typeof vi.fn>;
    getReviewCyclePackets: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      getReviewHistory: vi.fn(),
      getReviewCyclePackets: vi.fn(),
    };

    controller = new ReviewsController(service as unknown as ReviewsService);
  });

  /**
   * Validates that getReviewHistory delegates to the service and returns
   * the review cycle history when the task exists.
   */
  it("should return review history for an existing task", () => {
    const history = fakeReviewHistory({
      reviewCycles: [
        {
          reviewCycle: { reviewCycleId: "cycle-1", taskId: "task-1", status: "APPROVED" },
          leadReviewDecision: null,
          specialistPacketCount: 2,
        },
      ],
    });
    service.getReviewHistory.mockReturnValue(history);

    const result = controller.getReviewHistory("task-1");

    expect(service.getReviewHistory).toHaveBeenCalledWith("task-1");
    expect(result).toEqual(history);
  });

  /**
   * Validates that getReviewHistory throws NotFoundException when the
   * task does not exist. The global exception filter maps this to 404.
   */
  it("should throw NotFoundException when task not found for review history", () => {
    service.getReviewHistory.mockReturnValue(undefined);

    expect(() => controller.getReviewHistory("missing")).toThrow(NotFoundException);
  });

  /**
   * Validates that getReviewCyclePackets delegates both taskId and
   * cycleId to the service and returns specialist packets + lead decision.
   */
  it("should return packets for a specific review cycle", () => {
    const packets = fakeReviewCyclePackets({
      specialistPackets: [
        { reviewPacketId: "rp-1", reviewerType: "security", verdict: "approved" },
      ],
    });
    service.getReviewCyclePackets.mockReturnValue(packets);

    const result = controller.getReviewCyclePackets("task-1", "cycle-1");

    expect(service.getReviewCyclePackets).toHaveBeenCalledWith("task-1", "cycle-1");
    expect(result).toEqual(packets);
  });

  /**
   * Validates that getReviewCyclePackets throws NotFoundException when
   * the review cycle or task does not exist.
   */
  it("should throw NotFoundException when review cycle not found", () => {
    service.getReviewCyclePackets.mockReturnValue(undefined);

    expect(() => controller.getReviewCyclePackets("task-1", "missing")).toThrow(NotFoundException);
  });
});
