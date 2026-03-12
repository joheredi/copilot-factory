/**
 * Tests for the config service.
 *
 * Verifies effective configuration resolution using the hierarchical
 * precedence model from `@factory/config`. Tests validate that system
 * defaults are correctly resolved and that source tracking is present.
 *
 * @module @factory/control-plane
 */
import { describe, expect, it } from "vitest";

import { ConfigService } from "./config.service.js";

describe("ConfigService", () => {
  const service = new ConfigService();

  /**
   * Validates that resolveEffective returns a complete configuration
   * from system defaults when no additional layers are provided.
   * This is the baseline behavior — the system always has defaults.
   */
  it("should resolve effective config from system defaults", () => {
    const result = service.resolveEffective();

    expect(result.config).toBeDefined();
    expect(result.sources).toBeDefined();
    expect(result.layerCount).toBe(1); // system defaults only
  });

  /**
   * Validates that the resolved config contains all 8 sub-policy
   * categories defined in the FactoryConfig type.
   */
  it("should include all 8 sub-policy categories", () => {
    const result = service.resolveEffective();
    const config = result.config;

    expect(config.command_policy).toBeDefined();
    expect(config.file_scope_policy).toBeDefined();
    expect(config.validation_policy).toBeDefined();
    expect(config.retry_policy).toBeDefined();
    expect(config.escalation_policy).toBeDefined();
    expect(config.lease_policy).toBeDefined();
    expect(config.retention_policy).toBeDefined();
    expect(config.review_policy).toBeDefined();
  });

  /**
   * Validates that source tracking records are present for all
   * policy categories. Source tracking is critical for operators
   * to understand which layer provided each configuration value.
   */
  it("should include source tracking for all policies", () => {
    const result = service.resolveEffective();
    const sources = result.sources;

    expect(sources.command_policy).toBeDefined();
    expect(sources.file_scope_policy).toBeDefined();
    expect(sources.validation_policy).toBeDefined();
    expect(sources.retry_policy).toBeDefined();
    expect(sources.escalation_policy).toBeDefined();
    expect(sources.lease_policy).toBeDefined();
    expect(sources.retention_policy).toBeDefined();
    expect(sources.review_policy).toBeDefined();
  });

  /**
   * Validates that additional layers increase the layer count.
   * When custom layers are provided, they should be applied on top
   * of system defaults.
   */
  it("should accept additional layers and increase layer count", () => {
    const result = service.resolveEffective([
      {
        layer: "environment",
        source: "test-environment",
        config: {},
      },
    ]);

    expect(result.layerCount).toBe(2); // system defaults + environment
  });
});
