/**
 * Tests for the hierarchical configuration resolver.
 *
 * These tests validate the 8-layer configuration precedence model from PRD §9.12,
 * ensuring that:
 * - System defaults provide a complete baseline
 * - Higher-precedence layers override lower ones correctly
 * - Field-level source tracking is accurate
 * - Missing layers are gracefully skipped
 * - Layer ordering is enforced
 * - All 8 sub-policies can be independently overridden
 *
 * @module @factory/config/resolver.test
 */

import { describe, it, expect } from "vitest";
import {
  resolveConfig,
  extractValues,
  extractSources,
  ConfigLayer,
  SYSTEM_DEFAULTS,
  POLICY_NAMES,
  DEFAULT_COMMAND_POLICY,
  DEFAULT_LEASE_POLICY,
  DEFAULT_RETRY_POLICY,
  DEFAULT_REVIEW_POLICY,
  DEFAULT_RETENTION_POLICY,
  DEFAULT_ESCALATION_POLICY,
  DEFAULT_VALIDATION_POLICY,
  DEFAULT_FILE_SCOPE_POLICY,
} from "./index.js";
import type { ConfigLayerEntry, FactoryConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeLayer(
  layer: ConfigLayerEntry["layer"],
  source: string,
  config: ConfigLayerEntry["config"],
): ConfigLayerEntry {
  return { layer, source, config };
}

// ---------------------------------------------------------------------------
// System defaults (baseline behavior)
// ---------------------------------------------------------------------------

describe("resolveConfig — system defaults", () => {
  /**
   * When no override layers are provided, the resolver must return the
   * system defaults for all 8 sub-policies. This is the foundation of the
   * hierarchical model — every field has a guaranteed baseline value.
   */
  it("returns system defaults when no layers are provided", () => {
    const resolved = resolveConfig([]);

    expect(resolved.command_policy.value).toEqual(DEFAULT_COMMAND_POLICY);
    expect(resolved.file_scope_policy.value).toEqual(DEFAULT_FILE_SCOPE_POLICY);
    expect(resolved.validation_policy.value).toEqual(DEFAULT_VALIDATION_POLICY);
    expect(resolved.retry_policy.value).toEqual(DEFAULT_RETRY_POLICY);
    expect(resolved.escalation_policy.value).toEqual(DEFAULT_ESCALATION_POLICY);
    expect(resolved.lease_policy.value).toEqual(DEFAULT_LEASE_POLICY);
    expect(resolved.retention_policy.value).toEqual(DEFAULT_RETENTION_POLICY);
    expect(resolved.review_policy.value).toEqual(DEFAULT_REVIEW_POLICY);
  });

  /**
   * All field sources must point to the "system" layer when no overrides
   * are applied. This ensures the source tracking is initialized correctly.
   */
  it("attributes all fields to system layer when no overrides", () => {
    const resolved = resolveConfig([]);

    for (const policyName of POLICY_NAMES) {
      const sources = resolved[policyName].fieldSources;
      for (const fieldSource of Object.values(sources)) {
        expect(fieldSource).toEqual({
          layer: ConfigLayer.SYSTEM,
          source: "system-defaults",
        });
      }
    }
  });

  /**
   * Custom system defaults can be injected for testing or non-standard
   * deployment scenarios.
   */
  it("accepts custom system defaults", () => {
    const customDefaults: FactoryConfig = {
      ...SYSTEM_DEFAULTS,
      lease_policy: {
        ...DEFAULT_LEASE_POLICY,
        lease_ttl_seconds: 7200,
      },
    };

    const resolved = resolveConfig([], customDefaults);
    expect(resolved.lease_policy.value.lease_ttl_seconds).toBe(7200);
  });
});

// ---------------------------------------------------------------------------
// Single-layer overrides
// ---------------------------------------------------------------------------

describe("resolveConfig — single layer override", () => {
  /**
   * A single organization-level override must replace only the fields
   * it specifies, leaving other fields at their system default values.
   * This validates the partial override semantics.
   */
  it("overrides specific fields from one layer", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.ORGANIZATION, "project:acme", {
        lease_policy: { lease_ttl_seconds: 3600 },
      }),
    ];

    const resolved = resolveConfig(layers);

    // Overridden field
    expect(resolved.lease_policy.value.lease_ttl_seconds).toBe(3600);
    // Non-overridden fields retain defaults
    expect(resolved.lease_policy.value.heartbeat_interval_seconds).toBe(
      DEFAULT_LEASE_POLICY.heartbeat_interval_seconds,
    );
    expect(resolved.lease_policy.value.missed_heartbeat_threshold).toBe(
      DEFAULT_LEASE_POLICY.missed_heartbeat_threshold,
    );
  });

  /**
   * Source tracking must correctly identify the override layer for
   * fields that were overridden, while non-overridden fields remain
   * attributed to the system layer.
   */
  it("tracks source for overridden vs non-overridden fields", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.ORGANIZATION, "project:acme", {
        lease_policy: { lease_ttl_seconds: 3600 },
      }),
    ];

    const resolved = resolveConfig(layers);

    // Overridden field: source is the org layer
    expect(resolved.lease_policy.fieldSources.lease_ttl_seconds).toEqual({
      layer: ConfigLayer.ORGANIZATION,
      source: "project:acme",
    });

    // Non-overridden field: source is still system
    expect(resolved.lease_policy.fieldSources.heartbeat_interval_seconds).toEqual({
      layer: ConfigLayer.SYSTEM,
      source: "system-defaults",
    });
  });

  /**
   * Policies not mentioned in the override layer must remain entirely
   * at their system default values and source tracking.
   */
  it("leaves unmentioned policies at system defaults", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.ORGANIZATION, "project:acme", {
        lease_policy: { lease_ttl_seconds: 3600 },
      }),
    ];

    const resolved = resolveConfig(layers);

    // Command policy was not overridden
    expect(resolved.command_policy.value).toEqual(DEFAULT_COMMAND_POLICY);
    expect(resolved.command_policy.fieldSources.mode).toEqual({
      layer: ConfigLayer.SYSTEM,
      source: "system-defaults",
    });
  });
});

