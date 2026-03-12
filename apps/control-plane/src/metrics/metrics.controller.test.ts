/**
 * Tests for the Prometheus metrics controller.
 *
 * Validates that the GET /metrics endpoint correctly delegates to the
 * MetricsHandle from `@factory/observability` and returns Prometheus-
 * compatible text output. The /metrics endpoint is the sole interface
 * between Prometheus and our application — if it breaks, all monitoring
 * dashboards and alerts go dark.
 *
 * Tests use a fake MetricsHandle to isolate controller logic from
 * the real prom-client registry.
 *
 * @module @factory/control-plane
 */
import { Test, TestingModule } from "@nestjs/testing";
import { describe, expect, it, beforeEach } from "vitest";

import { MetricsController, METRICS_HANDLE } from "./metrics.controller.js";
import type { MetricsHandle } from "@factory/observability";

/**
 * Creates a fake MetricsHandle for testing.
 * Returns predictable output without requiring real prom-client registry.
 */
function createFakeMetricsHandle(output = "# HELP test_metric\n"): MetricsHandle {
  return {
    registry: {} as MetricsHandle["registry"],
    getMetricsOutput: async () => output,
    getContentType: () => "text/plain; version=0.0.4; charset=utf-8",
    reset: () => {},
  };
}

describe("MetricsController", () => {
  let controller: MetricsController;
  let fakeHandle: MetricsHandle;

  beforeEach(async () => {
    fakeHandle = createFakeMetricsHandle();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        {
          provide: METRICS_HANDLE,
          useValue: fakeHandle,
        },
      ],
    }).compile();

    controller = module.get<MetricsController>(MetricsController);
  });

  /**
   * Validates that the controller returns the output from MetricsHandle.
   * This is the primary happy-path test — Prometheus scrapes this endpoint
   * and expects properly formatted text output.
   */
  it("should return metrics output from the handle", async () => {
    const result = await controller.getMetrics();
    expect(result).toBe("# HELP test_metric\n");
  });

  /**
   * Validates that the controller delegates to getMetricsOutput.
   * Ensures the controller isn't doing its own formatting or filtering.
   */
  it("should return whatever the handle produces", async () => {
    const customOutput =
      "# HELP factory_task_transitions_total Total transitions.\n" +
      "# TYPE factory_task_transitions_total counter\n" +
      'factory_task_transitions_total{result="success"} 42\n';

    const customHandle = createFakeMetricsHandle(customOutput);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        {
          provide: METRICS_HANDLE,
          useValue: customHandle,
        },
      ],
    }).compile();

    const ctrl = module.get<MetricsController>(MetricsController);
    const result = await ctrl.getMetrics();
    expect(result).toBe(customOutput);
  });

  /**
   * Validates that empty metrics output is handled correctly.
   * When no custom metrics are registered and defaults are off,
   * the output is an empty string — this should not cause errors.
   */
  it("should handle empty metrics output", async () => {
    const emptyHandle = createFakeMetricsHandle("");
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        {
          provide: METRICS_HANDLE,
          useValue: emptyHandle,
        },
      ],
    }).compile();

    const ctrl = module.get<MetricsController>(MetricsController);
    const result = await ctrl.getMetrics();
    expect(result).toBe("");
  });
});
