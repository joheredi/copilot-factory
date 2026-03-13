/**
 * @module worker-runtime/types
 *
 * Core types for the worker runtime adapter contract.
 *
 * These types define the inputs, outputs, and intermediate structures used by
 * {@link WorkerRuntime} adapters. They are designed to be adapter-agnostic so
 * that different execution backends (Copilot CLI, local LLM, remote API, or
 * deterministic validators) can all satisfy the same contract.
 *
 * @see docs/prd/010-integration-contracts.md §10.8
 * @see docs/prd/007-technical-architecture.md §7.9
 */

import type { TaskPacket } from "@factory/schemas";
import type { PolicySnapshot } from "@factory/schemas";

// ─── Run Status ──────────────────────────────────────────────────────────────

/**
 * Terminal status of a completed worker run.
 *
 * - `success` — The worker produced a valid result packet and all stop
 *   conditions were met.
 * - `failed` — The worker exited with an error or produced invalid output.
 * - `partial` — The worker produced some useful output but did not fully
 *   complete (e.g., timed out after making progress).
 * - `cancelled` — The run was explicitly cancelled before completion.
 */
export type RunStatus = "success" | "failed" | "partial" | "cancelled";

// ─── Workspace Paths ─────────────────────────────────────────────────────────

/**
 * Filesystem paths available to the worker during execution.
 *
 * These paths are provisioned by the Workspace Manager before the run starts
 * and are passed through {@link RunContext} so that adapters know where to
 * mount inputs and collect outputs.
 */
export interface WorkspacePaths {
  /** Absolute path to the git worktree provisioned for this task. */
  readonly worktreePath: string;

  /** Absolute path to the directory where output artifacts should be written. */
  readonly artifactRoot: string;

  /** Absolute path where the serialized task packet is mounted for the worker. */
  readonly packetInputPath: string;

  /** Absolute path where the serialized policy snapshot is mounted for the worker. */
  readonly policySnapshotPath: string;
}

// ─── Timeout Settings ────────────────────────────────────────────────────────

/**
 * Time-related constraints for a worker run.
 *
 * These values come from the task packet and the resolved lease/policy
 * configuration. Adapters must enforce these limits and emit appropriate
 * events when thresholds are approached or exceeded.
 */
export interface TimeoutSettings {
  /** Maximum wall-clock seconds the worker is allowed to run. */
  readonly timeBudgetSeconds: number;

  /** Absolute ISO 8601 timestamp after which the run must be terminated. */
  readonly expiresAt: string;

  /** Interval in seconds at which the worker should emit heartbeats. */
  readonly heartbeatIntervalSeconds: number;

  /** Number of consecutive missed heartbeats before the run is considered stale. */
  readonly missedHeartbeatThreshold: number;

  /** Additional grace period in seconds after missed heartbeat threshold is reached. */
  readonly gracePeriodSeconds: number;
}

// ─── Output Schema Expectation ───────────────────────────────────────────────

/**
 * Describes the expected structured output from the worker.
 *
 * The adapter must validate that the worker's final output packet matches
 * this expectation. If the packet is missing or schema-invalid, the run
 * must be rejected (PRD 010 §10.8.5).
 */
export interface OutputSchemaExpectation {
  /** Expected packet type (e.g., "dev_result_packet", "review_packet"). */
  readonly packetType: string;

  /** Expected schema version (e.g., "1.0"). */
  readonly schemaVersion: string;
}

// ─── Run Context ─────────────────────────────────────────────────────────────

/**
 * Complete execution context provided to a worker runtime adapter.
 *
 * Contains everything the adapter needs to set up, execute, and validate
 * a worker run. This is an immutable snapshot captured at dispatch time
 * for reproducibility and auditability.
 *
 * @see docs/prd/010-integration-contracts.md §10.8.3
 */
export interface RunContext {
  /** The task packet describing what the worker should do. */
  readonly taskPacket: TaskPacket;

  /** The resolved effective policy snapshot captured at dispatch time. */
  readonly effectivePolicySnapshot: PolicySnapshot;

  /** Filesystem paths provisioned for this run. */
  readonly workspacePaths: WorkspacePaths;

  /** Describes the expected structured output packet type and version. */
  readonly outputSchemaExpectation: OutputSchemaExpectation;

  /** Time-related constraints for this run. */
  readonly timeoutSettings: TimeoutSettings;