// ---------------------------------------------------------------------------
// Multi-layer precedence
// ---------------------------------------------------------------------------

describe("resolveConfig — multi-layer precedence", () => {
  /**
   * When multiple layers override the same field, the highest-precedence
   * layer (applied last) must win. This is the core precedence guarantee
   * from §9.12.
   */
  it("higher-precedence layer overrides lower-precedence layer", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.ORGANIZATION, "project:acme", {
        lease_policy: { lease_ttl_seconds: 3600 },
      }),
      makeLayer(ConfigLayer.TASK, "task:task-42", {
        lease_policy: { lease_ttl_seconds: 900 },
      }),
    ];

    const resolved = resolveConfig(layers);

    expect(resolved.lease_policy.value.lease_ttl_seconds).toBe(900);
    expect(resolved.lease_policy.fieldSources.lease_ttl_seconds).toEqual({
      layer: ConfigLayer.TASK,
      source: "task:task-42",
    });
  });

  /**
   * Different layers can override different fields of the same policy.
   * The final result should reflect each field's highest-precedence override.
   */
  it("combines field overrides from different layers", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.ORGANIZATION, "org:acme", {
        retry_policy: { max_attempts: 5 },
      }),
      makeLayer(ConfigLayer.POOL, "pool:gpu-workers", {
        retry_policy: { initial_backoff_seconds: 120 },
      }),
      makeLayer(ConfigLayer.TASK, "task:task-99", {
        retry_policy: { max_backoff_seconds: 1800 },
      }),
    ];

    const resolved = resolveConfig(layers);

    // Each field from its respective layer
    expect(resolved.retry_policy.value.max_attempts).toBe(5);
    expect(resolved.retry_policy.value.initial_backoff_seconds).toBe(120);
    expect(resolved.retry_policy.value.max_backoff_seconds).toBe(1800);

    // Source tracking per field
    expect(resolved.retry_policy.fieldSources.max_attempts.layer).toBe(ConfigLayer.ORGANIZATION);
    expect(resolved.retry_policy.fieldSources.initial_backoff_seconds.layer).toBe(ConfigLayer.POOL);
    expect(resolved.retry_policy.fieldSources.max_backoff_seconds.layer).toBe(ConfigLayer.TASK);

    // Non-overridden fields remain at system defaults
    expect(resolved.retry_policy.value.backoff_strategy).toBe(
      DEFAULT_RETRY_POLICY.backoff_strategy,
    );
    expect(resolved.retry_policy.fieldSources.backoff_strategy.layer).toBe(ConfigLayer.SYSTEM);
  });

  /**
   * Multiple policies can be overridden across different layers.
   * The resolver must handle cross-policy overrides independently.
   */
  it("handles cross-policy overrides from different layers", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.ORGANIZATION, "org:acme", {
        lease_policy: { lease_ttl_seconds: 3600 },
        review_policy: { max_review_rounds: 5 },
      }),
      makeLayer(ConfigLayer.REPOSITORY_WORKFLOW, "workflow:ci-cd", {
        validation_policy: {
          profiles: {
            "custom-dev": {
              required_checks: ["test"],
              optional_checks: [],
              commands: { test: "pnpm test" },
              fail_on_skipped_required_check: true,
            },
          },
        },
      }),
      makeLayer(ConfigLayer.TASK, "task:task-7", {
        retention_policy: { workspace_retention_hours: 48 },
      }),
    ];

    const resolved = resolveConfig(layers);

    expect(resolved.lease_policy.value.lease_ttl_seconds).toBe(3600);
    expect(resolved.review_policy.value.max_review_rounds).toBe(5);
    expect(resolved.validation_policy.value.profiles).toHaveProperty("custom-dev");
    expect(resolved.validation_policy.value.profiles).not.toHaveProperty("default-dev");
    expect(resolved.retention_policy.value.workspace_retention_hours).toBe(48);
  });

  /**
   * The operator override layer (highest precedence) must always win,
   * even over task-level overrides.
   */
  it("operator override has highest precedence", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.TASK, "task:task-42", {
        lease_policy: { lease_ttl_seconds: 900 },
      }),
      makeLayer(ConfigLayer.OPERATOR_OVERRIDE, "operator:alice", {
        lease_policy: { lease_ttl_seconds: 60 },
      }),
    ];

    const resolved = resolveConfig(layers);

    expect(resolved.lease_policy.value.lease_ttl_seconds).toBe(60);
    expect(resolved.lease_policy.fieldSources.lease_ttl_seconds).toEqual({
      layer: ConfigLayer.OPERATOR_OVERRIDE,
      source: "operator:alice",
    });
  });
});

