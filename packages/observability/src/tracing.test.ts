/**
 * Tests for the OpenTelemetry tracing initialization module.
 *
 * These tests verify that the TracerProvider is correctly configured with
 * the expected resource attributes, exporters, and instrumentation. They
 * use the InMemorySpanExporter to capture spans without network I/O.
 *
 * Important: SimpleSpanProcessor exports spans synchronously on span.end(),
 * so spans are immediately available in InMemorySpanExporter. However,
 * provider.shutdown() clears the exporter, so we must read spans BEFORE
 * shutdown. The afterEach hook handles cleanup.
 *
 * @see docs/prd/007-technical-architecture.md §7.14 for observability requirements.
 * @see docs/prd/010-integration-contracts.md §10.13 for span naming conventions.
 */
import { describe, it, expect, afterEach } from "vitest";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";

import { initTracing, getTracer } from "./tracing.js";
import type { TracingHandle, TracingConfig } from "./tracing.js";

/**
 * Helper to create a tracing setup with an in-memory exporter for testing.
 * Disables OTLP and HTTP instrumentation to avoid side effects in tests.
 */
function createTestTracing(overrides: Partial<TracingConfig> = {}): {
  handle: TracingHandle;
  exporter: InMemorySpanExporter;
} {
  const exporter = new InMemorySpanExporter();
  const handle = initTracing({
    enableOtlpExporter: false,
    enableConsoleExporter: false,
    enableHttpInstrumentation: false,
    additionalExporters: [exporter],
    ...overrides,
  });
  return { handle, exporter };
}

describe("initTracing", () => {
  /**
   * Tests for the tracing initialization function. This is the entry point
   * for all OpenTelemetry configuration. Correctness here is critical because
   * a misconfigured TracerProvider silently produces no-op spans, making
   * production debugging impossible.
   */

  let handle: TracingHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = undefined;
    }
  });

  /**
   * Validates that initTracing returns a handle with a shutdown method.
   * The shutdown method is essential for clean process termination —
   * without it, buffered spans may be lost on exit.
   */
  it("should return a handle with a shutdown method", () => {
    const result = createTestTracing();
    handle = result.handle;

    expect(handle).toBeDefined();
    expect(typeof handle.shutdown).toBe("function");
  });

  /**
   * Validates that spans created after initialization are captured by
   * the configured exporter. This is the fundamental correctness check:
   * if spans aren't flowing to exporters, the entire tracing pipeline
   * is broken.
   */
  it("should capture spans via the configured exporter", () => {
    const { handle: h, exporter } = createTestTracing();
    handle = h;

    const tracer = trace.getTracer("test-module");
    const span = tracer.startSpan("test-operation");
    span.end();

    // SimpleSpanProcessor exports synchronously on span.end()
    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBe(1);
    expect(spans[0]!.name).toBe("test-operation");
  });

  /**
   * Validates that the service name resource attribute is correctly set.
   * Trace backends (Jaeger, Tempo) use this attribute to group spans by
   * service, so an incorrect value makes traces unfindable.
   */
  it("should set the service name resource attribute", () => {
    const { handle: h, exporter } = createTestTracing({
      serviceName: "my-test-service",
    });
    handle = h;

    const tracer = trace.getTracer("test");
    tracer.startSpan("resource-check").end();

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    const resource = spans[0]!.resource;
    expect(resource.attributes["service.name"]).toBe("my-test-service");
  });

  /**
   * Validates that the service version resource attribute is correctly set.
   * This helps distinguish spans from different deployment versions.
   */
  it("should set the service version resource attribute", () => {
    const { handle: h, exporter } = createTestTracing({
      serviceVersion: "2.0.0",
    });
    handle = h;

    const tracer = trace.getTracer("test");
    tracer.startSpan("version-check").end();

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    const resource = spans[0]!.resource;
    expect(resource.attributes["service.version"]).toBe("2.0.0");
  });

  /**
   * Validates that default configuration values are applied when no
   * explicit config is provided. This ensures zero-config usage works
   * out of the box for development.
   */
  it("should use default service name when not configured", () => {
    const { handle: h, exporter } = createTestTracing();
    handle = h;

    const tracer = trace.getTracer("test");
    tracer.startSpan("defaults-check").end();

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    const resource = spans[0]!.resource;
    expect(resource.attributes["service.name"]).toBe("factory-control-plane");
    expect(resource.attributes["service.version"]).toBe("0.1.0");
  });

  /**
   * Validates that all spans created within a session are captured.
   * This ensures no spans are silently dropped during normal operation.
   */
  it("should capture all spans created within a session", () => {
    const { handle: h, exporter } = createTestTracing();
    handle = h;

    const tracer = trace.getTracer("test");
    for (let i = 0; i < 5; i++) {
      tracer.startSpan(`span-${i}`).end();
    }

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBe(5);
  });

  /**
   * Validates that span attributes (key-value pairs) are correctly
   * recorded. Attributes are the primary mechanism for attaching
   * operational context (taskId, runId, etc.) to spans for querying
   * in trace backends.
   */
  it("should record span attributes", () => {
    const { handle: h, exporter } = createTestTracing();
    handle = h;

    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("attributed-op");
    span.setAttribute("task.id", "task-123");
    span.setAttribute("worker.id", "worker-456");
    span.end();

    const spans = exporter.getFinishedSpans();
    expect(spans[0]!.attributes["task.id"]).toBe("task-123");
    expect(spans[0]!.attributes["worker.id"]).toBe("worker-456");
  });

  /**
   * Validates that span status (OK/ERROR) is recorded. Error status
   * is critical for trace backends to highlight failed operations
   * and calculate error rates.
   */
  it("should record span status", () => {
    const { handle: h, exporter } = createTestTracing();
    handle = h;

    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("status-op");
    span.setStatus({ code: SpanStatusCode.ERROR, message: "something failed" });
    span.end();

    const spans = exporter.getFinishedSpans();
    expect(spans[0]!.status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0]!.status.message).toBe("something failed");
  });

  /**
   * Validates parent-child span relationships. Trace context propagation
   * relies on parent spans being correctly linked to child spans. Without
   * this, trace backends cannot reconstruct the execution tree.
   */
  it("should maintain parent-child span relationships", () => {
    const { handle: h, exporter } = createTestTracing();
    handle = h;

    const tracer = trace.getTracer("test");
    tracer.startActiveSpan("parent-op", (parentSpan) => {
      tracer.startActiveSpan("child-op", (childSpan) => {
        childSpan.end();
      });
      parentSpan.end();
    });

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBe(2);

    const childSpan = spans.find((s) => s.name === "child-op")!;
    const parentSpan = spans.find((s) => s.name === "parent-op")!;

    expect(childSpan.parentSpanContext?.spanId).toBe(parentSpan.spanContext().spanId);
    expect(childSpan.spanContext().traceId).toBe(parentSpan.spanContext().traceId);
  });

  /**
   * Validates that span events (annotations with timestamps) are recorded.
   * Events are used to mark significant points within a span's lifetime
   * (e.g., "retry attempt 2", "cache miss").
   */
  it("should record span events", () => {
    const { handle: h, exporter } = createTestTracing();
    handle = h;

    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("events-op");
    span.addEvent("cache-miss", { "cache.key": "task-list" });
    span.end();

    const spans = exporter.getFinishedSpans();
    expect(spans[0]!.events.length).toBe(1);
    expect(spans[0]!.events[0]!.name).toBe("cache-miss");
    expect(spans[0]!.events[0]!.attributes!["cache.key"]).toBe("task-list");
  });

  /**
   * Validates that multiple additional exporters can be configured.
   * This is important for setups that need to send traces to multiple
   * backends simultaneously (e.g., OTLP + console during development).
   */
  it("should support multiple additional exporters", () => {
    const exporter1 = new InMemorySpanExporter();
    const exporter2 = new InMemorySpanExporter();

    handle = initTracing({
      enableOtlpExporter: false,
      enableConsoleExporter: false,
      enableHttpInstrumentation: false,
      additionalExporters: [exporter1, exporter2],
    });

    const tracer = trace.getTracer("test");
    tracer.startSpan("multi-export").end();

    expect(exporter1.getFinishedSpans().length).toBe(1);
    expect(exporter2.getFinishedSpans().length).toBe(1);
  });

  /**
   * Validates that shutdown gracefully completes without errors.
   * This is important for clean process termination.
   */
  it("should shutdown gracefully", async () => {
    const { handle: h } = createTestTracing();
    handle = h;

    const tracer = trace.getTracer("test");
    tracer.startSpan("pre-shutdown").end();

    await handle.shutdown();
    handle = undefined;
    // No assertion needed — the test verifies shutdown doesn't throw.
  });
});

