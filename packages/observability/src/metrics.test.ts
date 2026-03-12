/**
 * Tests for the Prometheus metrics module.
 *
 * Validates that the metrics subsystem correctly initializes a
 * prom-client Registry, collects default Node.js process metrics,
 * produces valid Prometheus text format output, and supports
 * creating counters, histograms, and gauges with proper registration.
 *
 * These tests are essential because the /metrics endpoint is the
 * primary interface for external monitoring systems (Prometheus,
 * Grafana). If metrics initialization or output formatting breaks,
 * all operational visibility into the running system is lost.
 *
 * @module @factory/observability
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  initMetrics,
  getMetricsHandle,
  createCounter,
  createHistogram,
  createGauge,
  resetMetrics,
} from "./metrics.js";

describe("initMetrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    resetMetrics();
  });

  /**
   * Validates that initMetrics returns a handle with the expected
   * interface. The handle is the primary API for the metrics module —
   * without it, no other metrics operations can proceed.
   */
  it("should return a MetricsHandle with registry, getMetricsOutput, getContentType, and reset", () => {
    const handle = initMetrics();
    expect(handle.registry).toBeDefined();
    expect(typeof handle.getMetricsOutput).toBe("function");
    expect(typeof handle.getContentType).toBe("function");
    expect(typeof handle.reset).toBe("function");
  });

  /**
   * Validates that the singleton accessor works after initialization.
   * Many modules retrieve the handle via getMetricsHandle() rather
   * than passing it through dependency injection.
   */
  it("should be retrievable via getMetricsHandle after init", () => {
    const handle = initMetrics();
    expect(getMetricsHandle()).toBe(handle);
  });

  /**
   * Validates that getMetricsHandle returns undefined before init.
   * Callers must handle this case gracefully.
   */
  it("should return undefined from getMetricsHandle before init", () => {
    expect(getMetricsHandle()).toBeUndefined();
  });

  /**
   * Validates that default Node.js metrics are collected when enabled.
   * Default metrics include process CPU, memory, event loop lag, and
   * GC statistics — all critical for diagnosing runtime performance.
   */
  it("should include default Node.js metrics when enableDefaultMetrics is true", async () => {
    const handle = initMetrics({ enableDefaultMetrics: true });
    const output = await handle.getMetricsOutput();
    // Default metrics include process_cpu_seconds_total (with configured prefix)
    expect(output).toContain("nodejs_");
  });

  /**
   * Validates that default metrics can be disabled.
   * In test environments, default metrics add noise and slow down
   * metric output — disabling them keeps output clean.
   */
  it("should not include default metrics when enableDefaultMetrics is false", async () => {
    const handle = initMetrics({ enableDefaultMetrics: false });
    const output = await handle.getMetricsOutput();
    // With no default metrics and no custom metrics registered, output is empty
    // (prom-client may include a trailing newline)
    expect(output.trim()).toBe("");
  });

  /**
   * Validates that a custom prefix is applied to default metrics.
   * The prefix allows distinguishing metrics from different services
   * when multiple services run on the same Prometheus instance.
   * Note: some default metric names already contain "nodejs_" (e.g.,
   * nodejs_eventloop_lag_seconds), so the prefix prepends to those,
   * producing names like "custom_nodejs_eventloop_lag_seconds".
   */
  it("should apply custom prefix to default metrics", async () => {
    const handle = initMetrics({
      enableDefaultMetrics: true,
      defaultMetricsPrefix: "custom_",
    });
    const output = await handle.getMetricsOutput();
    expect(output).toContain("custom_");
    // Verify the prefix is applied — all HELP lines should use the custom prefix
    const helpLines = output.split("\n").filter((l) => l.startsWith("# HELP "));
    for (const line of helpLines) {
      expect(line).toMatch(/^# HELP custom_/);
    }
  });

  /**
   * Validates that the content type matches Prometheus expectations.
   * Prometheus scraper requires specific content-type header to parse
   * the response correctly.
   */
  it("should return a content type containing text/plain or openmetrics", () => {
    const handle = initMetrics({ enableDefaultMetrics: false });
    const contentType = handle.getContentType();
    // prom-client returns either text/plain or application/openmetrics-text
    expect(contentType).toMatch(/text\/plain|openmetrics/);
  });

  /**
   * Validates that default labels are applied to all metrics.
   * Default labels (e.g., service name) help identify the source
   * of metrics in a multi-service deployment.
   */
  it("should apply default labels to all metrics", async () => {
    const handle = initMetrics({
      enableDefaultMetrics: false,
      defaultLabels: { service: "test-service" },
    });
    const counter = createCounter({
      name: "test_counter_total",
      help: "A test counter.",
    });
    counter.inc();
    const output = await handle.getMetricsOutput();
    expect(output).toContain('service="test-service"');
  });

  /**
   * Validates that reset clears the singleton and registry.
   * Tests and graceful shutdown need clean teardown.
   */
  it("should clear the singleton on resetMetrics", () => {
    initMetrics();
    expect(getMetricsHandle()).toBeDefined();
    resetMetrics();
    expect(getMetricsHandle()).toBeUndefined();
  });
});

