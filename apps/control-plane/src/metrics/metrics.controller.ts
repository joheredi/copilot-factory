/**
 * Prometheus metrics controller for the control-plane service.
 *
 * Exposes a GET /metrics endpoint that returns Prometheus-compatible
 * text format output. This endpoint is scraped by Prometheus (or
 * compatible collectors) to feed monitoring dashboards and alerting.
 *
 * The controller delegates to {@link MetricsHandle} from
 * `@factory/observability` for the actual metric collection and
 * formatting. Custom business metrics (T079) are registered by
 * other modules via the factory functions exported from
 * `@factory/observability`.
 *
 * @see docs/prd/010-integration-contracts.md §10.13 for metric naming and label rules
 * @module @factory/control-plane
 */
import { Controller, Get, Header, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { MetricsHandle } from "@factory/observability";

/** DI token for the MetricsHandle provider. */
export const METRICS_HANDLE = Symbol("METRICS_HANDLE");

/**
 * Serves the Prometheus /metrics endpoint.
 *
 * Returns all registered metrics in Prometheus text exposition format.
 * If the metrics subsystem has not been initialized, responds with
 * 503 Service Unavailable.
 */
@ApiTags("observability")
@Controller()
export class MetricsController {
  constructor(@Inject(METRICS_HANDLE) private readonly metricsHandle: MetricsHandle) {}

  /**
   * Returns all registered Prometheus metrics in text format.
   *
   * @returns Prometheus-formatted text output with HELP, TYPE, and metric lines.
   * @throws {ServiceUnavailableException} If the metrics subsystem is not initialized.
   */
  @Get("metrics")
  @ApiOperation({
    summary: "Prometheus metrics",
    description: "Returns all registered metrics in Prometheus text exposition format.",
  })
  @ApiResponse({ status: 200, description: "Prometheus metrics output." })
  @ApiResponse({ status: 503, description: "Metrics subsystem not initialized." })
  @ApiProduces("text/plain")
  @Header("Cache-Control", "no-store")
  async getMetrics(): Promise<string> {
    if (!this.metricsHandle) {
      throw new ServiceUnavailableException("Metrics subsystem not initialized.");
    }

    return this.metricsHandle.getMetricsOutput();
  }
}