// ---------------------------------------------------------------------------
// All 8 layers in sequence
// ---------------------------------------------------------------------------

describe("resolveConfig — full 8-layer stack", () => {
  /**
   * When all 8 layers provide overrides for the same field, the
   * operator override (layer 8) must be the final winner. This tests
   * the complete precedence chain.
   */
  it("applies all 8 layers in correct precedence order", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.SYSTEM, "custom-system", {
        lease_policy: { lease_ttl_seconds: 100 },
      }),
      makeLayer(ConfigLayer.ENVIRONMENT, "env:dev", {
        lease_policy: { lease_ttl_seconds: 200 },
      }),
      makeLayer(ConfigLayer.ORGANIZATION, "org:acme", {
        lease_policy: { lease_ttl_seconds: 300 },
      }),
      makeLayer(ConfigLayer.REPOSITORY_WORKFLOW, "workflow:main", {
        lease_policy: { lease_ttl_seconds: 400 },
      }),
      makeLayer(ConfigLayer.POOL, "pool:default", {
        lease_policy: { lease_ttl_seconds: 500 },
      }),
      makeLayer(ConfigLayer.TASK_TYPE, "task-type:feature", {
        lease_policy: { lease_ttl_seconds: 600 },
      }),
      makeLayer(ConfigLayer.TASK, "task:task-1", {
        lease_policy: { lease_ttl_seconds: 700 },
      }),
      makeLayer(ConfigLayer.OPERATOR_OVERRIDE, "operator:bob", {
        lease_policy: { lease_ttl_seconds: 800 },
      }),
    ];

    const resolved = resolveConfig(layers);

    expect(resolved.lease_policy.value.lease_ttl_seconds).toBe(800);
    expect(resolved.lease_policy.fieldSources.lease_ttl_seconds).toEqual({
      layer: ConfigLayer.OPERATOR_OVERRIDE,
      source: "operator:bob",
    });
  });
});