describe("createCounter", () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    resetMetrics();
  });

  /**
   * Validates that counters are registered on the active registry
   * and their increments appear in the Prometheus output.
   * Counters are the most common metric type — used for all _total metrics.
   */
  it("should create a counter registered on the active registry", async () => {
    const handle = initMetrics({ enableDefaultMetrics: false });
    const counter = createCounter({
      name: "factory_test_total",
      help: "Test counter.",
      labelNames: ["result"] as const,
    });
    counter.inc({ result: "success" });
    counter.inc({ result: "success" });
    counter.inc({ result: "failure" });

    const output = await handle.getMetricsOutput();
    expect(output).toContain("factory_test_total");
    expect(output).toContain('result="success"');
    expect(output).toContain('result="failure"');
    expect(output).toContain("# HELP factory_test_total Test counter.");
    expect(output).toContain("# TYPE factory_test_total counter");
  });

  /**
   * Validates that counters can be registered on a custom registry
   * instead of the active singleton. This is useful for isolated
   * test scenarios or multi-registry setups.
   */
  it("should register on an explicit registry when provided", async () => {
    const { Registry } = await import("prom-client");
    const custom = new Registry();
    const counter = createCounter(
      {
        name: "custom_counter_total",
        help: "Custom registry counter.",
      },
      custom,
    );
    counter.inc();
    const output = await custom.metrics();
    expect(output).toContain("custom_counter_total");
  });
});

describe("createHistogram", () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    resetMetrics();
  });

  /**
   * Validates that histograms record observations and produce
   * bucket/sum/count output in Prometheus format.
   * Histograms are used for duration metrics like worker run time.
   */
  it("should create a histogram with buckets on the active registry", async () => {
    const handle = initMetrics({ enableDefaultMetrics: false });
    const histogram = createHistogram({
      name: "factory_duration_seconds",
      help: "Test histogram.",
      labelNames: ["pool_id"] as const,
      buckets: [1, 5, 10, 30, 60],
    });
    histogram.observe({ pool_id: "dev" }, 7.5);

    const output = await handle.getMetricsOutput();
    expect(output).toContain("factory_duration_seconds_bucket");
    expect(output).toContain("factory_duration_seconds_sum");
    expect(output).toContain("factory_duration_seconds_count");
    expect(output).toContain('pool_id="dev"');
    expect(output).toContain("# TYPE factory_duration_seconds histogram");
  });
});

describe("createGauge", () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    resetMetrics();
  });

  /**
   * Validates that gauges can be set and appear in output.
   * Gauges are used for values that go up and down, like queue depth.
   */
  it("should create a gauge on the active registry", async () => {
    const handle = initMetrics({ enableDefaultMetrics: false });
    const gauge = createGauge({
      name: "factory_queue_depth",
      help: "Test gauge.",
      labelNames: ["job_type"] as const,
    });
    gauge.set({ job_type: "merge" }, 5);

    const output = await handle.getMetricsOutput();
    expect(output).toContain("factory_queue_depth");
    expect(output).toContain('job_type="merge"');
    expect(output).toContain("# TYPE factory_queue_depth gauge");
  });

  /**
   * Validates inc/dec operations on gauges.
   * Queue depth gauges need increment/decrement support.
   */
  it("should support inc and dec on gauges", async () => {
    const handle = initMetrics({ enableDefaultMetrics: false });
    const gauge = createGauge({
      name: "factory_active_workers",
      help: "Active workers gauge.",
    });
    gauge.inc();
    gauge.inc();
    gauge.dec();

    const output = await handle.getMetricsOutput();
    expect(output).toContain("factory_active_workers 1");
  });
});
