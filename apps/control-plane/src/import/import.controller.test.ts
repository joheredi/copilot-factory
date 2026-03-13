/**
 * Unit tests for the ImportController.
 *
 * Tests verify that the controller correctly delegates to ImportService
 * and passes through the request parameters. The controller is thin —
 * business logic lives in the service — so these tests focus on:
 * 1. Correct delegation of path and pattern to the service
 * 2. Return value passthrough from service to HTTP response
 *
 * @module @factory/control-plane
 * @see T115 — Create POST /import/discover endpoint
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImportController } from "./import.controller.js";
import type { DiscoverResponse } from "./import.service.js";

/**
 * Creates a fake discover response for testing.
 *
 * Provides a complete, valid response object that mimics what the service
 * would return. Uses deterministic values so assertions are stable.
 */
function fakeDiscoverResponse(overrides?: Partial<DiscoverResponse>): DiscoverResponse {
  return {
    tasks: [
      {
        title: "Test task",
        taskType: "feature",
        priority: "medium",
        source: "T001-test.md",
        externalRef: "T001",
      },
    ],
    warnings: [],
    suggestedProjectName: "my-project",
    suggestedRepositoryName: "my-project",
    format: "markdown",
    ...overrides,
  };
}

describe("ImportController", () => {
  let controller: ImportController;
  let service: {
    discover: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      discover: vi.fn(),
    };
    controller = new ImportController(service as never);
  });

  /**
   * Validates the happy path: controller calls service.discover with the
   * DTO path and pattern, and returns the service result unmodified.
   * This is critical because the controller must not transform the response.
   */
  it("should call service.discover with path and pattern", async () => {
    const response = fakeDiscoverResponse();
    service.discover.mockResolvedValue(response);

    const result = await controller.discover({
      path: "/some/path",
      pattern: "tasks/*.md",
    });

    expect(service.discover).toHaveBeenCalledWith("/some/path", "tasks/*.md");
    expect(result).toEqual(response);
  });

  /**
   * Validates that omitting the optional pattern parameter still works.
   * The service should receive undefined for pattern when not provided.
   */
  it("should call service.discover without pattern when not provided", async () => {
    const response = fakeDiscoverResponse();
    service.discover.mockResolvedValue(response);

    const result = await controller.discover({ path: "/another/path" });

    expect(service.discover).toHaveBeenCalledWith("/another/path", undefined);
    expect(result).toEqual(response);
  });

  /**
   * Validates that the controller passes through JSON format responses.
   * This ensures the controller doesn't accidentally filter or transform
   * format-specific fields from the service response.
   */
  it("should pass through json format discovery results", async () => {
    const response = fakeDiscoverResponse({
      format: "json",
      tasks: [
        {
          title: "JSON task",
          taskType: "bug_fix",
          priority: "high",
          source: "backlog.json",
        },
      ],
      warnings: [
        {
          file: "backlog.json",
          field: "priority",
          message: "Could not map priority",
          severity: "warning",
        },
      ],
    });
    service.discover.mockResolvedValue(response);

    const result = await controller.discover({ path: "/json/path" });

    expect(result.format).toBe("json");
    expect(result.tasks).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  /**
   * Validates that service errors propagate to the controller caller.
   * The global exception filter handles mapping these to HTTP responses,
   * but the controller must not swallow exceptions.
   */
  it("should propagate service errors", async () => {
    service.discover.mockRejectedValue(new Error("Path does not exist"));

    await expect(controller.discover({ path: "/nonexistent" })).rejects.toThrow(
      "Path does not exist",
    );
  });
});
