/**
 * NestJS module for the Prometheus metrics endpoint.
 *
 * Initializes the metrics subsystem from `@factory/observability`
 * and registers the {@link MetricsController} to serve GET /metrics.
 *
 * The module provides the {@link MetricsHandle} as a singleton
 * so that other modules can inject it to register custom metrics.
 *
 * @see docs/prd/010-integration-contracts.md §10.13 for metric conventions
 * @module @factory/control-plane
 */
import { Module } from "@nestjs/common";
import { initMetrics } from "@factory/observability";
import type { MetricsHandle } from "@factory/observability";

import { MetricsController, METRICS_HANDLE } from "./metrics.controller.js";

/**
 * Factory provider that initializes the metrics subsystem.
 *
 * Creates a prom-client Registry with default Node.js process metrics
 * enabled and a `service` default label identifying this as the
 * control-plane. The returned handle is available for injection
 * via the {@link METRICS_HANDLE} token.
 */
const metricsHandleProvider = {
  provide: METRICS_HANDLE,
  useFactory: (): MetricsHandle => {
    return initMetrics({
      enableDefaultMetrics: true,
      defaultLabels: { service: "factory-control-plane" },
    });
  },
};

/**
 * Registers the metrics controller and initializes the metrics subsystem.
 *
 * Exports the {@link METRICS_HANDLE} token so other modules can inject
 * the handle to register custom counters, histograms, and gauges.
 */
@Module({
  controllers: [MetricsController],
  providers: [metricsHandleProvider],
  exports: [METRICS_HANDLE],
})
export class MetricsModule {}
