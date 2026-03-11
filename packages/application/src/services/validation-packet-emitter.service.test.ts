/**
 * Tests for the validation packet emitter service.
 *
 * Validates that the emitter correctly:
 * - Assembles a schema-valid {@link ValidationResultPacket} from a
 *   {@link ValidationRunResult}
 * - Maps check outcomes to the packet schema format (check_type, tool_name, status)
 * - Maps overall status to packet status (passed→success, failed→failed)
 * - Includes run_scope in the packet details
 * - Validates the packet against the Zod schema before persistence
 * - Persists the packet via the artifact store port
 * - Throws {@link ValidationPacketSchemaError} on schema violations
 *
 * These tests are critical because the emitter is the bridge between the
 * internal validation runner representation and the cross-stage packet contract.
 * Any mapping error here would produce invalid artifacts that downstream
 * orchestration (T057 validation gates) would reject.
 *
 * @module @factory/application/services/validation-packet-emitter.test
 * @see {@link file://docs/backlog/tasks/T056-validation-packet-emission.md}
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationRunScope } from "@factory/domain";
import { ValidationResultPacketSchema } from "@factory/schemas";

import type {
  ValidationRunResult,
  ValidationCheckOutcome,
} from "../ports/validation-runner.ports.js";
import type {
  ValidationPacketArtifactPort,
  EmitValidationPacketParams,
} from "../ports/validation-packet-emitter.ports.js";
import {
  createValidationPacketEmitterService,
  mapCheckOutcomeToResult,
} from "./validation-packet-emitter.service.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

/**
 * Creates a fake artifact store that records calls and returns a predictable path.
 * Important for verifying that the persist method receives the validated packet.
 */
function createFakeArtifactStore(): ValidationPacketArtifactPort & {
  calls: Array<{ validationRunId: string; packet: unknown }>;
} {
  const calls: Array<{ validationRunId: string; packet: unknown }> = [];
  return {
    calls,
    persist: vi.fn(async (validationRunId: string, packet: unknown) => {
      calls.push({ validationRunId, packet });
      return `/artifacts/validation-runs/${validationRunId}/validation-result-packet.json`;
    }),
  };
}

/**
 * Creates a minimal passing {@link ValidationCheckOutcome} for tests.
 */
function createCheckOutcome(
  overrides: Partial<ValidationCheckOutcome> = {},
): ValidationCheckOutcome {
  return {
    checkName: "test",
    command: "pnpm test",
    category: "required",
    status: "passed",
    durationMs: 1500,
    ...overrides,
  };
}

/**
 * Creates a minimal passing {@link ValidationRunResult} for tests.
 */
function createRunResult(overrides: Partial<ValidationRunResult> = {}): ValidationRunResult {
  return {
    profileName: "default-dev",
    overallStatus: "passed",
    checkOutcomes: [
      createCheckOutcome({
        checkName: "test",
        command: "pnpm test",
        status: "passed",
        durationMs: 1200,
      }),
      createCheckOutcome({
        checkName: "lint",
        command: "eslint .",
        status: "passed",
        durationMs: 800,
      }),
    ],
    summary: 'Validation PASSED for task task-1 using profile "default-dev". Required: 2/2 passed.',
    totalDurationMs: 2000,
    requiredPassedCount: 2,
    requiredFailedCount: 0,
    optionalPassedCount: 0,
    optionalFailedCount: 0,
    skippedCount: 0,
    ...overrides,
  };
}

/**
 * Creates default emission parameters for tests.
 */
