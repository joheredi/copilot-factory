/**
 * Health check controller for the control-plane service.
 *
 * Provides a GET /health endpoint used for liveness probes and
 * basic connectivity verification. Returns the service status
 * and current server timestamp.
 *
 * @module @factory/control-plane
 */
import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

/** Shape of the health check response body. */
export interface HealthResponse {
  /** Service status indicator. */
  status: "ok";
  /** Service name for identification. */
  service: string;
  /** ISO 8601 timestamp of when the health check was performed. */
  timestamp: string;
}

/**
 * Handles health check requests.
 *
 * The health endpoint is intentionally simple — it confirms the
 * HTTP server is running and responsive. Database and downstream
 * dependency checks will be added in future iterations.
 */
@ApiTags("health")
@Controller()
export class HealthController {
  /**
   * Returns the current health status of the control-plane service.
   *
   * @returns A {@link HealthResponse} with status "ok" and the current timestamp.
   */
  @Get("health")
  @ApiOperation({ summary: "Health check", description: "Returns service health status." })
  @ApiResponse({ status: 200, description: "Service is healthy." })
  getHealth(): HealthResponse {
    return {
      status: "ok",
      service: "factory-control-plane",
      timestamp: new Date().toISOString(),
    };
  }
}