// ---------------------------------------------------------------------------
// Skipped layers
// ---------------------------------------------------------------------------

describe("resolveConfig — skipped layers", () => {
  /**
   * Missing layers in the middle of the precedence chain must be
   * gracefully skipped. Only provided layers should affect the result.
   */
  it("skips missing layers gracefully", () => {
    const layers: ConfigLayerEntry[] = [
      // Skip environment, organization, repository_workflow, pool, task_type
      makeLayer(ConfigLayer.TASK, "task:task-42", {
        lease_policy: { lease_ttl_seconds: 1200 },
      }),
    ];

    const resolved = resolveConfig(layers);

    expect(resolved.lease_policy.value.lease_ttl_seconds).toBe(1200);
    // Non-overridden fields still at system defaults
    expect(resolved.lease_policy.value.heartbeat_interval_seconds).toBe(30);
  });

  /**
   * Layers with empty config objects should have no effect on the
   * resolved values or source tracking.
   */
  it("handles layers with empty config", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.ORGANIZATION, "org:empty", {}),
      makeLayer(ConfigLayer.TASK, "task:real", {
        lease_policy: { lease_ttl_seconds: 1500 },
      }),
    ];

    const resolved = resolveConfig(layers);

    expect(resolved.lease_policy.value.lease_ttl_seconds).toBe(1500);
    expect(resolved.lease_policy.fieldSources.lease_ttl_seconds.layer).toBe(ConfigLayer.TASK);
  });
});

// ---------------------------------------------------------------------------
// Array field replacement (wholesale, not merged)
// ---------------------------------------------------------------------------

describe("resolveConfig — array field replacement", () => {
  /**
   * Array fields must be replaced wholesale, not merged or concatenated.
   * This is a critical semantic: if a layer overrides allowed_commands,
   * the entire list is replaced, allowing removal of inherited entries.
   */
  it("replaces command policy allowed_commands wholesale", () => {
    const customCommands = [{ command: "cargo", arg_prefixes: ["build", "test"] }];

    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.ORGANIZATION, "org:rust-shop", {
        command_policy: { allowed_commands: customCommands },
      }),
    ];

    const resolved = resolveConfig(layers);

    expect(resolved.command_policy.value.allowed_commands).toEqual(customCommands);
    expect(resolved.command_policy.value.allowed_commands).not.toEqual(
      DEFAULT_COMMAND_POLICY.allowed_commands,
    );
  });

  /**
   * Review policy array fields (reviewer types) must also be replaced
   * wholesale when overridden.
   */
  it("replaces review policy reviewer types wholesale", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.REPOSITORY_WORKFLOW, "workflow:security-first", {
        review_policy: {
          required_reviewer_types: ["security", "general"],
          optional_reviewer_types: [],
        },
      }),
    ];

    const resolved = resolveConfig(layers);

    expect(resolved.review_policy.value.required_reviewer_types).toEqual(["security", "general"]);
    expect(resolved.review_policy.value.optional_reviewer_types).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Each policy type can be individually overridden
// ---------------------------------------------------------------------------

