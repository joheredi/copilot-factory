/**
 * Tests for the config controller.
 *
 * Verifies HTTP-layer behavior by mocking the {@link ConfigService}.
 * Ensures the effective config endpoint delegates to the service
 * and returns the resolved configuration response.
 *
 * @module @factory/control-plane
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ConfigController } from "./config.controller.js";
import type { ConfigService, EffectiveConfigResponse } from "./config.service.js";

/** Factory for a fake effective config response. */
function fakeEffectiveConfig(): EffectiveConfigResponse {
  return {
    config: {
      command_policy: {} as never,
      file_scope_policy: {} as never,
      validation_policy: {} as never,
      retry_policy: {} as never,
      escalation_policy: {} as never,
      lease_policy: {} as never,
      retention_policy: {} as never,
      review_policy: {} as never,
    },
    sources: {
      command_policy: {} as never,
      file_scope_policy: {} as never,
      validation_policy: {} as never,
      retry_policy: {} as never,
      escalation_policy: {} as never,
      lease_policy: {} as never,
      retention_policy: {} as never,
      review_policy: {} as never,
    },
    layerCount: 1,
  };
}

describe("ConfigController", () => {
  let controller: ConfigController;
  let service: { resolveEffective: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    service = { resolveEffective: vi.fn() };
    controller = new ConfigController(service as unknown as ConfigService);
  });

  /**
   * Validates that getEffective delegates to the service and returns
   * the resolved configuration. This is the primary endpoint for
   * operators to inspect active configuration.
   */
  it("should delegate to service and return effective config", () => {
    const serviceResponse = fakeEffectiveConfig();
    service.resolveEffective.mockReturnValue(serviceResponse);

    const result = controller.getEffective();

    expect(service.resolveEffective).toHaveBeenCalled();
    // Controller maps { config, sources, layerCount } → { effective, layers }
    expect(result.effective).toEqual(serviceResponse.config);
    expect(result.layers).toHaveLength(Object.keys(serviceResponse.sources).length);
  });
});
