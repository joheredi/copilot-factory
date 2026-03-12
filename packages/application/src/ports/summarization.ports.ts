/**
 * Summarization service port interfaces.
 *
 * These interfaces define the contracts for reading failed-run artifacts
 * and generating bounded retry summaries. The summarization service uses
 * these ports to:
 *
 * 1. Read the DevResultPacket from a failed run to extract failure details
 * 2. Read the PartialWorkSnapshot from crash recovery (if available)
 * 3. Read validation results from the failed run
 * 4. Store the generated summary as an artifact
 *
 * @see docs/prd/007-technical-architecture.md §7.11 — Artifact Module responsibilities
 * @module @factory/application/ports/summarization.ports
 */

// ─── Retry Summary ──────────────────────────────────────────────────────────

/**
 * A bounded-size summary of a failed run intended for inclusion in the
 * next retry attempt's TaskPacket `context.prior_partial_work`.
 *
 * This gives the retry worker enough context to understand what was attempted
 * and what failed, without overwhelming it with full logs. Full artifacts
 * remain accessible via the reference paths for detailed inspection.
 *
 * @see docs/prd/007-technical-architecture.md §7.11 — Artifact Module
 */
export interface RetrySummary {
  /** Fixed type discriminator for deserialization. */
  readonly summary_type: "retry_summary";
  /** Schema version for forward compatibility. */
  readonly schema_version: "1.0";
  /** ISO 8601 timestamp of when the summary was generated. */
  readonly generatedAt: string;
  /** The task ID this summary pertains to. */
  readonly taskId: string;
  /** The run ID of the failed attempt being summarized. */
  readonly failedRunId: string;
  /** The attempt number of the failed run (1-based). */
  readonly attemptNumber: number;
  /** High-level outcome of the failed run (e.g. "failed", "partial", "blocked"). */
  readonly failedRunStatus: string;
  /** Brief human-readable description of what happened. */
  readonly failureSummary: string;
  /** Files that were modified during the failed attempt. */
  readonly filesChanged: readonly SummaryFileChange[];
  /** Validation checks that were executed and their outcomes. */
  readonly validationsRun: readonly SummaryValidation[];
  /** Key failure points extracted from the result or crash recovery. */
  readonly failurePoints: readonly string[];
  /** Artifact reference path to the full DevResultPacket (if available). */
  readonly fullResultRef: string | null;
  /** Artifact reference path to the PartialWorkSnapshot (if available). */
  readonly partialWorkRef: string | null;
  /** Artifact reference path to this summary itself. */
  readonly summaryArtifactRef: string;
  /**
   * Total character count of the serialized summary.
   * Always ≤ {@link SUMMARY_CHARACTER_LIMIT}.
   */
  readonly characterCount: number;
}

/**
 * Abbreviated file change entry for inclusion in the retry summary.
 */
export interface SummaryFileChange {
  /** Repository-relative file path. */
  readonly path: string;
  /** Type of change: added, modified, deleted, renamed. */
  readonly changeType: string;
}

/**
 * Abbreviated validation result for inclusion in the retry summary.
 */
export interface SummaryValidation {
  /** Type of check: test, lint, build, typecheck, etc. */
  readonly checkType: string;
  /** Outcome: passed, failed, skipped. */
  readonly status: string;
  /** Brief description of the result. */
  readonly summary: string;
}

// ─── Failed Run Info ────────────────────────────────────────────────────────

/**
 * Information about a failed run extracted from stored artifacts.
 * This is what the summarization service reads to generate the summary.
 */
export interface FailedRunInfo {
  /** The run's result status (from DevResultPacket or crash recovery). */
  readonly status: string;
  /** Human-readable summary from the DevResultPacket (if available). */
  readonly resultSummary: string | null;
  /** Files changed during the run (from DevResultPacket.result.files_changed). */
  readonly filesChanged: readonly SummaryFileChange[];
  /** Validations executed during the run (from DevResultPacket.result.validations_run). */
  readonly validationsRun: readonly SummaryValidation[];
  /** Unresolved issues noted in the result (from DevResultPacket.result.unresolved_issues). */
  readonly unresolvedIssues: readonly string[];
  /** Risk notes from the result (from DevResultPacket.result.risks). */
  readonly risks: readonly string[];
}

// ─── Artifact Reader Port ───────────────────────────────────────────────────

/**
 * Port for reading artifacts from a failed run.
 *
 * Implementations resolve artifact references to actual content. All
 * operations are best-effort — missing artifacts return null rather than
 * throwing, since the failed run may not have produced all expected outputs.
 */
export interface SummarizationArtifactReaderPort {
  /**
   * Read the DevResultPacket for a specific run.
   *
   * @param repoId - Repository ID.
   * @param taskId - Task ID.
   * @param runId - Run ID of the failed attempt.
   * @returns Parsed FailedRunInfo extracted from the result packet, or null if not found.
   */
  readFailedRunInfo(repoId: string, taskId: string, runId: string): Promise<FailedRunInfo | null>;

  /**
   * Read the PartialWorkSnapshot captured during crash recovery.
   *
   * @param repoId - Repository ID.
   * @param taskId - Task ID.
   * @param runId - Run ID of the failed attempt.
   * @returns The partial work snapshot, or null if crash recovery didn't capture one.
   */
  readPartialWorkSnapshot(
    repoId: string,
    taskId: string,
    runId: string,
  ): Promise<PartialWorkSnapshot | null>;
}

/**
 * Minimal PartialWorkSnapshot fields needed by the summarization service.
 * Re-declared here to avoid coupling to the full crash-recovery ports.
 */
export interface PartialWorkSnapshot {
  /** ISO 8601 timestamp of when the snapshot was captured. */
  readonly capturedAt: string;
  /** List of files that were modified in the workspace. */
  readonly modifiedFiles: readonly string[];
  /** Artifact reference path to the stored git diff output. */
  readonly gitDiffRef: string | null;
  /** Artifact reference paths for any partial output files. */
  readonly partialOutputRefs: readonly string[];
}

// ─── Artifact Writer Port ───────────────────────────────────────────────────

/**
 * Port for storing the generated retry summary as an artifact.
 */
export interface SummarizationArtifactWriterPort {
  /**
   * Store the retry summary as a JSON artifact.
   *
   * Uses the §7.11 summaries directory: `repositories/{repoId}/tasks/{taskId}/summaries/`
   *
   * @param repoId - Repository ID.
   * @param taskId - Task ID.
   * @param filename - Filename for the summary (e.g. "retry-summary-run-{runId}.json").
   * @param content - Serialized summary content.
   * @returns The artifact reference path (relative to artifact root).
   */
  storeSummary(repoId: string, taskId: string, filename: string, content: string): Promise<string>;
}
