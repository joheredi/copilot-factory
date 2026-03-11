/**
 * Tests for the policy snapshot generation service.
 *
 * The policy snapshot service is the critical link between the hierarchical
 * configuration system and the worker runtime. It resolves configuration
 * layers, assembles a PolicySnapshot, validates it against the Zod schema,
 * and persists it as an immutable run-level artifact. If this service
 * produces incorrect snapshots, workers operate under wrong policy —
 * potentially allowing dangerous commands or blocking legitimate operations.
 *
 * These tests verify:
 * - End-to-end snapshot generation with system defaults only
 * - Snapshot generation with custom layer overrides
 * - Schema validation catches malformed snapshots
 * - Config layer loading errors are wrapped and reported
 * - Artifact persistence is called with the validated snapshot
 * - Source tracking metadata is preserved in results
 * - Policy set ID derivation from layer sources
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.2
 */

import { describe, it, expect, vi } from "vitest";

import type { ConfigLayerEntry } from "@factory/config";
import { ConfigLayer } from "@factory/config";
import { PolicySnapshotSchema } from "@factory/schemas";
import type { PolicySnapshot } from "@factory/schemas";

import type {
  ConfigLayerLoaderPort,
  PolicySnapshotArtifactPort,
  PolicySnapshotContext,
} from "../ports/policy-snapshot.ports.js";
import {
  createPolicySnapshotService,
  PolicySnapshotValidationError,
  ConfigLayerLoadError,
} from "./policy-snapshot.service.js";
import type {
  PolicySnapshotService,
  PolicySnapshotServiceDependencies,
} from "./policy-snapshot.service.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a fake ConfigLayerLoaderPort that returns the given layers.
 */
function createFakeLoader(layers: readonly ConfigLayerEntry[] = []): ConfigLayerLoaderPort {
  return {
    loadLayers: vi.fn<(ctx: PolicySnapshotContext) => Promise<readonly ConfigLayerEntry[]>>(
      async () => layers,
    ),
  };
}

/**
 * Create a fake PolicySnapshotArtifactPort that records calls.
 */
function createFakeArtifactStore(): PolicySnapshotArtifactPort & {
  persistedSnapshots: { runId: string; snapshot: PolicySnapshot }[];
} {
  const store: { runId: string; snapshot: PolicySnapshot }[] = [];
  return {
    persistedSnapshots: store,
    persist: vi.fn<(runId: string, snapshot: PolicySnapshot) => Promise<string>>(
      async (runId, snapshot) => {
        store.push({ runId, snapshot });
        return `/artifacts/runs/${runId}/effective-policy-snapshot.json`;
      },
    ),
  };
}

/**
 * Create a configured service with optional overrides.
 */
function createTestService(overrides?: {
  loader?: ConfigLayerLoaderPort;
  artifactStore?: PolicySnapshotArtifactPort;
}): {
  service: PolicySnapshotService;
  deps: PolicySnapshotServiceDependencies;
} {
  const deps: PolicySnapshotServiceDependencies = {
    configLayerLoader: overrides?.loader ?? createFakeLoader(),
    artifactStore: overrides?.artifactStore ?? createFakeArtifactStore(),
  };
  return { service: createPolicySnapshotService(deps), deps };
}

// ---------------------------------------------------------------------------
// Tests: End-to-end snapshot generation
// ---------------------------------------------------------------------------

