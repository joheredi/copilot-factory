/**
 * Output validator service — validates structured worker output packets.
 *
 * Implements the full validation pipeline from PRD 008 §8.14:
 * 1. Extract packet from worker output (file-based or delimiter-based)
 * 2. Parse and validate against the declared Zod schema
 * 3. Verify schema version compatibility
 * 4. Verify all IDs match the orchestrator run context
 * 5. Verify referenced artifacts exist
 * 6. Attempt conservative schema repair for minor violations
 * 7. Track consecutive schema failures per agent profile
 * 8. Record schema_violation audit events on all failures
 *
 * Design decision: This service is in the application layer because it enforces
 * business rules (ID matching, version compatibility, failure tracking) that sit
 * above raw infrastructure concerns (file I/O, process management). The
 * infrastructure adapter (e.g., CopilotCliAdapter) handles raw extraction;
 * this service handles acceptance logic.
 *
 * @see docs/prd/008-packet-and-schema-spec.md §8.14 — Implementation Rule
 * @see docs/prd/010-integration-contracts.md §10.8.5 — Structured Output Rule
 * @see docs/backlog/tasks/T046-output-capture-validation.md
 * @module @factory/application/services/output-validator.service
 */

import type { ZodType, ZodIssue } from "zod";
import {
  DevResultPacketSchema,
  ReviewPacketSchema,
  LeadReviewDecisionPacketSchema,
  MergePacketSchema,
  MergeAssistPacketSchema,
  ValidationResultPacketSchema,
  PostMergeAnalysisPacketSchema,
  isVersionCompatible,
} from "@factory/schemas";
import type { NewAuditEvent } from "../ports/repository.ports.js";
import type {
  WorkerOutputSource,
  OutputValidationContext,
  OutputValidationResult,
  OutputValidationSuccess,
  OutputValidationFailure,
  OutputRejectionReason,
  ExtractionResult,
  ArtifactExistencePort,
  SchemaFailureTrackerPort,
  OutputValidationAuditPort,
  OutputValidatorService,
} from "../ports/output-validator.ports.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Start delimiter for extracting structured packets from stdout. */
export const RESULT_PACKET_START_DELIMITER = "---BEGIN_RESULT_PACKET---";

/** End delimiter for extracting structured packets from stdout. */
export const RESULT_PACKET_END_DELIMITER = "---END_RESULT_PACKET---";

/**
 * Default number of consecutive schema failures before a profile is disabled.
 * @see docs/prd/010-integration-contracts.md — referenced as §4.10 threshold
 */
export const DEFAULT_CONSECUTIVE_FAILURE_THRESHOLD = 3;

// ─── Packet Schema Registry ─────────────────────────────────────────────────

/**
 * Maps packet type identifiers to their Zod validation schemas.
 *
 * This registry enables the validator to look up the correct schema
 * for any expected packet type without coupling to specific packet imports.
 */
const PACKET_SCHEMA_REGISTRY: Readonly<Record<string, ZodType>> = {
  dev_result_packet: DevResultPacketSchema,
  review_packet: ReviewPacketSchema,
  lead_review_decision_packet: LeadReviewDecisionPacketSchema,
  merge_packet: MergePacketSchema,
  merge_assist_packet: MergeAssistPacketSchema,
  validation_result_packet: ValidationResultPacketSchema,
  post_merge_analysis_packet: PostMergeAnalysisPacketSchema,
};

/**
 * Maps packet types to the stage-specific ID fields they must contain.
 * Used by ID verification to check only the relevant IDs for each packet type.
 */
const PACKET_STAGE_ID_FIELDS: Readonly<Record<string, readonly string[]>> = {
  dev_result_packet: ["run_id"],
  review_packet: ["review_cycle_id"],
  lead_review_decision_packet: ["review_cycle_id"],
  merge_packet: ["merge_queue_item_id"],
  merge_assist_packet: ["merge_queue_item_id"],
  validation_result_packet: ["validation_run_id"],
  post_merge_analysis_packet: ["merge_queue_item_id", "validation_run_id"],
};

// ─── Extraction ──────────────────────────────────────────────────────────────

/**
 * Extract a structured packet from raw worker output.
 *
 * Tries two strategies in priority order:
 * 1. Parse the designated output file content as JSON
 * 2. Extract JSON from stdout between well-known delimiters
 *
 * This function is pure — no side effects, no I/O.
 *
 * @param source - Raw output from the worker process
 * @returns Extraction result indicating success, parse error, or not found
 */
