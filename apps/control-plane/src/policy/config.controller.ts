/**
 * REST controller for effective configuration resolution.
 *
 * Exposes an endpoint that resolves the hierarchical 8-layer
 * configuration and returns the fully merged values with field-level
 * source tracking showing which layer provided each setting.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T085-api-audit-policy-config.md}
 */
import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import { ConfigService } from "./config.service.js";
import type { EffectiveConfigResponse } from "./config.service.js";

/**
 * Handles HTTP requests for configuration resolution.
 *
 * Provides an endpoint to inspect the effective configuration that
 * would be applied to a worker run. Useful for operators to verify
 * what policies are active and which configuration layer provides
 * each setting.
 */
@ApiTags("config")
@Controller("config")
export class ConfigController {
  /** @param configService Injected config resolution service. */
  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

  /**
   * Get the effective resolved configuration.
   *
   * Returns the fully merged configuration with source tracking
   * showing which layer provided each field value. Currently resolves
   * from system defaults; additional layers will be added as the
   * system is extended.
   *
   * @returns The resolved configuration with source metadata.
   */
  @Get("effective")
  @ApiOperation({ summary: "Get effective resolved configuration" })
  @ApiResponse({
    status: 200,
    description: "Resolved configuration with source tracking.",
  })
  getEffective(): EffectiveConfigResponse {
    return this.configService.resolveEffective();
  }
}
