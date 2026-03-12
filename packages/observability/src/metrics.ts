/**
 * Prometheus metrics registry and factory functions.
 *
 * Provides a centralized metrics Registry backed by prom-client,
 * default Node.js process metrics, and factory functions for creating
 * counters, histograms, and gauges with consistent naming conventions.
 *
 * Metric names follow the `factory_*` prefix convention from
 * docs/prd/010-integration-contracts.md §10.13.3. Labels follow the
 * low-cardinality rules from §10.13.4 — never use task_id, run_id,
 * or branch_name as Prometheus labels.
 *
 * @see docs/prd/010-integration-contracts.md §10.13 for metric naming and label rules
 * @module @factory/observability
 */
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
  type CounterConfiguration,
  type HistogramConfiguration,
  type GaugeConfiguration,
} from "prom-client";

/**
 * Configuration options for initializing the metrics subsystem.
 */
export interface MetricsConfig {
  /**
   * Prefix applied to all default Node.js metrics.
   * @default "nodejs_"
   */
  readonly defaultMetricsPrefix?: string;

  /**
   * Whether to collect default Node.js process metrics
   * (CPU, memory, event loop lag, GC, file descriptors).
   * @default true
   */
  readonly enableDefaultMetrics?: boolean;

  /**
   * Custom labels applied to every metric in the registry.
   * Useful for adding a `service` label to distinguish instances.
   */
  readonly defaultLabels?: Record<string, string>;
}

/**
 * Handle returned by {@link initMetrics} for lifecycle management.
 */
export interface MetricsHandle {
  /** The prom-client Registry instance backing all metrics. */
  readonly registry: Registry;

  /**
   * Returns Prometheus-formatted text output of all registered metrics.
   * Suitable for serving from a GET /metrics endpoint.
   */
  getMetricsOutput(): Promise<string>;

  /**
   * Returns the content type header value for the metrics output.
   * Should be used as the Content-Type response header.
   */
  getContentType(): string;

  /**
   * Clears all metric values and stops default metric collection.
   * Call during shutdown or in tests to reset state.
   */
  reset(): void;
}

/** Singleton metrics handle — set by {@link initMetrics}. */
let activeHandle: MetricsHandle | undefined;

/**
 * Initializes the Prometheus metrics subsystem.
 *
 * Creates a dedicated Registry, optionally enables default Node.js
 * process metrics, and returns a {@link MetricsHandle} for reading
 * output and managing lifecycle.
 *
 * Should be called once during application startup, before any
 * custom metrics are registered.
 *
 * @param config - Optional configuration for the metrics subsystem.
 * @returns A {@link MetricsHandle} for interacting with the registry.
 *
 * @example
 * ```ts
 * const metrics = initMetrics({ enableDefaultMetrics: true });
 * // Later, in a controller:
 * const output = await metrics.getMetricsOutput();
 * ```
 */
export function initMetrics(config: MetricsConfig = {}): MetricsHandle {
  const registry = new Registry();

  const {
    defaultMetricsPrefix = "nodejs_",
    enableDefaultMetrics: enableDefaults = true,
    defaultLabels,
  } = config;

  if (defaultLabels) {
    registry.setDefaultLabels(defaultLabels);
  }

  if (enableDefaults) {
    collectDefaultMetrics({ register: registry, prefix: defaultMetricsPrefix });
  }

  const handle: MetricsHandle = {
    registry,

    async getMetricsOutput(): Promise<string> {
      return registry.metrics();
    },

    getContentType(): string {
      return registry.contentType;
    },

    reset(): void {
      registry.clear();
    },
  };

  activeHandle = handle;
  return handle;
}

/**
 * Returns the active {@link MetricsHandle}, or undefined if
 * {@link initMetrics} has not been called.
 *
 * Useful for accessing the registry from modules that don't
 * have a direct reference to the handle returned by initMetrics.
 */
export function getMetricsHandle(): MetricsHandle | undefined {
  return activeHandle;
}

/**
 * Creates a Prometheus Counter and registers it on the given registry.
 *
 * Counters represent monotonically increasing values — use them for
 * totals (e.g., `factory_task_transitions_total`).
 *
 * @param config - prom-client counter configuration (name, help, labelNames).
 * @param registry - Registry to register the counter on. Defaults to the active registry.
 * @returns The created Counter instance.
 *
 * @example
 * ```ts
 * const transitions = createCounter({
 *   name: "factory_task_transitions_total",
 *   help: "Total number of task state transitions.",
 *   labelNames: ["repository_id", "task_state", "result"],
 * });
 * transitions.inc({ repository_id: "repo-1", task_state: "APPROVED", result: "success" });
 * ```
 */
export function createCounter<T extends string>(
  config: CounterConfiguration<T>,
  registry?: Registry,
): Counter<T> {
  const reg = registry ?? activeHandle?.registry;
  const registers = reg ? [reg] : [];
  return new Counter<T>({ ...config, registers });
}

/**
 * Creates a Prometheus Histogram and registers it on the given registry.
 *
 * Histograms observe distributions of values — use them for durations
 * (e.g., `factory_worker_run_duration_seconds`).
 *
 * @param config - prom-client histogram configuration (name, help, labelNames, buckets).
 * @param registry - Registry to register the histogram on. Defaults to the active registry.
 * @returns The created Histogram instance.
 *
 * @example
 * ```ts
 * const runDuration = createHistogram({
 *   name: "factory_worker_run_duration_seconds",
 *   help: "Duration of worker runs.",
 *   labelNames: ["repository_id", "pool_id"],
 *   buckets: [5, 30, 60, 120, 300],
 * });
 * runDuration.observe({ repository_id: "repo-1", pool_id: "developer" }, 42.5);
 * ```
 */
export function createHistogram<T extends string>(
  config: HistogramConfiguration<T>,
  registry?: Registry,
): Histogram<T> {
  const reg = registry ?? activeHandle?.registry;
  const registers = reg ? [reg] : [];
  return new Histogram<T>({ ...config, registers });
}

/**
 * Creates a Prometheus Gauge and registers it on the given registry.
 *
 * Gauges represent values that can go up and down — use them for
 * current state (e.g., `factory_queue_depth`).
 *
 * @param config - prom-client gauge configuration (name, help, labelNames).
 * @param registry - Registry to register the gauge on. Defaults to the active registry.
 * @returns The created Gauge instance.
 *
 * @example
 * ```ts
 * const queueDepth = createGauge({
 *   name: "factory_queue_depth",
 *   help: "Current queue depth by job type.",
 *   labelNames: ["repository_id", "job_type"],
 * });
 * queueDepth.set({ repository_id: "repo-1", job_type: "merge" }, 2);
 * ```
 */
export function createGauge<T extends string>(
  config: GaugeConfiguration<T>,
  registry?: Registry,
): Gauge<T> {
  const reg = registry ?? activeHandle?.registry;
  const registers = reg ? [reg] : [];
  return new Gauge<T>({ ...config, registers });
}

/**
 * Resets the module-level singleton. Intended for test cleanup only.
 * @internal
 */
export function resetMetrics(): void {
  if (activeHandle) {
    activeHandle.reset();
    activeHandle = undefined;
  }
}