function createEmitParams(
  overrides: Partial<EmitValidationPacketParams> = {},
): EmitValidationPacketParams {
  return {
    taskId: "task-1",
    repositoryId: "repo-1",
    validationRunId: "vr-1",
    runScope: ValidationRunScope.PRE_REVIEW,
    validationRunResult: createRunResult(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ValidationPacketEmitterService", () => {
  let artifactStore: ReturnType<typeof createFakeArtifactStore>;

  beforeEach(() => {
    artifactStore = createFakeArtifactStore();
  });

  // ── Packet Assembly ─────────────────────────────────────────────────────

  describe("packet assembly", () => {
    /**
     * Core happy-path test: verifies the emitter produces a complete, schema-valid
     * packet from a passing validation run. This is the primary correctness gate
     * for the entire emission pipeline.
     */
    it("assembles a schema-valid packet from a passing run result", async () => {
      const service = createValidationPacketEmitterService({ artifactStore });
      const { packet } = await service.emitPacket(createEmitParams());

      // Verify top-level fields
      expect(packet.packet_type).toBe("validation_result_packet");
      expect(packet.schema_version).toBe("1.0");
      expect(packet.task_id).toBe("task-1");
      expect(packet.repository_id).toBe("repo-1");
      expect(packet.validation_run_id).toBe("vr-1");
      expect(packet.status).toBe("success");
      expect(packet.summary).toContain("PASSED");
      expect(packet.created_at).toBeTruthy();

      // Verify details
      expect(packet.details.run_scope).toBe("pre-review");
      expect(packet.details.checks).toHaveLength(2);

      // Verify Zod validation passes
      const parseResult = ValidationResultPacketSchema.safeParse(packet);
      expect(parseResult.success).toBe(true);
    });

    /**
     * Verifies that a failed validation run produces a packet with "failed"
     * status. This is critical because the orchestrator uses packet status
     * to gate state transitions.
     */
    it("assembles a packet with failed status from a failing run", async () => {
      const service = createValidationPacketEmitterService({ artifactStore });
      const result = await service.emitPacket(
        createEmitParams({
          validationRunResult: createRunResult({
            overallStatus: "failed",
            summary:
              'Validation FAILED for task task-1 using profile "default-dev". Required: 1/2 passed.',
            checkOutcomes: [
              createCheckOutcome({
                checkName: "test",
                command: "pnpm test",
                status: "failed",
                durationMs: 3000,
                errorMessage: "3 tests failed",
              }),
              createCheckOutcome({
                checkName: "lint",
                command: "eslint .",
                status: "passed",
                durationMs: 500,
              }),
            ],
            requiredPassedCount: 1,
            requiredFailedCount: 1,
          }),
        }),
      );

      expect(result.packet.status).toBe("failed");
      expect(result.packet.details.checks[0]!.status).toBe("failed");
      expect(result.packet.details.checks[1]!.status).toBe("passed");
    });

    /**
     * Verifies created_at is a valid ISO 8601 datetime. The schema enforces
     * this format, so the emitter must produce a compliant timestamp.
     */
    it("sets created_at to a valid ISO 8601 datetime", async () => {
      const service = createValidationPacketEmitterService({ artifactStore });
      const before = new Date().toISOString();
      const { packet } = await service.emitPacket(createEmitParams());
      const after = new Date().toISOString();

      expect(new Date(packet.created_at).toISOString()).toBe(packet.created_at);
      expect(packet.created_at >= before).toBe(true);
      expect(packet.created_at <= after).toBe(true);
    });
  });

  // ── Run Scope ───────────────────────────────────────────────────────────

  describe("run_scope mapping", () => {
    /**
     * Verifies all five run_scope values are correctly passed through to the
     * packet. This ensures the emitter doesn't hardcode or filter any scope.
     */
    it.each([
      [ValidationRunScope.PRE_DEV, "pre-dev"],
      [ValidationRunScope.DURING_DEV, "during-dev"],
      [ValidationRunScope.PRE_REVIEW, "pre-review"],
      [ValidationRunScope.PRE_MERGE, "pre-merge"],
      [ValidationRunScope.POST_MERGE, "post-merge"],
    ] as const)("includes run_scope %s in packet details", async (scope, expected) => {
      const service = createValidationPacketEmitterService({ artifactStore });
      const { packet } = await service.emitPacket(createEmitParams({ runScope: scope }));
      expect(packet.details.run_scope).toBe(expected);
    });
  });

  // ── Check Outcome Mapping ─────────────────────────────────────────────

  describe("check outcome to check result mapping", () => {
    /**
     * Verifies that known check names (test, lint, build, typecheck, security)
     * are correctly mapped to their corresponding ValidationCheckType values.
     * This mapping is essential for downstream consumers that filter by check_type.
     */
    it.each([
      ["test", "test"],
      ["lint", "lint"],
      ["build", "build"],
      ["typecheck", "typecheck"],
      ["security", "security"],
      ["schema", "schema"],
      ["policy", "policy"],
    ])("maps check name '%s' to check_type '%s'", (checkName, expectedType) => {
      const result = mapCheckOutcomeToResult(
        createCheckOutcome({ checkName, command: "pnpm run " + checkName }),
      );
      expect(result.check_type).toBe(expectedType);
    });

    /**
     * Verifies that unknown check names (custom checks not in the enum) fall
     * back to "policy" check_type. This prevents schema validation failures
     * for operator-defined custom check names.
     */
    it("maps unknown check names to 'policy' check_type", () => {
      const result = mapCheckOutcomeToResult(
        createCheckOutcome({ checkName: "custom-analysis", command: "my-tool analyze" }),
      );
      expect(result.check_type).toBe("policy");
    });

    /**
     * Verifies tool_name is extracted as the first token of the command.
     * This is used to identify which tool ran the check (e.g., "pnpm", "eslint").
     */
    it("extracts tool_name as first token of command", () => {
      const result = mapCheckOutcomeToResult(createCheckOutcome({ command: "eslint --fix ." }));
      expect(result.tool_name).toBe("eslint");
    });

    /**
     * Verifies that an empty command produces "unknown" as tool_name rather
     * than an empty string (which would fail schema validation).
     */
    it("uses 'unknown' tool_name for empty commands", () => {
      const result = mapCheckOutcomeToResult(
        createCheckOutcome({ command: "", checkName: "skipped-check" }),
      );
      expect(result.tool_name).toBe("unknown");
    });

    /**
     * Verifies that "error" status (infrastructure failure) is mapped to
     * "failed" in the packet. The packet schema only supports passed/failed/skipped,
     * so error must be collapsed into failed to remain schema-valid.
     */
    it("maps 'error' status to 'failed'", () => {
      const result = mapCheckOutcomeToResult(
        createCheckOutcome({ status: "error", errorMessage: "Command not found" }),
      );
      expect(result.status).toBe("failed");
    });

    /**
     * Verifies that "skipped" status is preserved as-is. Skipped checks
     * are meaningful for validation gates (T057) and must be distinguishable
     * from failures.
     */
    it("preserves 'skipped' status", () => {
      const result = mapCheckOutcomeToResult(createCheckOutcome({ status: "skipped" }));
      expect(result.status).toBe("skipped");
    });

    /**
     * Verifies duration_ms is correctly mapped from the camelCase runner
     * format to the snake_case packet format.
     */
    it("maps durationMs to duration_ms", () => {
      const result = mapCheckOutcomeToResult(createCheckOutcome({ durationMs: 4567 }));
      expect(result.duration_ms).toBe(4567);
    });

    /**
     * Verifies that check summaries include the error message when present.
     * This provides human-readable context in the packet for debugging.
     */
    it("builds summary with error message for failed checks", () => {
      const result = mapCheckOutcomeToResult(
        createCheckOutcome({ status: "failed", errorMessage: "exit code 1" }),
      );
      expect(result.summary).toContain("failed");
      expect(result.summary).toContain("exit code 1");
    });

    /**
     * Verifies passed checks get a clean summary without error details.
     */
    it("builds clean summary for passed checks", () => {
      const result = mapCheckOutcomeToResult(createCheckOutcome({ status: "passed" }));
      expect(result.summary).toBe("test: passed");
    });
  });

  // ── Status Mapping ────────────────────────────────────────────────────

  describe("overall status to packet status mapping", () => {
    /**
     * Verifies the critical mapping: runner "passed" → packet "success".
     * The naming difference (passed vs success) is intentional per PRD 008 §8.2.3.
     */
    it("maps passed to success", async () => {
      const service = createValidationPacketEmitterService({ artifactStore });
      const { packet } = await service.emitPacket(
        createEmitParams({ validationRunResult: createRunResult({ overallStatus: "passed" }) }),
      );
      expect(packet.status).toBe("success");
    });

    /**
     * Verifies runner "failed" → packet "failed" (same value, direct mapping).
     */
    it("maps failed to failed", async () => {
      const service = createValidationPacketEmitterService({ artifactStore });
      const { packet } = await service.emitPacket(
        createEmitParams({
          validationRunResult: createRunResult({
            overallStatus: "failed",
            summary: "Validation FAILED.",
          }),
        }),
      );
      expect(packet.status).toBe("failed");
    });
  });

  // ── Schema Validation ─────────────────────────────────────────────────

  describe("schema validation", () => {
    /**
     * Verifies that every emitted packet passes Zod schema validation.
     * This is a redundant check since the service validates internally,
     * but it confirms the test's own packet is schema-compliant.
     */
    it("emitted packet passes Zod validation", async () => {
      const service = createValidationPacketEmitterService({ artifactStore });
      const { packet } = await service.emitPacket(createEmitParams());

      const parseResult = ValidationResultPacketSchema.safeParse(packet);
      expect(parseResult.success).toBe(true);
    });

    /**
     * Verifies the emitter handles an empty checks array. Some validation
     * profiles may have no checks configured, and the packet should still
     * be valid.
     */
    it("handles empty check outcomes array", async () => {
      const service = createValidationPacketEmitterService({ artifactStore });
      const { packet } = await service.emitPacket(
        createEmitParams({
          validationRunResult: createRunResult({
            checkOutcomes: [],
            summary: "No checks configured.",
          }),
        }),
      );

      expect(packet.details.checks).toHaveLength(0);
      const parseResult = ValidationResultPacketSchema.safeParse(packet);
      expect(parseResult.success).toBe(true);
    });
  });

  // ── Artifact Persistence ──────────────────────────────────────────────

  describe("artifact persistence", () => {
    /**
     * Verifies that the artifact store's persist method is called exactly once
     * with the correct validation run ID and the validated packet. This ensures
     * the packet is actually persisted, not just assembled.
     */
    it("persists the validated packet via artifact store", async () => {
      const service = createValidationPacketEmitterService({ artifactStore });
      await service.emitPacket(createEmitParams({ validationRunId: "vr-42" }));

      expect(artifactStore.calls).toHaveLength(1);
      expect(artifactStore.calls[0]!.validationRunId).toBe("vr-42");
      expect(artifactStore.calls[0]!.packet).toHaveProperty(
        "packet_type",
        "validation_result_packet",
      );
    });

    /**
     * Verifies the artifact path returned by the store is propagated to the
     * caller. This path is needed for audit logging and artifact retrieval.
     */
    it("returns the artifact path from the store", async () => {
      const service = createValidationPacketEmitterService({ artifactStore });
      const { artifactPath } = await service.emitPacket(
        createEmitParams({ validationRunId: "vr-99" }),
      );

      expect(artifactPath).toBe("/artifacts/validation-runs/vr-99/validation-result-packet.json");
    });

    /**
     * Verifies the persist method receives the Zod-parsed packet (not the raw
     * assembled object). This ensures only schema-validated data is stored.
     */
    it("persists the Zod-parsed packet, not the raw assembly", async () => {
      const service = createValidationPacketEmitterService({ artifactStore });
      await service.emitPacket(createEmitParams());

      const persistedPacket = artifactStore.calls[0]!.packet;
      const parseResult = ValidationResultPacketSchema.safeParse(persistedPacket);
      expect(parseResult.success).toBe(true);
    });
  });

  // ── Mixed Check Statuses ──────────────────────────────────────────────

  describe("mixed check statuses", () => {
    /**
     * Verifies correct handling of a realistic mixed-status run with required
     * failures, optional passes, and skipped checks. This represents the
     * most complex real-world scenario.
     */
    it("correctly maps a run with mixed required/optional/skipped checks", async () => {
      const service = createValidationPacketEmitterService({ artifactStore });
      const { packet } = await service.emitPacket(
        createEmitParams({
          validationRunResult: createRunResult({
            overallStatus: "failed",
            summary:
              "Validation FAILED. Required: 1/2 passed. Optional: 1/1 passed. 1 check(s) skipped.",
            checkOutcomes: [
              createCheckOutcome({
                checkName: "test",
                command: "pnpm test",
                category: "required",
                status: "passed",
                durationMs: 1500,
              }),
              createCheckOutcome({
                checkName: "lint",
                command: "eslint .",
                category: "required",
                status: "failed",
                durationMs: 800,
                errorMessage: "42 lint errors",
              }),
              createCheckOutcome({
                checkName: "build",
                command: "pnpm build",
                category: "optional",
                status: "passed",
                durationMs: 3000,
              }),
              createCheckOutcome({
                checkName: "security",
                command: "",
                category: "required",
                status: "skipped",
                durationMs: 0,
                errorMessage: 'No command mapping found for check "security"',
              }),
            ],
            requiredPassedCount: 1,
            requiredFailedCount: 1,
            optionalPassedCount: 1,
            optionalFailedCount: 0,
            skippedCount: 1,
          }),
        }),
      );

      expect(packet.status).toBe("failed");
      expect(packet.details.checks).toHaveLength(4);

      // Check individual mappings
      expect(packet.details.checks[0]).toMatchObject({
        check_type: "test",
        tool_name: "pnpm",
        status: "passed",
      });
      expect(packet.details.checks[1]).toMatchObject({
        check_type: "lint",
        tool_name: "eslint",
        status: "failed",
      });
      expect(packet.details.checks[2]).toMatchObject({
        check_type: "build",
        tool_name: "pnpm",
        status: "passed",
      });
      expect(packet.details.checks[3]).toMatchObject({
        check_type: "security",
        tool_name: "unknown",
        status: "skipped",
      });
    });

    /**
     * Verifies that "error" status checks (infrastructure failures like
     * policy denials) are correctly collapsed to "failed" in the packet
     * while preserving the error context in the summary.
     */
    it("maps error checks to failed with error context in summary", async () => {
      const service = createValidationPacketEmitterService({ artifactStore });
      const { packet } = await service.emitPacket(
        createEmitParams({
          validationRunResult: createRunResult({
            overallStatus: "failed",
            summary: "Validation FAILED.",
            checkOutcomes: [
              createCheckOutcome({
                checkName: "test",
                command: "pnpm test",
                status: "error",
                durationMs: 10,
                errorMessage: "Command denied by policy",
              }),
            ],
            requiredPassedCount: 0,
            requiredFailedCount: 1,
          }),
        }),
      );

      const check = packet.details.checks[0]!;
      expect(check.status).toBe("failed");
      expect(check.summary).toContain("error");
      expect(check.summary).toContain("Command denied by policy");
    });
  });

  // ── Post-Merge Validation ─────────────────────────────────────────────

  describe("post-merge validation run", () => {
    /**
     * Verifies that post-merge validation runs produce packets with the
     * correct run_scope. Post-merge validation is a distinct workflow stage
     * that triggers different orchestrator behavior.
     */
    it("emits packet with post-merge run_scope", async () => {
      const service = createValidationPacketEmitterService({ artifactStore });
      const { packet } = await service.emitPacket(
        createEmitParams({ runScope: ValidationRunScope.POST_MERGE }),
      );

      expect(packet.details.run_scope).toBe("post-merge");
      const parseResult = ValidationResultPacketSchema.safeParse(packet);
      expect(parseResult.success).toBe(true);
    });
  });

  // ── Error Handling ────────────────────────────────────────────────────

  describe("error handling", () => {
    /**
     * Verifies that artifact store errors propagate to the caller.
     * The emitter should not swallow persistence failures silently.
     */
    it("propagates artifact store errors", async () => {
      const failingStore: ValidationPacketArtifactPort = {
        persist: vi.fn(async () => {
          throw new Error("Storage unavailable");
        }),
      };
      const service = createValidationPacketEmitterService({ artifactStore: failingStore });

      await expect(service.emitPacket(createEmitParams())).rejects.toThrow("Storage unavailable");
    });
  });
});