describe("getTracer", () => {
  /**
   * Tests for the getTracer convenience function. This wraps the global
   * OTel API to provide a consistent interface for module-scoped tracers.
   * The function is safe to call even before initTracing — it returns a
   * no-op tracer in that case.
   */

  let handle: TracingHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = undefined;
    }
  });

  /**
   * Validates that getTracer returns a valid Tracer object with the
   * expected span creation methods. This is the primary API consumers
   * will use in application code.
   */
  it("should return a tracer with span creation methods", () => {
    const tracer = getTracer("test-module");
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe("function");
    expect(typeof tracer.startActiveSpan).toBe("function");
  });

  /**
   * Validates that the tracer name is correctly set on exported spans.
   * Trace backends use the instrumentation scope name to filter and
   * group spans by module, which is essential for debugging specific
   * subsystems.
   */
  it("should create spans with the correct instrumentation scope", () => {
    const exporter = new InMemorySpanExporter();
    handle = initTracing({
      enableOtlpExporter: false,
      enableConsoleExporter: false,
      enableHttpInstrumentation: false,
      additionalExporters: [exporter],
    });

    const tracer = getTracer("scheduler");
    tracer.startSpan("scheduler.tick").end();

    const spans = exporter.getFinishedSpans();
    expect(spans[0]!.instrumentationScope.name).toBe("scheduler");
  });

  /**
   * Validates that getTracer respects the optional version parameter.
   * Versioned tracers help distinguish spans from different versions of
   * the same module during rolling deployments.
   */
  it("should accept an optional version parameter", () => {
    const exporter = new InMemorySpanExporter();
    handle = initTracing({
      enableOtlpExporter: false,
      enableConsoleExporter: false,
      enableHttpInstrumentation: false,
      additionalExporters: [exporter],
    });

    const tracer = getTracer("scheduler", "1.2.3");
    tracer.startSpan("versioned-op").end();

    const spans = exporter.getFinishedSpans();
    expect(spans[0]!.instrumentationScope.version).toBe("1.2.3");
  });
});
