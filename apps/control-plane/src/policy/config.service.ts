/**
 * Service layer for effective configuration resolution.
 *
 * Resolves the hierarchical configuration using the 8-layer precedence
 * model from the `@factory/config` package. Returns the fully merged
 * configuration with field-level source tracking for debugging and
 * auditing which layer provided each value.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T085-api-audit-policy-config.md}
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12
 */
import { Injectable } from "@nestjs/common";
import {
  resolveConfig,
  extractValues,
  extractSources,
  SYSTEM_DEFAULTS,
  type FactoryConfig,
  type ConfigLayerEntry,
  type PolicyName,
  type FieldSourceMap,
} from "@factory/config";

/** Response shape for the effective configuration endpoint. */
export interface EffectiveConfigResponse {
  /** The fully resolved configuration values. */
  config: FactoryConfig;
  /**
   * Field-level source tracking showing which layer provided each value.
   * Keyed by policy name, with each field mapping to its source layer.
   */
  sources: Record<PolicyName, FieldSourceMap<Record<string, unknown>>>;
  /** Number of configuration layers that were applied. */
  layerCount: number;
}

/**
 * Resolves effective configuration using the hierarchical precedence model.
 *
 * Currently resolves from system defaults. As the system grows, additional
 * layers (environment, organization, pool, task-type, task, operator
 * overrides) can be loaded from the database and applied.
 */
@Injectable()
export class ConfigService {
  /**
   * Resolve the effective configuration.
   *
   * Applies the 8-layer hierarchical resolution from lowest to highest
   * precedence: system → environment → organization → repository_workflow
   * → pool → task_type → task → operator_override.
   *
   * Currently only the system defaults layer is active. Additional
   * layers will be loaded from PolicySet records and other sources
   * as the system is extended.
   *
   * @param layers Optional additional configuration layers to apply
   *               on top of system defaults. If not provided, only
   *               system defaults are resolved.
   * @returns The resolved configuration with source tracking.
   */
  resolveEffective(layers: readonly ConfigLayerEntry[] = []): EffectiveConfigResponse {
    const resolved = resolveConfig(layers, SYSTEM_DEFAULTS);
    const config = extractValues(resolved);
    const sources = extractSources(resolved);

    return {
      config,
      sources,
      layerCount: layers.length + 1, // +1 for system defaults
    };
  }
}