export function extractPacket(source: WorkerOutputSource): ExtractionResult {
  // Strategy 1: File-based extraction
  if (source.outputFileContent !== null) {
    const trimmed = source.outputFileContent.trim();
    if (trimmed.length > 0) {
      try {
        return {
          status: "found",
          packet: JSON.parse(trimmed) as unknown,
          source: "file",
        };
      } catch (e) {
        return {
          status: "json_parse_error",
          rawContent: trimmed,
          source: "file",
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  }

  // Strategy 2: Delimiter-based extraction from stdout
  const startIdx = source.stdoutContent.indexOf(RESULT_PACKET_START_DELIMITER);
  if (startIdx === -1) {
    return { status: "not_found" };
  }

  const contentStart = startIdx + RESULT_PACKET_START_DELIMITER.length;
  const endIdx = source.stdoutContent.indexOf(RESULT_PACKET_END_DELIMITER, contentStart);
  if (endIdx === -1) {
    return { status: "not_found" };
  }

  const jsonStr = source.stdoutContent.substring(contentStart, endIdx).trim();
  if (jsonStr.length === 0) {
    return { status: "not_found" };
  }

  try {
    return {
      status: "found",
      packet: JSON.parse(jsonStr) as unknown,
      source: "stdout",
    };
  } catch (e) {
    return {
      status: "json_parse_error",
      rawContent: jsonStr,
      source: "stdout",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── Schema Validation ───────────────────────────────────────────────────────

/**
 * Result of Zod schema validation, including formatted error messages.
 */
export interface SchemaValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly issues: readonly ZodIssue[];
}

/**
 * Validate a packet against its expected Zod schema.
 *
 * @param data - Parsed packet data
 * @param expectedPacketType - Expected packet type string (e.g., "dev_result_packet")
 * @returns Validation result with formatted errors
 */
export function validateSchema(data: unknown, expectedPacketType: string): SchemaValidationResult {
  const schema = PACKET_SCHEMA_REGISTRY[expectedPacketType];
  if (!schema) {
    return {
      valid: false,
      errors: [`No schema registered for packet type: ${expectedPacketType}`],
      issues: [],
    };
  }

  const result = schema.safeParse(data);
  if (result.success) {
    return { valid: true, errors: [], issues: [] };
  }

  const errors = result.error.issues.map(
    (issue: ZodIssue) => `${issue.path.join(".")}: ${issue.message}`,
  );
  return { valid: false, errors, issues: result.error.issues };
}

// ─── Schema Repair ───────────────────────────────────────────────────────────

/**
 * Result of a schema repair attempt.
 */
export interface RepairResult {
  /** Whether the repair produced a valid packet. */
  readonly success: boolean;
  /** The repaired data (only meaningful when success is true). */
  readonly repairedData: unknown;
  /** Human-readable descriptions of repair actions applied. */
  readonly actions: readonly string[];
}

/**
 * Attempt conservative schema repair for minor violations.
 *
 * Only repairs fields where a safe default can be inferred:
 * - Missing array fields → empty array `[]`
 * - Missing nullable fields → `null`
 *
 * Does NOT repair missing required strings, numbers, or objects,
 * as those would produce semantically incorrect data.
 *
 * @param data - Original packet data that failed validation
 * @param issues - Zod validation issues from the failed parse
 * @param expectedPacketType - Expected packet type for re-validation
 * @returns Repair result, or null if no repairs were possible
 */
export function attemptSchemaRepair(
  data: unknown,
  issues: readonly ZodIssue[],
  expectedPacketType: string,
): RepairResult {
  if (typeof data !== "object" || data === null) {
    return { success: false, repairedData: data, actions: [] };
  }

  const repaired = structuredClone(data) as Record<string, unknown>;
  const actions: string[] = [];

  for (const issue of issues) {
    if (issue.code === "invalid_type" && issue.received === "undefined") {
      const fieldPath = issue.path.join(".");

      if (issue.expected === "array") {
        setNestedValue(repaired, issue.path, []);
        actions.push(`Set missing array field "${fieldPath}" to []`);
      } else if (issue.expected === "null") {
        setNestedValue(repaired, issue.path, null);
        actions.push(`Set missing nullable field "${fieldPath}" to null`);
      }
      // Other types (string, number, object) cannot be safely defaulted
    }
  }

  if (actions.length === 0) {
    return { success: false, repairedData: data, actions: [] };
  }

  // Re-validate after repair
  const revalidation = validateSchema(repaired, expectedPacketType);
  return {
    success: revalidation.valid,
    repairedData: revalidation.valid ? repaired : data,
    actions,
  };
}

/**
 * Set a value at a nested path within an object.
 * Used internally by the repair logic to apply defaults.
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: readonly (string | number)[],
  value: unknown,
): void {
  if (path.length === 0) return;

  let current: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    const next = current[key as string];
    if (typeof next !== "object" || next === null) return;
    current = next as Record<string, unknown>;
  }

  const finalKey = path[path.length - 1]!;
  current[finalKey as string] = value;
}

// ─── ID Verification ─────────────────────────────────────────────────────────

/**
 * Verify that packet IDs match the orchestrator's run context.
 *
 * Every packet must include `task_id` and `repository_id` matching the
 * orchestrator context. Stage-specific IDs (run_id, review_cycle_id, etc.)
 * are checked based on the packet type.
 *
 * @see docs/prd/008-packet-and-schema-spec.md §8.2.2 — Identity and References
 * @see docs/prd/008-packet-and-schema-spec.md §8.14 rule 3
 *
 * @param packet - Validated packet data
 * @param context - Orchestrator-provided validation context
 * @returns Array of mismatch descriptions (empty if all IDs match)
 */
export function verifyIds(
  packet: Record<string, unknown>,
  context: OutputValidationContext,
): string[] {
  const mismatches: string[] = [];

  // Universal IDs — every result packet must include these
  if (packet["task_id"] !== context.taskId) {
    mismatches.push(`task_id: expected "${context.taskId}", got "${String(packet["task_id"])}"`);
  }
  if (packet["repository_id"] !== context.repositoryId) {
    mismatches.push(
      `repository_id: expected "${context.repositoryId}", got "${String(packet["repository_id"])}"`,
    );
  }

  // Stage-specific IDs — checked based on packet type
  const stageFields = PACKET_STAGE_ID_FIELDS[context.expectedPacketType] ?? [];

  const contextIdMap: Readonly<Record<string, string | undefined>> = {
    run_id: context.runId,
    review_cycle_id: context.reviewCycleId,
    merge_queue_item_id: context.mergeQueueItemId,
    validation_run_id: context.validationRunId,
  };

  for (const field of stageFields) {
    const expected = contextIdMap[field];
    if (expected !== undefined && packet[field] !== expected) {
      mismatches.push(`${field}: expected "${expected}", got "${String(packet[field])}"`);
    }
  }

  return mismatches;
}

// ─── Artifact Verification ───────────────────────────────────────────────────

/**
 * Verify that all artifact references in the packet resolve to existing files.
 *
 * @see docs/prd/008-packet-and-schema-spec.md §8.14 rule 4
 *
 * @param packet - Validated packet data
 * @param artifactChecker - Port for checking artifact existence
 * @returns Array of missing artifact paths (empty if all exist)
 */
export async function verifyArtifacts(
  packet: Record<string, unknown>,
  artifactChecker: ArtifactExistencePort,
): Promise<string[]> {
  const refs = packet["artifact_refs"];
  if (!Array.isArray(refs) || refs.length === 0) {
    return [];
  }

  const missing: string[] = [];
  for (const ref of refs) {
    if (typeof ref === "string") {
      const exists = await artifactChecker.exists(ref);
      if (!exists) {
        missing.push(ref);
      }
    }
  }

  return missing;
}

// ─── Audit Event Construction ────────────────────────────────────────────────

/**
 * Build a schema_violation audit event for a validation failure.
 */
function buildSchemaViolationAuditEvent(
  context: OutputValidationContext,
  reason: OutputRejectionReason,
  errors: readonly string[],
  consecutiveFailures: number,
  profileDisabled: boolean,
): NewAuditEvent {
  return {
    entityType: "task",
    entityId: context.taskId,
    eventType: "schema_violation",
    actorType: "system",
    actorId: "output-validator",
    oldState: null,
    newState: null,
    metadata: JSON.stringify({
      reason,
      expectedPacketType: context.expectedPacketType,
      agentProfileId: context.agentProfileId,
      errors: errors.slice(0, 20), // Cap to prevent huge audit events
      consecutiveFailures,
      profileDisabled,
    }),
  };
}

// ─── Service Factory ─────────────────────────────────────────────────────────

/**
 * Dependencies required to construct the OutputValidatorService.
 */
export interface OutputValidatorDependencies {
  /** Port for verifying artifact reference existence. */
  readonly artifactChecker: ArtifactExistencePort;
  /** Port for tracking consecutive schema failures per agent profile. */
  readonly failureTracker: SchemaFailureTrackerPort;
  /** Port for persisting schema violation audit events. */
  readonly auditRecorder: OutputValidationAuditPort;
  /**
   * Number of consecutive failures before a profile is disabled.
   * @default 3
   */
  readonly consecutiveFailureThreshold?: number;
}

/**
 * Create an OutputValidatorService instance.
 *
 * The service validates structured worker output against schema contracts,
 * verifies ID consistency, checks artifact references, attempts repair for
 * minor violations, tracks consecutive failures, and records audit events.
 *
 * @param deps - Infrastructure dependencies injected via ports
 * @returns OutputValidatorService implementation
 */
export function createOutputValidatorService(
  deps: OutputValidatorDependencies,
): OutputValidatorService {
  const threshold = deps.consecutiveFailureThreshold ?? DEFAULT_CONSECUTIVE_FAILURE_THRESHOLD;

  /**
   * Record a validation failure: update the failure tracker, record an audit
   * event, and return a rejection result.
   */
  async function recordFailureAndReject(
    context: OutputValidationContext,
    reason: OutputRejectionReason,
    errors: readonly string[],
    packet: Record<string, unknown> | null,
  ): Promise<OutputValidationFailure> {
    const consecutiveFailures = await deps.failureTracker.recordFailure(context.agentProfileId);
    const profileDisabled = consecutiveFailures >= threshold;

    const auditEvent = buildSchemaViolationAuditEvent(
      context,
      reason,
      errors,
      consecutiveFailures,
      profileDisabled,
    );
    await deps.auditRecorder.recordAuditEvent(auditEvent);

    return {
      status: "rejected",
      packet,
      reason,
      errors,
      profileDisabled,
      consecutiveFailures,
    };
  }

  return {
    extractPacket(source: WorkerOutputSource): ExtractionResult {
      return extractPacket(source);
    },

    async validateOutput(
      source: WorkerOutputSource,
      context: OutputValidationContext,
    ): Promise<OutputValidationResult> {
      // ── Step 1: Extract packet ──────────────────────────────────────
      const extraction = extractPacket(source);

      if (extraction.status === "not_found") {
        return recordFailureAndReject(
          context,
          "no_packet_found",
          ["No structured output packet found (neither output file nor stdout delimiters)"],
          null,
        );
      }

      if (extraction.status === "json_parse_error") {
        return recordFailureAndReject(
          context,
          "json_parse_error",
          [`JSON parse error from ${extraction.source}: ${extraction.error}`],
          null,
        );
      }

      const packetData = extraction.packet as Record<string, unknown>;

      // ── Step 2: Validate schema version ─────────────────────────────
      const schemaVersion = packetData["schema_version"];
      if (typeof schemaVersion !== "string") {
        return recordFailureAndReject(
          context,
          "version_incompatible",
          ["Packet missing schema_version field"],
          packetData,
        );
      }

      if (!isVersionCompatible(schemaVersion, context.expectedMajorVersion)) {
        return recordFailureAndReject(
          context,
          "version_incompatible",
          [
            `Schema version "${schemaVersion}" is incompatible with expected major version ${String(context.expectedMajorVersion)}`,
          ],
          packetData,
        );
      }

      // ── Step 3: Validate schema (with repair attempt) ───────────────
      const validation = validateSchema(packetData, context.expectedPacketType);

      let finalPacket = packetData;
      let repaired = false;
      let repairActions: readonly string[] = [];

      if (!validation.valid) {
        // Attempt conservative repair
        const repair = attemptSchemaRepair(
          packetData,
          validation.issues,
          context.expectedPacketType,
        );

        if (repair.success) {
          finalPacket = repair.repairedData as Record<string, unknown>;
          repaired = true;
          repairActions = repair.actions;
        } else {
          return recordFailureAndReject(
            context,
            "schema_validation_failed",
            validation.errors,
            packetData,
          );
        }
      }

      // ── Step 4: Verify IDs match orchestrator context ───────────────
      const idMismatches = verifyIds(finalPacket, context);
      if (idMismatches.length > 0) {
        return recordFailureAndReject(context, "id_mismatch", idMismatches, finalPacket);
      }

      // ── Step 5: Verify artifact references exist ────────────────────
      const missingArtifacts = await verifyArtifacts(finalPacket, deps.artifactChecker);
      if (missingArtifacts.length > 0) {
        return recordFailureAndReject(
          context,
          "artifacts_missing",
          missingArtifacts.map((p) => `Missing artifact: ${p}`),
          finalPacket,
        );
      }

      // ── Step 6: Success — reset failure tracker ─────────────────────
      await deps.failureTracker.resetFailures(context.agentProfileId);

      const result: OutputValidationSuccess = {
        status: "accepted",
        packet: finalPacket,
        repaired,
        repairActions,
      };

      return result;
    },
  };
}
