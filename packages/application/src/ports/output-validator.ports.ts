/**
 * Output validator ports — interfaces for structured output validation dependencies.
 *
 * These ports abstract infrastructure concerns (artifact storage, failure tracking)
 * away from the output validation business logic.
 *
 * @see docs/prd/008-packet-and-schema-spec.md §8.14 — Implementation Rule
 * @see docs/backlog/tasks/T046-output-capture-validation.md
 * @module @factory/application/ports/output-validator.ports
 */

import type { NewAuditEvent, AuditEventRecord } from "./repository.ports.js";

// ─── Worker Output Source ────────────────────────────────────────────────────

/**
 * Raw worker output from which the structured result packet must be extracted.
 *
 * The output validator tries two extraction strategies in order:
 * 1. File-based: read JSON from the designated output file
 * 2. Delimiter-based: extract JSON from stdout between well-known delimiters
 */
export interface WorkerOutputSource {
  /** Content of the designated output file, or null if the file does not exist. */
  readonly outputFileContent: string | null;
  /** Full stdout content captured from the worker process. */
  readonly stdoutContent: string;
}

// ─── Validation Context ──────────────────────────────────────────────────────

/**
 * Orchestrator-provided context used to verify that extracted packet IDs
 * match the expected run context. Prevents cross-task or cross-run
 * packet impersonation.
 *
 * @see docs/prd/008-packet-and-schema-spec.md §8.2.2 — Identity and References
 */
export interface OutputValidationContext {
  /** Task that this run belongs to. */
  readonly taskId: string;
  /** Repository that this task operates on. */
  readonly repositoryId: string;
  /** Worker run ID (for DevResultPacket, etc.). */
  readonly runId?: string;
  /** Review cycle ID (for ReviewPacket, LeadReviewDecisionPacket). */
  readonly reviewCycleId?: string;
  /** Merge queue item ID (for MergePacket, MergeAssistPacket, PostMergeAnalysisPacket). */
  readonly mergeQueueItemId?: string;
  /** Validation run ID (for ValidationResultPacket, PostMergeAnalysisPacket). */
  readonly validationRunId?: string;
  /** Expected packet type as declared in the task's output schema expectation. */
  readonly expectedPacketType: string;
  /** Expected major version number for schema compatibility. */
  readonly expectedMajorVersion: number;
  /** Agent profile identifier for consecutive failure tracking. */
  readonly agentProfileId: string;
}

// ─── Validation Results ──────────────────────────────────────────────────────

/**
 * Reason categories for output rejection. Each maps to a specific
 * validation step in the pipeline.
 */
export type OutputRejectionReason =
  | "no_packet_found"
  | "json_parse_error"
  | "schema_validation_failed"
  | "version_incompatible"
  | "id_mismatch"
  | "artifacts_missing";

/**
 * Returned when the worker output passes all validation checks.
 */
export interface OutputValidationSuccess {
  readonly status: "accepted";
  /** The validated (and possibly repaired) packet data. */
  readonly packet: Record<string, unknown>;
  /** True if the packet required schema repair before acceptance. */
  readonly repaired: boolean;
  /** Human-readable descriptions of repair actions applied, if any. */
  readonly repairActions: readonly string[];
}

/**
 * Returned when the worker output fails one or more validation checks.
 */
export interface OutputValidationFailure {
  readonly status: "rejected";
  /** The extracted packet data, or null if extraction itself failed. */
  readonly packet: Record<string, unknown> | null;
  /** The validation step that caused rejection. */
  readonly reason: OutputRejectionReason;
  /** Detailed error messages explaining the failure. */
  readonly errors: readonly string[];
  /** True if this failure caused the agent profile to be disabled. */
  readonly profileDisabled: boolean;
  /** Current count of consecutive schema failures for this profile. */
  readonly consecutiveFailures: number;
}

/**
 * Discriminated union of validation outcomes.
 */
export type OutputValidationResult = OutputValidationSuccess | OutputValidationFailure;

// ─── Extraction Results ──────────────────────────────────────────────────────

/**
 * Result of packet extraction from raw worker output.
 */
export type ExtractionResult =
  | { readonly status: "found"; readonly packet: unknown; readonly source: "file" | "stdout" }
  | {
      readonly status: "json_parse_error";
      readonly rawContent: string;
      readonly source: "file" | "stdout";
      readonly error: string;
    }
  | { readonly status: "not_found" };

// ─── Infrastructure Ports ────────────────────────────────────────────────────

/**
 * Port for checking whether artifact references resolve to existing files.
 *
 * Worker result packets may include `artifact_refs` pointing to log files,
 * diffs, or other outputs. This port verifies those references are valid.
 *
 * @see docs/prd/008-packet-and-schema-spec.md §8.2.4 — Evidence and Artifacts
 */
export interface ArtifactExistencePort {
  /** Returns true if the artifact at the given path exists and is readable. */
  exists(artifactPath: string): Promise<boolean>;
}

/**
 * Port for tracking consecutive schema validation failures per agent profile.
 *
 * When a profile accumulates too many consecutive failures (default threshold: 3),
 * it should be disabled to prevent wasting resources on a systematically
 * broken prompt/model combination.
 *
 * @see docs/prd/010-integration-contracts.md §10.8 — Copilot CLI Adapter Contract
 */
export interface SchemaFailureTrackerPort {
  /** Get the current consecutive failure count for a profile. */
  getConsecutiveFailures(profileId: string): Promise<number>;
  /** Record a failure and return the new consecutive count. */
  recordFailure(profileId: string): Promise<number>;
  /** Reset the consecutive failure count (e.g., on successful validation). */
  resetFailures(profileId: string): Promise<void>;
}

// ─── Audit Event Port ────────────────────────────────────────────────────────

/**
 * Port for recording schema violation audit events.
 *
 * All validation failures must produce a `schema_violation` audit event
 * for traceability and debugging.
 */
export interface OutputValidationAuditPort {
  /** Persist an audit event for a schema violation or validation failure. */
  recordAuditEvent(event: NewAuditEvent): Promise<AuditEventRecord>;
}

// ─── Service Interface ───────────────────────────────────────────────────────

/**
 * Application-layer service for validating structured worker output.
 *
 * Implements the full validation pipeline specified in PRD 008 §8.14:
 * 1. Extract packet from worker output (file or delimiter-based)
 * 2. Validate against declared schema version
 * 3. Verify all IDs match the orchestrator context
 * 4. Verify referenced artifacts exist
 * 5. Attempt schema repair for minor violations
 * 6. Track consecutive failures per agent profile
 * 7. Record audit events for all failures
 *
 * @see docs/prd/008-packet-and-schema-spec.md §8.14 — Implementation Rule
 * @see docs/backlog/tasks/T046-output-capture-validation.md
 */
export interface OutputValidatorService {
  /**
   * Extract a structured packet from raw worker output.
   *
   * Tries two strategies in order:
   * 1. Parse the designated output file content as JSON
   * 2. Extract delimited JSON from stdout
   *
   * This is a pure function with no side effects.
   */
  extractPacket(source: WorkerOutputSource): ExtractionResult;

  /**
   * Run the full validation pipeline on worker output.
   *
   * Performs extraction, schema validation (with repair attempt),
   * ID matching, artifact verification, failure tracking, and audit recording.
   */
  validateOutput(
    source: WorkerOutputSource,
    context: OutputValidationContext,
  ): Promise<OutputValidationResult>;
}