describe("resolveConfig — individual policy overrides", () => {
  /**
   * Each of the 8 sub-policies must be independently overridable.
   * This test ensures the resolver dispatch works for every policy type.
   */
  it("overrides command_policy", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.TASK, "task:t1", {
        command_policy: { allow_shell_operators: true },
      }),
    ];
    const resolved = resolveConfig(layers);
    expect(resolved.command_policy.value.allow_shell_operators).toBe(true);
  });

  it("overrides file_scope_policy", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.TASK, "task:t1", {
        file_scope_policy: { write_roots: ["src/"] },
      }),
    ];
    const resolved = resolveConfig(layers);
    expect(resolved.file_scope_policy.value.write_roots).toEqual(["src/"]);
  });

  it("overrides validation_policy", () => {
    const customProfiles = {
      "fast-check": {
        required_checks: ["lint"],
        optional_checks: [],
        commands: { lint: "pnpm lint" },
        fail_on_skipped_required_check: false,
      },
    };
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.TASK, "task:t1", {
        validation_policy: { profiles: customProfiles },
      }),
    ];
    const resolved = resolveConfig(layers);
    expect(resolved.validation_policy.value.profiles).toEqual(customProfiles);
  });

  it("overrides retry_policy", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.TASK, "task:t1", {
        retry_policy: { max_attempts: 10 },
      }),
    ];
    const resolved = resolveConfig(layers);
    expect(resolved.retry_policy.value.max_attempts).toBe(10);
  });

  it("overrides escalation_policy", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.TASK, "task:t1", {
        escalation_policy: { route_to: "critical-ops" },
      }),
    ];
    const resolved = resolveConfig(layers);
    expect(resolved.escalation_policy.value.route_to).toBe("critical-ops");
  });

  it("overrides lease_policy", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.TASK, "task:t1", {
        lease_policy: { grace_period_seconds: 60 },
      }),
    ];
    const resolved = resolveConfig(layers);
    expect(resolved.lease_policy.value.grace_period_seconds).toBe(60);
  });

  it("overrides retention_policy", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.TASK, "task:t1", {
        retention_policy: { artifact_retention_days: 90 },
      }),
    ];
    const resolved = resolveConfig(layers);
    expect(resolved.retention_policy.value.artifact_retention_days).toBe(90);
  });

  it("overrides review_policy", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.TASK, "task:t1", {
        review_policy: { lead_reviewer_required: false },
      }),
    ];
    const resolved = resolveConfig(layers);
    expect(resolved.review_policy.value.lead_reviewer_required).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Layer ordering validation
// ---------------------------------------------------------------------------

describe("resolveConfig — layer ordering enforcement", () => {
  /**
   * Layers must be in non-decreasing precedence order. Providing a
   * higher-precedence layer before a lower-precedence one is a
   * programming error that must be caught.
   */
  it("throws when layers are in wrong order", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.TASK, "task:t1", {}),
      makeLayer(ConfigLayer.ORGANIZATION, "org:acme", {}),
    ];

    expect(() => resolveConfig(layers)).toThrow(
      /layers must be in non-decreasing precedence order/i,
    );
  });

  /**
   * Multiple entries at the same precedence level are allowed.
   * This supports scenarios where multiple sources contribute
   * at the same layer (e.g., multiple pool configurations).
   */
  it("allows multiple entries at the same precedence level", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.POOL, "pool:general", {
        lease_policy: { lease_ttl_seconds: 1000 },
      }),
      makeLayer(ConfigLayer.POOL, "pool:specific", {
        lease_policy: { lease_ttl_seconds: 2000 },
      }),
    ];

    // Should not throw
    const resolved = resolveConfig(layers);
    // Later entry at same level wins
    expect(resolved.lease_policy.value.lease_ttl_seconds).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// extractValues utility
// ---------------------------------------------------------------------------

describe("extractValues", () => {
  /**
   * extractValues must produce a plain FactoryConfig without source
   * tracking, suitable for creating PolicySnapshot objects for
   * worker dispatch.
   */
  it("strips source tracking from resolved config", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.ORGANIZATION, "org:acme", {
        lease_policy: { lease_ttl_seconds: 3600 },
      }),
    ];

    const resolved = resolveConfig(layers);
    const values = extractValues(resolved);

    expect(values.lease_policy.lease_ttl_seconds).toBe(3600);
    expect(values.command_policy).toEqual(DEFAULT_COMMAND_POLICY);
    // Ensure no source tracking properties leak through
    expect(values).not.toHaveProperty("command_policy.fieldSources");
  });
});

// ---------------------------------------------------------------------------
// extractSources utility
// ---------------------------------------------------------------------------

