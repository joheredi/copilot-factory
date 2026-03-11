/**
 * Validation packet emitter service — assembles, validates, and persists
 * {@link ValidationResultPacket} artifacts from validation run results.
 *
 * This service bridges the gap between the validation runner (which produces
 * {@link ValidationRunResult}) and the packet schema contract (which requires
 * a {@link ValidationResultPacket}). It handles:
 *
 * 1. **Mapping** — converts {@link ValidationCheckOutcome} objects to the
 *    schema-required {@link ValidationCheckResult} format.
 * 2. **Schema validation** — validates the assembled packet against the Zod
 *    schema before persistence.
 * 3. **Persistence** — stores the validated packet via the
 *    {@link ValidationPacketArtifactPort}.
 *
 * @module @factory/application/services/validation-packet-emitter
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.10 ValidationResultPacket
 * @see {@link file://docs/backlog/tasks/T056-validation-packet-emission.md}
 */

import { ValidationCheckType, PacketStatus, type ValidationCheckStatus } from "@factory/domain";
import {
  ValidationResultPacketSchema,
  type ValidationResultPacket,
  type ValidationCheckResult,
} from "@factory/schemas";

import type { ValidationCheckOutcome } from "../ports/validation-runner.ports.js";
import type {
  ValidationPacketArtifactPort,
  EmitValidationPacketParams,
  EmitValidationPacketResult,
} from "../ports/validation-packet-emitter.ports.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Schema version for V1 validation result packets. */
const SCHEMA_VERSION = "1.0" as const;

/** Packet type literal for validation result packets. */
const PACKET_TYPE = "validation_result_packet" as const;

/**
 * Set of known {@link ValidationCheckType} values for O(1) lookup.
 * Used to map check names from the runner to schema-valid check_type values.
 */
const KNOWN_CHECK_TYPES = new Set<string>(Object.values(ValidationCheckType));

/**
 * Default check type used when a check name does not match any known
 * {@link ValidationCheckType} value. "policy" is the most appropriate
 * catch-all since custom checks are typically policy-driven.
 */
const DEFAULT_CHECK_TYPE: ValidationCheckType = ValidationCheckType.POLICY;

// ─── Error Types ────────────────────────────────────────────────────────────

/**
 * Thrown when an assembled packet fails Zod schema validation.
 *
 * This indicates a bug in the assembly logic, not a user-facing error.
 * The packet should always validate after correct assembly.
 */
export class ValidationPacketSchemaError extends Error {
  /** The Zod validation issues that caused the failure. */
  readonly issues: readonly { path: (string | number)[]; message: string }[];

  constructor(issues: readonly { path: (string | number)[]; message: string }[]) {
    const detail = issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    super(`Assembled ValidationResultPacket failed schema validation:\n${detail}`);
    this.name = "ValidationPacketSchemaError";
    this.issues = issues;
  }
}

// ─── Service Interface ──────────────────────────────────────────────────────

/**
 * Service for assembling and persisting validation result packets.
 *
 * @example
 * ```typescript
 * const emitter = createValidationPacketEmitterService({ artifactStore });
 * const { packet, artifactPath } = await emitter.emitPacket({
 *   taskId: "task-123",
 *   repositoryId: "repo-456",
 *   validationRunId: "vr-789",
 *   runScope: ValidationRunScope.PRE_REVIEW,
 *   validationRunResult: runnerResult,
 * });
 * ```
 */
export interface ValidationPacketEmitterService {
  /**
   * Assemble a {@link ValidationResultPacket} from a validation run result,
   * validate it against the schema, and persist it as an artifact.
   *
   * @param params - Emission parameters including IDs, run scope, and run result.
   * @returns The validated packet and its artifact storage path.
   * @throws {ValidationPacketSchemaError} If the assembled packet fails schema validation.
   */
  emitPacket(params: EmitValidationPacketParams): Promise<EmitValidationPacketResult>;
}

// ─── Dependencies ───────────────────────────────────────────────────────────

/**
 * Dependencies required by the validation packet emitter service.
 */
