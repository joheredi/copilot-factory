/**
 * Tests for the artifacts controller.
 *
 * Verifies HTTP-layer behavior by mocking the {@link ArtifactsService}.
 * Each test validates a single aspect: successful responses, delegation
 * to the service, and NotFoundException for missing entities.
 *
 * @module @factory/control-plane
 */
import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArtifactsController } from "./artifacts.controller.js";
import type { ArtifactsService } from "./artifacts.service.js";

/** Factory for a fake artifact tree with sensible defaults. */
function fakeArtifactTree(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "task-1",
    reviewPackets: [],
    leadReviewDecisions: [],
    validationRuns: [],
    mergeQueueItem: null,
    ...overrides,
  };
}

/** Factory for a fake packet content response. */
function fakePacketContent(overrides: Record<string, unknown> = {}) {
  return {
    packetId: "packet-1",
    packetSource: "review_packet" as const,
    content: { packet_type: "review_packet", verdict: "approved" },
    ...overrides,
  };
}

describe("ArtifactsController", () => {
  let controller: ArtifactsController;
  let service: {
    getArtifactTree: ReturnType<typeof vi.fn>;
    getPacketContent: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      getArtifactTree: vi.fn(),
      getPacketContent: vi.fn(),
    };

    controller = new ArtifactsController(service as unknown as ArtifactsService);
  });

  /**
   * Validates that getArtifactTree delegates to the service and returns
   * the assembled artifact tree when the task exists.
   */
  it("should return artifact tree for an existing task", () => {
    const tree = fakeArtifactTree({
      reviewPackets: [
        {
          reviewPacketId: "rp-1",
          reviewCycleId: "rc-1",
          reviewerType: "security",
          verdict: "approved",
          createdAt: new Date(),
        },
      ],
    });
    service.getArtifactTree.mockReturnValue(tree);

    const result = controller.getArtifactTree("task-1");

    expect(service.getArtifactTree).toHaveBeenCalledWith("task-1");
    expect(result).toEqual(tree);
  });

  /**
   * Validates that getArtifactTree throws NotFoundException when the
   * task does not exist. The global exception filter maps this to 404.
   */
  it("should throw NotFoundException when task not found for artifact tree", () => {
    service.getArtifactTree.mockReturnValue(undefined);

    expect(() => controller.getArtifactTree("missing")).toThrow(NotFoundException);
  });

  /**
   * Validates that getPacketContent delegates to the service with both
   * taskId and packetId and returns the parsed content.
   */
  it("should return packet content for an existing packet", () => {
    const content = fakePacketContent();
    service.getPacketContent.mockReturnValue(content);

    const result = controller.getPacketContent("task-1", "packet-1");

    expect(service.getPacketContent).toHaveBeenCalledWith("task-1", "packet-1");
    expect(result).toEqual(content);
  });

  /**
   * Validates that getPacketContent throws NotFoundException when the
   * packet is not found. This covers both missing tasks and missing packets.
   */
  it("should throw NotFoundException when packet not found", () => {
    service.getPacketContent.mockReturnValue(undefined);

    expect(() => controller.getPacketContent("task-1", "missing")).toThrow(NotFoundException);
  });

  /**
   * Validates that getPacketContent propagates NotFoundException thrown
   * by the service (e.g., when the task itself does not exist).
   */
  it("should propagate NotFoundException from service for missing task", () => {
    service.getPacketContent.mockImplementation(() => {
      throw new NotFoundException('Task with ID "missing" not found');
    });

    expect(() => controller.getPacketContent("missing", "packet-1")).toThrow(NotFoundException);
  });
});
