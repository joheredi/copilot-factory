/**
 * Tests for the health check controller.
 *
 * These tests verify the GET /health endpoint works correctly and returns
 * the expected structured response. The health endpoint is the primary
 * liveness probe for the control-plane service — if it breaks, monitoring
 * and deployment systems cannot verify the service is running.
 *
 * @module @factory/control-plane
 */
import { Test, TestingModule } from "@nestjs/testing";
import { describe, expect, it, beforeEach } from "vitest";

import { HealthController, HealthResponse } from "./health.controller.js";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  /**
   * Validates that the health endpoint returns the expected status.
   * This is the most basic acceptance criterion — if "ok" is not
   * returned, the service is not healthy.
   */
  it("should return status ok", () => {
    const result: HealthResponse = controller.getHealth();
    expect(result.status).toBe("ok");
  });

  /**
   * Validates that the service name is included in the response.
   * Clients and monitoring systems use this to distinguish between
   * multiple services in a multi-service deployment.
   */
  it("should return the service name", () => {
    const result: HealthResponse = controller.getHealth();
    expect(result.service).toBe("factory-control-plane");
  });

  /**
   * Validates that a valid ISO 8601 timestamp is returned.
   * The timestamp lets monitoring tools measure clock drift and
   * verify the service is returning fresh responses (not cached).
   */
  it("should return a valid ISO 8601 timestamp", () => {
    const result: HealthResponse = controller.getHealth();
    const parsed = Date.parse(result.timestamp);
    expect(parsed).not.toBeNaN();
    // Verify it's within the last few seconds (not a stale value)
    expect(Date.now() - parsed).toBeLessThan(5000);
  });
});
