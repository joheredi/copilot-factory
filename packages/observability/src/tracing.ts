/**
 * OpenTelemetry tracing initialization for the control-plane service.
 *
 * Configures the TracerProvider with OTLP and/or console span exporters,
 * W3C trace context propagation, and automatic HTTP instrumentation.
 * Must be initialized before the NestJS application bootstraps so that
 * HTTP requests are automatically traced.
 *
 * @see docs/prd/007-technical-architecture.md §7.14 for the observability architecture.
 * @see docs/prd/010-integration-contracts.md §10.13 for recommended spans and metrics.
 * @module @factory/observability
 */

import { trace, type Tracer, diag, DiagLogLevel, context, propagation } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  SimpleSpanProcessor,
  ConsoleSpanExporter,
  type SpanExporter,
  InMemorySpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

/** Default OTLP collector endpoint for trace export. */
const DEFAULT_OTLP_ENDPOINT = "http://localhost:4318";

/** Default service name used in trace resource attributes. */
const DEFAULT_SERVICE_NAME = "factory-control-plane";

/** Default service version. */
const DEFAULT_SERVICE_VERSION = "0.1.0";

/**
 * Configuration options for OpenTelemetry tracing initialization.
 *
 * All fields are optional — sensible defaults are applied when omitted.
 * The exporter configuration follows a layered approach: explicit options
 * override environment variables, which override built-in defaults.
 */
export interface TracingConfig {
  /**
   * The service name reported in trace resource attributes.
   * @default "factory-control-plane"
   */
  readonly serviceName?: string;

  /**
   * The service version reported in trace resource attributes.
   * @default "0.1.0"
   */
  readonly serviceVersion?: string;

  /**
   * OTLP collector endpoint URL.
   * Set to `undefined` or omit to use the default.
   * @default "http://localhost:4318"
   */
  readonly otlpEndpoint?: string;

  /**
   * Whether to enable the OTLP trace exporter.
   * When `false`, traces are not sent to any collector.
   * @default true
   */
  readonly enableOtlpExporter?: boolean;

  /**
   * Whether to enable the console span exporter for development.
   * Prints span data to stdout in a human-readable format.
   * @default false
   */
  readonly enableConsoleExporter?: boolean;

  /**
   * Whether to enable automatic HTTP instrumentation.
   * When `true`, inbound and outbound HTTP requests generate spans automatically.
   * @default true
   */
  readonly enableHttpInstrumentation?: boolean;

  /**
   * Custom span exporters to add beyond the built-in OTLP and console exporters.
   * Useful for testing (e.g., InMemorySpanExporter) or custom backends.
   */
  readonly additionalExporters?: readonly SpanExporter[];

  /**
   * OpenTelemetry diagnostic log level. Set to `DiagLogLevel.DEBUG` for
   * troubleshooting SDK issues.
   * @default DiagLogLevel.NONE
   */
  readonly diagLogLevel?: DiagLogLevel;
}

/**
 * Handle returned by {@link initTracing} for lifecycle management.
 *
 * The caller must invoke {@link TracingHandle.shutdown} during application
 * teardown to flush pending spans and release resources.
 */
export interface TracingHandle {
  /**
   * Gracefully shuts down the OpenTelemetry SDK.
   * Flushes any buffered spans to exporters before resolving.
   */
  shutdown(): Promise<void>;
}

/**
 * Initializes the OpenTelemetry SDK with TracerProvider, exporters, and instrumentation.
 *
 * This function must be called **before** the NestJS application bootstraps
 * so that the HTTP instrumentation can monkey-patch Node.js `http`/`https`
 * modules before any HTTP servers or clients are created.
 *
 * The SDK uses W3C TraceContext propagation by default, which is the standard
 * for cross-service trace correlation.
 *
 * @param config - Optional tracing configuration. Defaults provide a
 *   production-ready setup with OTLP export to localhost:4318.
 * @returns A {@link TracingHandle} with a `shutdown()` method for clean teardown.
 *
 * @example
 * ```ts
 * // In main.ts, before NestJS bootstrap:
 * const tracing = initTracing({
 *   serviceName: "factory-control-plane",
 *   enableConsoleExporter: process.env.NODE_ENV === "development",
 * });
 *
 * // During application shutdown:
 * await tracing.shutdown();
 * ```
 *
 * @see docs/prd/007-technical-architecture.md §7.14 for the observability architecture.
 */