  /**
   * Optional custom prompt template text resolved from the agent profile's
   * linked prompt template. When provided, overrides the hardcoded
   * role-specific prompt in the adapter. When absent, the adapter falls
   * back to its built-in ROLE_PROMPTS.
   */
  readonly customPrompt?: string;
}

// ─── Prepared Run ────────────────────────────────────────────────────────────

/**
 * Result of preparing a worker run environment.
 *
 * Returned by {@link WorkerRuntime.prepareRun} after the workspace has been
 * set up, inputs mounted, and the execution environment validated. The
 * `runId` is the unique identifier used for all subsequent operations on
 * this run.
 */
export interface PreparedRun {
  /** Unique identifier for this run, generated by the adapter. */
  readonly runId: string;

  /** The context that was used to prepare this run. */
  readonly context: RunContext;

  /** ISO 8601 timestamp when preparation completed. */
  readonly preparedAt: string;
}

// ─── Run Output Stream ───────────────────────────────────────────────────────

/**
 * A single output event from a running worker.
 *
 * Emitted by {@link WorkerRuntime.streamRun} as the worker executes.
 * Consumers can use these events for live logging, heartbeat tracking,
 * and progress monitoring.
 */
export interface RunOutputStream {
  /** The type of output event. */
  readonly type: "stdout" | "stderr" | "system" | "heartbeat";

  /** The content of the output event. Empty string for heartbeats. */
  readonly content: string;

  /** ISO 8601 timestamp when this event was captured. */
  readonly timestamp: string;
}

// ─── Run Log Entry ───────────────────────────────────────────────────────────

/**
 * A persisted log entry from a completed worker run.
 *
 * These are collected after the run completes and included in the
 * {@link RunResult} for audit and debugging purposes.
 */
export interface RunLogEntry {
  /** ISO 8601 timestamp of the log entry. */
  readonly timestamp: string;

  /** Which output stream produced this entry. */
  readonly stream: "stdout" | "stderr" | "system";

  /** The log content. */
  readonly content: string;
}

// ─── Cancel Result ───────────────────────────────────────────────────────────

/**
 * Result of attempting to cancel a running worker.
 */
export interface CancelResult {
  /** Whether the cancellation was successfully initiated. */
  readonly cancelled: boolean;

  /** Human-readable reason if cancellation could not be performed. */
  readonly reason?: string;
}

// ─── Collected Artifacts ─────────────────────────────────────────────────────

/**
 * Artifacts collected from a completed or partially-completed worker run.
 *
 * Returned by {@link WorkerRuntime.collectArtifacts} after the worker has
 * finished (or been cancelled/timed out). The adapter is responsible for
 * gathering all output files from the workspace.
 */
export interface CollectedArtifacts {
  /**
   * The structured output packet emitted by the worker, if any.
   * This is the raw parsed JSON — validation against the expected schema
   * is performed by the adapter before accepting the run as successful.
   * `null` if the worker did not produce a valid output packet.
   */
  readonly packetOutput: unknown;

  /** Whether the output packet was present and passed schema validation. */
  readonly packetValid: boolean;

  /** Absolute paths to all artifact files produced by the worker. */
  readonly artifactPaths: readonly string[];

  /** Validation errors if the packet was invalid, empty array otherwise. */
  readonly validationErrors: readonly string[];
}

// ─── Finalize Result ─────────────────────────────────────────────────────────

/**
 * Final result of a worker run after cleanup.
 *
 * Returned by {@link WorkerRuntime.finalizeRun} as the terminal output of the
 * entire run lifecycle. Contains the run status, all collected artifacts,
 * logs, and timing information.
 */
export interface FinalizeResult {
  /** Unique identifier of the finalized run. */
  readonly runId: string;

  /** Terminal status of the run. */
  readonly status: RunStatus;

  /**
   * The structured output packet, if the worker produced a valid one.
   * `null` for failed or cancelled runs that produced no output.
   */
  readonly packetOutput: unknown;

  /** Absolute paths to all artifact files produced by the worker. */
  readonly artifactPaths: readonly string[];

  /** Collected log entries from the run, ordered chronologically. */
  readonly logs: readonly RunLogEntry[];

  /** Process exit code, or `null` if the process was never started or was killed. */
  readonly exitCode: number | null;

  /** Total wall-clock duration of the run in milliseconds. */
  readonly durationMs: number;

  /** ISO 8601 timestamp when the run was finalized. */
  readonly finalizedAt: string;
}