export interface ValidationPacketEmitterDependencies {
  /** Port for persisting the validated packet as an artifact. */
  readonly artifactStore: ValidationPacketArtifactPort;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a new validation packet emitter service.
 *
 * @param deps - Dependencies including the artifact store port.
 * @returns A {@link ValidationPacketEmitterService} instance.
 */
export function createValidationPacketEmitterService(
  deps: ValidationPacketEmitterDependencies,
): ValidationPacketEmitterService {
  return {
    emitPacket: async (params: EmitValidationPacketParams): Promise<EmitValidationPacketResult> => {
      const { taskId, repositoryId, validationRunId, runScope, validationRunResult } = params;

      // ── 1. Map check outcomes to schema format ───────────────────────
      const checks = validationRunResult.checkOutcomes.map(mapCheckOutcomeToResult);

      // ── 2. Determine packet status ───────────────────────────────────
      const status = mapOverallStatusToPacketStatus(validationRunResult.overallStatus);

      // ── 3. Assemble packet ───────────────────────────────────────────
      const packet: ValidationResultPacket = {
        packet_type: PACKET_TYPE,
        schema_version: SCHEMA_VERSION,
        created_at: new Date().toISOString(),
        task_id: taskId,
        repository_id: repositoryId,
        validation_run_id: validationRunId,
        status,
        summary: validationRunResult.summary,
        details: {
          run_scope: runScope,
          checks,
        },
      };

      // ── 4. Validate against Zod schema ───────────────────────────────
      const parseResult = ValidationResultPacketSchema.safeParse(packet);
      if (!parseResult.success) {
        throw new ValidationPacketSchemaError(
          parseResult.error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        );
      }

      // ── 5. Persist as artifact ───────────────────────────────────────
      const artifactPath = await deps.artifactStore.persist(validationRunId, parseResult.data);

      return { packet: parseResult.data, artifactPath };
    },
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Map a {@link ValidationCheckOutcome} from the runner to a
 * {@link ValidationCheckResult} conforming to the packet schema.
 *
 * Key transformations:
 * - `checkName` → `check_type`: matched against known {@link ValidationCheckType}
 *   values; falls back to {@link DEFAULT_CHECK_TYPE} for unknown names.
 * - `command` → `tool_name`: extracted as the first whitespace-delimited token.
 * - `status`: "error" is mapped to "failed" since the packet schema only
 *   supports "passed", "failed", "skipped".
 * - `durationMs` → `duration_ms`: renamed to match snake_case convention.
 * - `summary`: generated from status and error message for human readability.
 *
 * @param outcome - Check outcome from the validation runner.
 * @returns Schema-valid check result for the packet.
 */
export function mapCheckOutcomeToResult(outcome: ValidationCheckOutcome): ValidationCheckResult {
  return {
    check_type: resolveCheckType(outcome.checkName),
    tool_name: extractToolName(outcome.command),
    command: outcome.command || `(no command for ${outcome.checkName})`,
    status: mapCheckStatus(outcome.status),
    duration_ms: outcome.durationMs,
    summary: buildCheckSummary(outcome),
  };
}

/**
 * Resolve a check name to a valid {@link ValidationCheckType}.
 *
 * If the check name exactly matches a known check type value (e.g., "test",
 * "lint", "build"), it is returned directly. Otherwise, the
 * {@link DEFAULT_CHECK_TYPE} is used.
 *
 * @param checkName - The check name from the validation profile.
 * @returns A valid check type value.
 */
function resolveCheckType(checkName: string): ValidationCheckType {
  if (KNOWN_CHECK_TYPES.has(checkName)) {
    return checkName as ValidationCheckType;
  }
  return DEFAULT_CHECK_TYPE;
}

/**
 * Extract the tool name from a shell command string.
 *
 * Takes the first whitespace-delimited token of the command. For example,
 * `"pnpm test"` yields `"pnpm"`, and `"eslint ."` yields `"eslint"`.
 * Returns `"unknown"` for empty or whitespace-only commands.
 *
 * @param command - The full shell command string.
 * @returns The tool name (first token).
 */
function extractToolName(command: string): string {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return "unknown";
  }
  const firstSpace = trimmed.indexOf(" ");
  return firstSpace === -1 ? trimmed : trimmed.substring(0, firstSpace);
}

/**
 * Map the runner's check status to the packet schema's check status.
 *
 * The runner uses "passed" | "failed" | "skipped" | "error", but the packet
 * schema only supports "passed" | "failed" | "skipped". The "error" status
 * (infrastructure-level failures like policy denials) is mapped to "failed"
 * since it represents a check that did not succeed.
 *
 * @param status - The runner's check status.
 * @returns A schema-valid check status.
 */
function mapCheckStatus(status: "passed" | "failed" | "skipped" | "error"): ValidationCheckStatus {
  if (status === "error") {
    return "failed";
  }
  return status;
}

/**
 * Map the runner's overall status to the packet's {@link PacketStatus}.
 *
 * - `"passed"` → `"success"` (all required checks passed)
 * - `"failed"` → `"failed"` (one or more required checks failed)
 *
 * @param overallStatus - The runner's aggregated status.
 * @returns A packet-level status value.
 */
function mapOverallStatusToPacketStatus(overallStatus: "passed" | "failed"): "success" | "failed" {
  return overallStatus === "passed" ? PacketStatus.SUCCESS : PacketStatus.FAILED;
}

/**
 * Build a human-readable summary for a single check result.
 *
 * Combines the check name, status, and any error message into a concise
 * description suitable for the packet's `summary` field.
 *
 * @param outcome - The check outcome from the runner.
 * @returns A summary string.
 */
function buildCheckSummary(outcome: ValidationCheckOutcome): string {
  const label = outcome.checkName;
  switch (outcome.status) {
    case "passed":
      return `${label}: passed`;
    case "failed":
      return outcome.errorMessage
        ? `${label}: failed — ${outcome.errorMessage}`
        : `${label}: failed`;
    case "skipped":
      return outcome.errorMessage
        ? `${label}: skipped — ${outcome.errorMessage}`
        : `${label}: skipped`;
    case "error":
      return outcome.errorMessage
        ? `${label}: error — ${outcome.errorMessage}`
        : `${label}: error (infrastructure failure)`;
  }
}
