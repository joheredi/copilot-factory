/** @module @factory/observability — Structured logging, OpenTelemetry tracing, and Prometheus metrics. */

export { createLogger, resolveLogLevel } from "./logger.js";

export type { Logger, LogLevel, LogLevelConfig, CreateLoggerOptions } from "./logger.js";

export { runWithContext, getContext, getContextStorage } from "./context.js";

export type { CorrelationContext } from "./context.js";

export { NestLoggerAdapter } from "./nest-logger.js";
export type { NestLoggerService } from "./nest-logger.js";

export {
  initTracing,
  getTracer,
  trace,
  context,
  propagation,
  DiagLogLevel,
  SpanStatusCode,
  InMemorySpanExporter,
} from "./tracing.js";
export type { TracingConfig, TracingHandle, Span } from "./tracing.js";

export { SpanNames, SpanAttributes } from "./spans.js";

export {
  initMetrics,
  getMetricsHandle,
  createCounter,
  createHistogram,
  createGauge,
  resetMetrics,
} from "./metrics.js";
export type { MetricsConfig, MetricsHandle } from "./metrics.js";

export { getStarterMetrics, resetStarterMetrics, TERMINAL_TASK_STATES } from "./starter-metrics.js";
export type { StarterMetrics } from "./starter-metrics.js";