export function initTracing(config: TracingConfig = {}): TracingHandle {
  const {
    serviceName = DEFAULT_SERVICE_NAME,
    serviceVersion = DEFAULT_SERVICE_VERSION,
    otlpEndpoint = DEFAULT_OTLP_ENDPOINT,
    enableOtlpExporter = true,
    enableConsoleExporter = false,
    enableHttpInstrumentation = true,
    additionalExporters = [],
    diagLogLevel = DiagLogLevel.NONE,
  } = config;

  // Configure diagnostic logging for OTel SDK troubleshooting.
  if (diagLogLevel !== DiagLogLevel.NONE) {
    diag.setLogger(
      {
        error: console.error,
        warn: console.warn,
        info: console.info,
        debug: console.debug,
        verbose: console.trace,
      },
      diagLogLevel,
    );
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
  });

  const spanProcessors: SimpleSpanProcessor[] = [];

  if (enableOtlpExporter) {
    const otlpExporter = new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
    });
    spanProcessors.push(new SimpleSpanProcessor(otlpExporter));
  }

  if (enableConsoleExporter) {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  for (const exporter of additionalExporters) {
    spanProcessors.push(new SimpleSpanProcessor(exporter));
  }

  const provider = new NodeTracerProvider({
    resource,
    spanProcessors,
  });

  // Register as the global TracerProvider and set W3C trace context propagation.
  provider.register({
    propagator: new W3CTraceContextPropagator(),
  });

  // Register HTTP auto-instrumentation if enabled.
  let deregisterInstrumentations: (() => void) | undefined;
  if (enableHttpInstrumentation) {
    deregisterInstrumentations = registerInstrumentations({
      instrumentations: [new HttpInstrumentation()],
    });
  }

  return {
    async shutdown(): Promise<void> {
      if (deregisterInstrumentations) {
        deregisterInstrumentations();
      }
      await provider.shutdown();
      // Reset the global TracerProvider so subsequent initTracing calls work.
      trace.disable();
    },
  };
}

/**
 * Returns an OpenTelemetry Tracer for the given module.
 *
 * Use this to create spans for tracing specific operations within a module.
 * The tracer is retrieved from the global TracerProvider, which is set up by
 * {@link initTracing}. If tracing has not been initialized, a no-op tracer
 * is returned (safe to call unconditionally).
 *
 * @param moduleName - The name of the module requesting the tracer
 *   (e.g., "scheduler", "lease-manager", "worker-supervisor").
 * @param version - Optional version string for the tracer.
 * @returns An OpenTelemetry {@link Tracer} instance.
 *
 * @example
 * ```ts
 * const tracer = getTracer("scheduler");
 * tracer.startSpan("scheduler.tick", {}, (span) => {
 *   // ... do work ...
 *   span.end();
 * });
 * ```
 *
 * @see docs/prd/010-integration-contracts.md §10.13.2 for recommended span names.
 */
export function getTracer(moduleName: string, version?: string): Tracer {
  return trace.getTracer(moduleName, version);
}

// Re-export commonly used OTel API types so consumers don't need
// a direct dependency on @opentelemetry/api for basic span operations.
export { trace, context, propagation, DiagLogLevel, InMemorySpanExporter };
export { SpanStatusCode } from "@opentelemetry/api";
export type { Tracer, Span } from "@opentelemetry/api";
export type { SpanExporter } from "@opentelemetry/sdk-trace-base";