describe("PolicySnapshotService", () => {
  describe("generatePolicySnapshot — system defaults only", () => {
    /**
     * When no custom layers are loaded, the snapshot should contain
     * the system default values for all 8 sub-policies. This is the
     * baseline behavior — the resolver always starts from system defaults
     * and the snapshot must be complete even with no overrides.
     */
    it("should generate a valid snapshot from system defaults", async () => {
      const { service } = createTestService();

      const result = await service.generatePolicySnapshot("task-001", "pool-default", "run-abc");

      // Snapshot must validate against the Zod schema
      const parseResult = PolicySnapshotSchema.safeParse(result.snapshot);
      expect(parseResult.success).toBe(true);

      // All 8 sub-policies must be present
      expect(result.snapshot.policy_snapshot_version).toBe("1.0");
      expect(result.snapshot.command_policy).toBeDefined();
      expect(result.snapshot.file_scope_policy).toBeDefined();
      expect(result.snapshot.validation_policy).toBeDefined();
      expect(result.snapshot.retry_policy).toBeDefined();
      expect(result.snapshot.escalation_policy).toBeDefined();
      expect(result.snapshot.lease_policy).toBeDefined();
      expect(result.snapshot.retention_policy).toBeDefined();
      expect(result.snapshot.review_policy).toBeDefined();
    });

    /**
     * With no custom layers, the policy set ID should fall back to
     * "system-defaults" since there is no higher-precedence source.
     */
    it("should use system-defaults as policy_set_id when no layers loaded", async () => {
      const { service } = createTestService();

      const result = await service.generatePolicySnapshot("task-001", "pool-default", "run-abc");

      expect(result.snapshot.policy_set_id).toBe("system-defaults");
    });

    /**
     * The layer count should be 0 when no custom layers are loaded
     * (system defaults are applied automatically by the resolver).
     */
    it("should report layerCount of 0 when no custom layers", async () => {
      const { service } = createTestService();

      const result = await service.generatePolicySnapshot("task-001", "pool-default", "run-abc");

      expect(result.layerCount).toBe(0);
    });

    /**
     * The command policy in the snapshot should reflect system default
     * values: allowlist mode with shell operators disabled.
     */
    it("should include system default command policy values", async () => {
      const { service } = createTestService();

      const result = await service.generatePolicySnapshot("task-001", "pool-default", "run-abc");

      const cmdPolicy = result.snapshot.command_policy!;
      expect(cmdPolicy.mode).toBe("allowlist");
      expect(cmdPolicy.allow_shell_compound_commands).toBe(false);
      expect(cmdPolicy.allowed_commands.length).toBeGreaterThan(0);
      expect(cmdPolicy.denied_patterns.length).toBeGreaterThan(0);
    });

    /**
     * The retry policy in the snapshot should match system defaults:
     * exponential backoff with 2 max attempts.
     */
    it("should include system default retry policy values", async () => {
      const { service } = createTestService();

      const result = await service.generatePolicySnapshot("task-001", "pool-default", "run-abc");

      const retryPolicy = result.snapshot.retry_policy!;
      expect(retryPolicy.max_attempts).toBe(2);
      expect(retryPolicy.backoff_strategy).toBe("exponential");
      expect(retryPolicy.initial_backoff_seconds).toBe(60);
    });
  });

  // -------------------------------------------------------------------------
  // Tests: Custom layer overrides
  // -------------------------------------------------------------------------

  describe("generatePolicySnapshot — with custom layers", () => {
    /**
     * Overrides from custom layers must be reflected in the snapshot.
     * This tests the core hierarchical resolution: an organization-level
     * override should change the corresponding snapshot field.
     */
    it("should apply organization-level retry policy override", async () => {
      const orgLayers: ConfigLayerEntry[] = [
        {
          layer: ConfigLayer.ORGANIZATION,
          source: "project:my-project",
          config: {
            retry_policy: {
              max_attempts: 5,
              initial_backoff_seconds: 120,
            },
          },
        },
      ];

      const { service } = createTestService({
        loader: createFakeLoader(orgLayers),
      });

      const result = await service.generatePolicySnapshot("task-001", "pool-default", "run-abc");

      expect(result.snapshot.retry_policy!.max_attempts).toBe(5);
      expect(result.snapshot.retry_policy!.initial_backoff_seconds).toBe(120);
      // Other retry fields should remain at system defaults
      expect(result.snapshot.retry_policy!.backoff_strategy).toBe("exponential");
    });

    /**
     * The policy_set_id should be derived from the highest-precedence
     * layer's source identifier.
     */
    it("should derive policy_set_id from highest-precedence layer source", async () => {
      const layers: ConfigLayerEntry[] = [
        {
          layer: ConfigLayer.ORGANIZATION,
          source: "project:alpha",
          config: { retry_policy: { max_attempts: 3 } },
        },
        {
          layer: ConfigLayer.TASK,
          source: "task:task-42",
          config: { lease_policy: { lease_ttl_seconds: 3600 } },
        },
      ];

      const { service } = createTestService({
        loader: createFakeLoader(layers),
      });

      const result = await service.generatePolicySnapshot("task-42", "pool-default", "run-xyz");

      // Highest precedence source should win
      expect(result.snapshot.policy_set_id).toBe("task:task-42");
    });

    /**
     * The layer count should reflect how many custom layers were loaded.
     */
    it("should report correct layerCount with multiple layers", async () => {
      const layers: ConfigLayerEntry[] = [
        {
          layer: ConfigLayer.ENVIRONMENT,
          source: "env:development",
          config: {},
        },
        {
          layer: ConfigLayer.ORGANIZATION,
          source: "project:beta",
          config: { retention_policy: { artifact_retention_days: 60 } },
        },
        {
          layer: ConfigLayer.POOL,
          source: "pool:gpu-pool",
          config: { lease_policy: { lease_ttl_seconds: 7200 } },
        },
      ];

      const { service } = createTestService({
        loader: createFakeLoader(layers),
      });

      const result = await service.generatePolicySnapshot("task-001", "gpu-pool", "run-123");

      expect(result.layerCount).toBe(3);
    });

    /**
     * Lease policy overrides should correctly appear in the snapshot.
     */
    it("should apply lease policy override from pool layer", async () => {
      const layers: ConfigLayerEntry[] = [
        {
          layer: ConfigLayer.POOL,
          source: "pool:long-running",
          config: {
            lease_policy: {
              lease_ttl_seconds: 7200,
              heartbeat_interval_seconds: 60,
            },
          },
        },
      ];

      const { service } = createTestService({
        loader: createFakeLoader(layers),
      });

      const result = await service.generatePolicySnapshot("task-001", "long-running", "run-456");

      expect(result.snapshot.lease_policy!.lease_ttl_seconds).toBe(7200);
      expect(result.snapshot.lease_policy!.heartbeat_interval_seconds).toBe(60);
    });
  });

  // -------------------------------------------------------------------------
  // Tests: Source tracking
  // -------------------------------------------------------------------------

  describe("generatePolicySnapshot — source tracking", () => {
    /**
     * The resolvedConfig and fieldSources should be included in the
     * result for audit logging and debugging. With only system defaults,
     * all sources should point to the system layer.
     */
    it("should include resolvedConfig in result", async () => {
      const { service } = createTestService();

      const result = await service.generatePolicySnapshot("task-001", "pool-default", "run-abc");

      expect(result.resolvedConfig).toBeDefined();
      expect(result.resolvedConfig.command_policy).toBeDefined();
      expect(result.resolvedConfig.command_policy.value).toBeDefined();
      expect(result.resolvedConfig.command_policy.fieldSources).toBeDefined();
    });

    /**
     * The fieldSources should map all policy names to their source tracking.
     */
    it("should include fieldSources for all 8 policies", async () => {
      const { service } = createTestService();

      const result = await service.generatePolicySnapshot("task-001", "pool-default", "run-abc");

      const expectedPolicies = [
        "command_policy",
        "file_scope_policy",
        "validation_policy",
        "retry_policy",
        "escalation_policy",
        "lease_policy",
        "retention_policy",
        "review_policy",
      ];

      for (const policy of expectedPolicies) {
        expect(result.fieldSources).toHaveProperty(policy);
      }
    });

    /**
     * When an override is applied, the field source should reflect
     * the overriding layer, not the system default.
     */
    it("should track override source in fieldSources", async () => {
      const layers: ConfigLayerEntry[] = [
        {
          layer: ConfigLayer.ORGANIZATION,
          source: "project:my-project",
          config: {
            retry_policy: { max_attempts: 5 },
          },
        },
      ];

      const { service } = createTestService({
        loader: createFakeLoader(layers),
      });

      const result = await service.generatePolicySnapshot("task-001", "pool-default", "run-abc");

      // max_attempts was overridden by the organization layer
      const retryFieldSources = result.resolvedConfig.retry_policy.fieldSources;
      expect(retryFieldSources.max_attempts.layer).toBe("organization");
      expect(retryFieldSources.max_attempts.source).toBe("project:my-project");

      // backoff_strategy was NOT overridden, should remain system
      expect(retryFieldSources.backoff_strategy.layer).toBe("system");
    });
  });

  // -------------------------------------------------------------------------
  // Tests: Artifact persistence
  // -------------------------------------------------------------------------

  describe("generatePolicySnapshot — artifact persistence", () => {
    /**
     * The service must persist the snapshot via the artifact port.
     * If persistence fails, the entire operation should fail — we
     * cannot have a "generated" snapshot that isn't actually stored.
     */
    it("should persist the snapshot and return the artifact path", async () => {
      const artifactStore = createFakeArtifactStore();
      const { service } = createTestService({ artifactStore });

      const result = await service.generatePolicySnapshot(
        "task-001",
        "pool-default",
        "run-persist-test",
      );

      expect(result.artifactPath).toBe(
        "/artifacts/runs/run-persist-test/effective-policy-snapshot.json",
      );
      expect(artifactStore.persistedSnapshots).toHaveLength(1);
      expect(artifactStore.persistedSnapshots[0]!.runId).toBe("run-persist-test");
    });

    /**
     * The persisted snapshot should be the validated (schema-verified) version.
     */
    it("should persist the schema-validated snapshot", async () => {
      const artifactStore = createFakeArtifactStore();
      const { service } = createTestService({ artifactStore });

      await service.generatePolicySnapshot("task-001", "pool-default", "run-validated");

      const persisted = artifactStore.persistedSnapshots[0]!.snapshot;
      const parseResult = PolicySnapshotSchema.safeParse(persisted);
      expect(parseResult.success).toBe(true);
    });

    /**
     * The loader should receive the correct context with taskId, poolId, runId.
     */
    it("should pass correct context to the config layer loader", async () => {
      const loader = createFakeLoader();
      const { service } = createTestService({ loader });

      await service.generatePolicySnapshot("task-42", "pool-gpu", "run-789");

      expect(loader.loadLayers).toHaveBeenCalledWith({
        taskId: "task-42",
        poolId: "pool-gpu",
        runId: "run-789",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Tests: Error handling
  // -------------------------------------------------------------------------

  describe("generatePolicySnapshot — error handling", () => {
    /**
     * When the config layer loader throws, the error should be wrapped
     * in a ConfigLayerLoadError with the original context and cause.
     * This provides clear diagnostics for operators.
     */
    it("should wrap loader errors in ConfigLayerLoadError", async () => {
      const failingLoader: ConfigLayerLoaderPort = {
        loadLayers: async () => {
          throw new Error("Database connection failed");
        },
      };
      const { service } = createTestService({ loader: failingLoader });

      await expect(
        service.generatePolicySnapshot("task-001", "pool-default", "run-err"),
      ).rejects.toThrow(ConfigLayerLoadError);

      try {
        await service.generatePolicySnapshot("task-001", "pool-default", "run-err");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigLayerLoadError);
        const cle = err as ConfigLayerLoadError;
        expect(cle.context.taskId).toBe("task-001");
        expect(cle.context.poolId).toBe("pool-default");
        expect(cle.context.runId).toBe("run-err");
        expect(cle.message).toContain("Database connection failed");
      }
    });

    /**
     * When artifact persistence fails, the error should propagate
     * directly (not wrapped). The snapshot was generated correctly
     * but could not be stored.
     */
    it("should propagate artifact persistence errors", async () => {
      const failingStore: PolicySnapshotArtifactPort = {
        persist: async () => {
          throw new Error("Disk full");
        },
      };
      const { service } = createTestService({ artifactStore: failingStore });

      await expect(
        service.generatePolicySnapshot("task-001", "pool-default", "run-err"),
      ).rejects.toThrow("Disk full");
    });
  });

  // -------------------------------------------------------------------------
  // Tests: Snapshot immutability and structure
  // -------------------------------------------------------------------------

  describe("snapshot structure and immutability", () => {
    /**
     * The snapshot version must always be "1.0" for V1.
     */
    it("should always set policy_snapshot_version to 1.0", async () => {
      const { service } = createTestService();

      const result = await service.generatePolicySnapshot("task-001", "pool-default", "run-abc");

      expect(result.snapshot.policy_snapshot_version).toBe("1.0");
    });

    /**
     * The command policy in the snapshot should correctly map domain
     * types to schema types — specifically arg_prefixes → allowed_args_prefixes
     * and DeniedPattern → string patterns.
     */
    it("should correctly map domain command policy to schema format", async () => {
      const { service } = createTestService();

      const result = await service.generatePolicySnapshot("task-001", "pool-default", "run-abc");

      const cmdPolicy = result.snapshot.command_policy!;

      // Each allowed command should have the schema field name
      for (const cmd of cmdPolicy.allowed_commands) {
        expect(cmd).toHaveProperty("command");
        expect(cmd).toHaveProperty("allowed_args_prefixes");
        expect(Array.isArray(cmd.allowed_args_prefixes)).toBe(true);
      }

      // Denied patterns should be plain strings (not objects)
      for (const pattern of cmdPolicy.denied_patterns) {
        expect(typeof pattern).toBe("string");
      }

      // Forbidden arg patterns should be plain strings
      for (const pattern of cmdPolicy.forbidden_arg_patterns) {
        expect(typeof pattern).toBe("string");
      }
    });

    /**
     * The file scope policy should preserve all root arrays from the
     * resolved configuration.
     */
    it("should include file scope policy with root arrays", async () => {
      const { service } = createTestService();

      const result = await service.generatePolicySnapshot("task-001", "pool-default", "run-abc");

      const fsPolicy = result.snapshot.file_scope_policy!;
      expect(Array.isArray(fsPolicy.read_roots)).toBe(true);
      expect(Array.isArray(fsPolicy.write_roots)).toBe(true);
      expect(Array.isArray(fsPolicy.deny_roots)).toBe(true);
      expect(typeof fsPolicy.allow_read_outside_scope).toBe("boolean");
      expect(typeof fsPolicy.allow_write_outside_scope).toBe("boolean");
    });

    /**
     * The validation policy should include named profiles with check
     * definitions and commands.
     */
    it("should include validation profiles in snapshot", async () => {
      const { service } = createTestService();

      const result = await service.generatePolicySnapshot("task-001", "pool-default", "run-abc");

      const valPolicy = result.snapshot.validation_policy!;
      expect(valPolicy.profiles).toBeDefined();
      const profileNames = Object.keys(valPolicy.profiles);
      expect(profileNames.length).toBeGreaterThan(0);

      // Each profile should have the expected structure
      for (const name of profileNames) {
        const profile = valPolicy.profiles[name]!;
        expect(Array.isArray(profile.required_checks)).toBe(true);
        expect(Array.isArray(profile.optional_checks)).toBe(true);
        expect(typeof profile.commands).toBe("object");
        expect(typeof profile.fail_on_skipped_required_check).toBe("boolean");
      }
    });

    /**
     * The review policy should include reviewer type arrays.
     */
    it("should include review policy with reviewer types", async () => {
      const { service } = createTestService();

      const result = await service.generatePolicySnapshot("task-001", "pool-default", "run-abc");

      const reviewPolicy = result.snapshot.review_policy!;
      expect(reviewPolicy.max_review_rounds).toBeGreaterThan(0);
      expect(Array.isArray(reviewPolicy.required_reviewer_types)).toBe(true);
      expect(Array.isArray(reviewPolicy.optional_reviewer_types)).toBe(true);
      expect(typeof reviewPolicy.lead_reviewer_required).toBe("boolean");
    });

    /**
     * Generating two snapshots for the same context should produce
     * structurally identical results (deterministic resolution).
     */
    it("should produce deterministic snapshots for the same context", async () => {
      const { service } = createTestService();

      const result1 = await service.generatePolicySnapshot("task-001", "pool-default", "run-a");
      const result2 = await service.generatePolicySnapshot("task-001", "pool-default", "run-b");

      // Snapshots should be structurally identical (except persistence paths)
      expect(result1.snapshot.policy_snapshot_version).toBe(
        result2.snapshot.policy_snapshot_version,
      );
      expect(result1.snapshot.command_policy).toEqual(result2.snapshot.command_policy);
      expect(result1.snapshot.retry_policy).toEqual(result2.snapshot.retry_policy);
      expect(result1.snapshot.lease_policy).toEqual(result2.snapshot.lease_policy);
    });
  });

  // -------------------------------------------------------------------------
  // Tests: Error class behavior
  // -------------------------------------------------------------------------

  describe("PolicySnapshotValidationError", () => {
    /**
     * The error should include the Zod issues and a human-readable message.
     */
    it("should format issues into a readable message", () => {
      const error = new PolicySnapshotValidationError([
        { path: ["command_policy", "mode"], message: "Required" },
        { path: ["policy_set_id"], message: "must not be empty" },
      ]);

      expect(error.name).toBe("PolicySnapshotValidationError");
      expect(error.issues).toHaveLength(2);
      expect(error.message).toContain("command_policy.mode: Required");
      expect(error.message).toContain("policy_set_id: must not be empty");
    });
  });

  describe("ConfigLayerLoadError", () => {
    /**
     * The error should include the context and underlying cause.
     */
    it("should include context and cause in message", () => {
      const cause = new Error("connection refused");
      const context: PolicySnapshotContext = {
        taskId: "task-99",
        poolId: "pool-fast",
        runId: "run-xyz",
      };
      const error = new ConfigLayerLoadError(context, cause);

      expect(error.name).toBe("ConfigLayerLoadError");
      expect(error.context).toBe(context);
      expect(error.message).toContain("task=task-99");
      expect(error.message).toContain("pool=pool-fast");
      expect(error.message).toContain("run=run-xyz");
      expect(error.message).toContain("connection refused");
    });

    /**
     * Should handle non-Error causes gracefully.
     */
    it("should handle string cause", () => {
      const context: PolicySnapshotContext = {
        taskId: "t",
        poolId: "p",
        runId: "r",
      };
      const error = new ConfigLayerLoadError(context, "something broke");

      expect(error.message).toContain("something broke");
    });
  });
});