describe("extractSources", () => {
  /**
   * extractSources must provide a complete field-level source map
   * for all 8 policies, enabling audit and debugging tools to
   * display configuration provenance.
   */
  it("extracts field source maps for all policies", () => {
    const layers: ConfigLayerEntry[] = [
      makeLayer(ConfigLayer.TASK, "task:t1", {
        lease_policy: { lease_ttl_seconds: 1200 },
        retry_policy: { max_attempts: 3 },
      }),
    ];

    const resolved = resolveConfig(layers);
    const sources = extractSources(resolved);

    expect(sources.lease_policy.lease_ttl_seconds).toEqual({
      layer: ConfigLayer.TASK,
      source: "task:t1",
    });
    expect(sources.retry_policy.max_attempts).toEqual({
      layer: ConfigLayer.TASK,
      source: "task:t1",
    });
    // Non-overridden policy fields
    expect(sources.command_policy.mode).toEqual({
      layer: ConfigLayer.SYSTEM,
      source: "system-defaults",
    });
  });
});

// ---------------------------------------------------------------------------
// Realistic scenario: full stack resolution
// ---------------------------------------------------------------------------

describe("resolveConfig — realistic scenario", () => {
  /**
   * Simulates a realistic multi-layer resolution scenario where an
   * organization sets base policies, a repository workflow customizes
   * validation, a pool adjusts lease timing, and a task-level override
   * bumps retries. This validates the end-to-end resolution pipeline
   * with realistic data shapes.
   */
  it("resolves a realistic multi-layer configuration", () => {
    const layers: ConfigLayerEntry[] = [
      // Organization: relax shell operators, extend review rounds
      makeLayer(ConfigLayer.ORGANIZATION, "project:web-platform", {
        command_policy: { allow_shell_operators: true },
        review_policy: { max_review_rounds: 5 },
      }),
      // Repository workflow: custom validation profiles
      makeLayer(ConfigLayer.REPOSITORY_WORKFLOW, "workflow:ci-strict", {
        validation_policy: {
          profiles: {
            "strict-dev": {
              required_checks: ["test", "lint", "build"],
              optional_checks: [],
              commands: {
                test: "pnpm test -- --coverage",
                lint: "pnpm lint -- --max-warnings 0",
                build: "pnpm build",
              },
              fail_on_skipped_required_check: true,
            },
          },
        },
      }),
      // Pool: shorter lease for GPU workers
      makeLayer(ConfigLayer.POOL, "pool:gpu-workers", {
        lease_policy: {
          lease_ttl_seconds: 900,
          heartbeat_interval_seconds: 15,
        },
      }),
      // Task: extra retries for flaky integration test
      makeLayer(ConfigLayer.TASK, "task:integration-test-42", {
        retry_policy: { max_attempts: 5, max_backoff_seconds: 1800 },
      }),
    ];

    const resolved = resolveConfig(layers);

    // Command policy: shell operators enabled by org
    expect(resolved.command_policy.value.allow_shell_operators).toBe(true);
    expect(resolved.command_policy.fieldSources.allow_shell_operators.source).toBe(
      "project:web-platform",
    );
    // Other command fields unchanged
    expect(resolved.command_policy.value.mode).toBe("allowlist");
    expect(resolved.command_policy.fieldSources.mode.layer).toBe(ConfigLayer.SYSTEM);

    // Review: 5 rounds from org
    expect(resolved.review_policy.value.max_review_rounds).toBe(5);

    // Validation: custom profiles from workflow
    expect(resolved.validation_policy.value.profiles).toHaveProperty("strict-dev");
    expect(resolved.validation_policy.value.profiles).not.toHaveProperty("default-dev");

    // Lease: pool overrides
    expect(resolved.lease_policy.value.lease_ttl_seconds).toBe(900);
    expect(resolved.lease_policy.value.heartbeat_interval_seconds).toBe(15);
    expect(resolved.lease_policy.fieldSources.lease_ttl_seconds.source).toBe("pool:gpu-workers");

    // Retry: task-level bumps
    expect(resolved.retry_policy.value.max_attempts).toBe(5);
    expect(resolved.retry_policy.value.max_backoff_seconds).toBe(1800);
    expect(resolved.retry_policy.fieldSources.max_attempts.source).toBe("task:integration-test-42");

    // Untouched policies remain at system defaults
    expect(resolved.escalation_policy.value).toEqual(DEFAULT_ESCALATION_POLICY);
    expect(resolved.retention_policy.value).toEqual(DEFAULT_RETENTION_POLICY);
    expect(resolved.file_scope_policy.value).toEqual(DEFAULT_FILE_SCOPE_POLICY);
  });
});
