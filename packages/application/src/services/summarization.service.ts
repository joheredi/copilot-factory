/**
 * Summarization service — generates bounded retry summaries from failed-run
 * artifacts to provide context for the next retry attempt.
 *
 * This service implements the "generate summarization packets for retries"
 * responsibility from the Artifact Module (PRD §7.11):
 *
 * 1. Reads the DevResultPacket from the failed run (if available)
 * 2. Reads the PartialWorkSnapshot from crash recovery (if available)
 * 3. Extracts key information: what was attempted, what failed, what files changed
 * 4. Generates a bounded-size summary (≤ 2000 characters serialized)
 * 5. Stores the summary as an artifact in the summaries directory
 * 6. Returns the summary for inclusion in `TaskPacket.context.prior_partial_work`
 *
 * All artifact reads are best-effort — missing artifacts produce degraded
 * summaries rather than failures. The summary always includes at least the
 * task/run identification and a note about what information was unavailable.
 *
 * @see docs/prd/007-technical-architecture.md §7.11 — Artifact Module
 * @module @factory/application/services/summarization.service
 */

import { getTracer, SpanStatusCode } from "@factory/observability";

import type {
  FailedRunInfo,
  RetrySummary,
  SummarizationArtifactReaderPort,
  SummarizationArtifactWriterPort,
  SummaryFileChange,
  SummaryValidation,
} from "../ports/summarization.ports.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Maximum total character count for the serialized retry summary JSON.
 * This bound ensures summaries fit comfortably in TaskPacket context
 * without overwhelming retry workers with excessive prior-run data.
 */
export const SUMMARY_CHARACTER_LIMIT = 2000;

/**
 * Maximum number of file changes to include in the summary.
 * Additional files are noted with a count but not individually listed.
 */
const MAX_FILE_CHANGES = 10;

/**
 * Maximum number of validation results to include in the summary.
 * Additional validations are noted with a count but not individually listed.
 */
const MAX_VALIDATIONS = 5;

/**
 * Maximum number of failure points to include in the summary.
 */
const MAX_FAILURE_POINTS = 5;

/**
 * Maximum character length for individual string fields (summaries, failure points).
 */
const MAX_FIELD_LENGTH = 200;

// ─── Service Input/Output Types ─────────────────────────────────────────────

/**
 * Parameters for generating a retry summary from a failed run.
 */
export interface GenerateRetrySummaryParams {
  /** ID of the task being retried. */
  readonly taskId: string;
  /** Repository ID for artifact path construction. */
  readonly repoId: string;
  /** Run ID of the failed attempt to summarize. */
  readonly failedRunId: string;
  /** The attempt number of the failed run (1-based). */
  readonly attemptNumber: number;
}

/**
 * Result of retry summary generation.
 */
export interface GenerateRetrySummaryResult {
  /** The generated retry summary. */
  readonly summary: RetrySummary;
  /** The artifact reference path where the summary was stored. */
  readonly artifactRef: string;
}

/**
 * Summarization service interface.
 *
 * Provides the `generateRetrySummary` operation that condenses failed-run
 * artifacts into a bounded context packet for the next retry attempt.
 */
export interface SummarizationService {
  /**
   * Generate a bounded retry summary from a failed run's artifacts.
   *
   * Reads available artifacts (DevResultPacket, PartialWorkSnapshot),
   * extracts key information, caps the total size, stores the summary
   * as an artifact, and returns it for inclusion in the next TaskPacket.
   *
   * @param params - Parameters identifying the failed run.
   * @returns The generated summary and its artifact reference.
   */
  generateRetrySummary(params: GenerateRetrySummaryParams): Promise<GenerateRetrySummaryResult>;
}

// ─── Dependencies ───────────────────────────────────────────────────────────

/**
 * Dependencies injected into the summarization service.
 */
export interface SummarizationDependencies {
  /** Reads artifacts from failed runs. */
  readonly artifactReader: SummarizationArtifactReaderPort;
  /** Stores the generated summary artifact. */
  readonly artifactWriter: SummarizationArtifactWriterPort;
  /** Clock function for timestamps (injectable for testing). */
  readonly clock?: () => Date;
}

// ─── Tracer ─────────────────────────────────────────────────────────────────

const tracer = getTracer("summarization-service");

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a summarization service with injected dependencies.
 *
 * @param deps - All required dependencies for artifact reading/writing.
 * @returns A SummarizationService instance.
 *
 * @see docs/prd/007-technical-architecture.md §7.11 — Artifact Module
 */
export function createSummarizationService(deps: SummarizationDependencies): SummarizationService {
  const { artifactReader, artifactWriter, clock = () => new Date() } = deps;

  return {
    async generateRetrySummary(
      params: GenerateRetrySummaryParams,
    ): Promise<GenerateRetrySummaryResult> {
      return tracer.startActiveSpan("summarization.generateRetrySummary", async (span) => {
        const { taskId, repoId, failedRunId, attemptNumber } = params;

        span.setAttribute("task.id", taskId);
        span.setAttribute("run.id", failedRunId);
        span.setAttribute("attempt.number", attemptNumber);

        try {
          // ── Step 1: Read available artifacts (best-effort) ──
          const [failedRunInfo, partialWork] = await Promise.all([
            safeAsync(() => artifactReader.readFailedRunInfo(repoId, taskId, failedRunId)),
            safeAsync(() => artifactReader.readPartialWorkSnapshot(repoId, taskId, failedRunId)),
          ]);

          span.setAttribute("has.result_packet", failedRunInfo !== null);
          span.setAttribute("has.partial_work", partialWork !== null);

          // ── Step 2: Extract and merge information from both sources ──
          const filesChanged = extractFilesChanged(failedRunInfo, partialWork);
          const validationsRun = extractValidations(failedRunInfo);
          const failurePoints = extractFailurePoints(failedRunInfo, partialWork);
          const failedRunStatus = failedRunInfo?.status ?? "unknown";
          const failureSummary = buildFailureSummary(failedRunInfo, partialWork);

          // ── Step 3: Build artifact reference paths ──
          const fullResultRef =
            failedRunInfo !== null
              ? `repositories/${repoId}/tasks/${taskId}/runs/${failedRunId}/outputs/dev-result-packet.json`
              : null;
          const partialWorkRef =
            partialWork !== null
              ? `repositories/${repoId}/tasks/${taskId}/summaries/partial-work-${failedRunId}.json`
              : null;

          const summaryFilename = `retry-summary-run-${failedRunId}.json`;

          // ── Step 4: Assemble the summary (pre-truncation) ──
          const summaryArtifactRef = `repositories/${repoId}/tasks/${taskId}/summaries/${summaryFilename}`;

          let summary: RetrySummary = {
            summary_type: "retry_summary",
            schema_version: "1.0",
            generatedAt: clock().toISOString(),
            taskId,
            failedRunId,
            attemptNumber,
            failedRunStatus,
            failureSummary,
            filesChanged,
            validationsRun,
            failurePoints,
            fullResultRef,
            partialWorkRef,
            summaryArtifactRef,
            characterCount: 0,
          };

          // ── Step 5: Enforce character limit ──
          summary = enforceCharacterLimit(summary);

          span.setAttribute("summary.character_count", summary.characterCount);
          span.setAttribute("summary.files_changed_count", summary.filesChanged.length);
          span.setAttribute("summary.failure_points_count", summary.failurePoints.length);

          // ── Step 6: Store the summary as an artifact ──
          const serialized = JSON.stringify(summary, null, 2);
          const artifactRef = await artifactWriter.storeSummary(
            repoId,
            taskId,
            summaryFilename,
            serialized,
          );

          span.setStatus({ code: SpanStatusCode.OK });

          return { summary, artifactRef };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          span.setStatus({ code: SpanStatusCode.ERROR, message });
          throw error;
        } finally {
          span.end();
        }
      });
    },
  };
}

// ─── Extraction Helpers ─────────────────────────────────────────────────────

/**
 * Extract file changes from the failed run info and/or partial work snapshot.
 * Prefers the DevResultPacket data (more structured) but falls back to
 * partial work snapshot's modified files list.
 */
export function extractFilesChanged(
  runInfo: FailedRunInfo | null,
  partialWork: { readonly modifiedFiles: readonly string[] } | null,
): readonly SummaryFileChange[] {
  if (runInfo !== null && runInfo.filesChanged.length > 0) {
    return runInfo.filesChanged.slice(0, MAX_FILE_CHANGES);
  }

  if (partialWork !== null && partialWork.modifiedFiles.length > 0) {
    return partialWork.modifiedFiles.slice(0, MAX_FILE_CHANGES).map((path) => ({
      path,
      changeType: "modified",
    }));
  }

  return [];
}

/**
 * Extract validation results from the failed run info.
 * Only failed and skipped validations are prioritized since they are
 * most useful for the retry worker.
 */
export function extractValidations(runInfo: FailedRunInfo | null): readonly SummaryValidation[] {
  if (runInfo === null) {
    return [];
  }

  const sorted = [...runInfo.validationsRun].sort((a, b) => {
    const order: Record<string, number> = { failed: 0, skipped: 1, passed: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3);
  });

  return sorted.slice(0, MAX_VALIDATIONS).map((v) => ({
    checkType: v.checkType,
    status: v.status,
    summary: truncate(v.summary, MAX_FIELD_LENGTH),
  }));
}

/**
 * Extract key failure points from available sources.
 * Combines unresolved issues, risks, and partial work indicators
 * into a single prioritized list of failure descriptions.
 */
export function extractFailurePoints(
  runInfo: FailedRunInfo | null,
  partialWork: { readonly modifiedFiles: readonly string[] } | null,
): readonly string[] {
  const points: string[] = [];

  if (runInfo !== null) {
    for (const issue of runInfo.unresolvedIssues.slice(0, MAX_FAILURE_POINTS)) {
      points.push(truncate(issue, MAX_FIELD_LENGTH));
    }
    for (const risk of runInfo.risks.slice(0, Math.max(0, MAX_FAILURE_POINTS - points.length))) {
      points.push(truncate(`Risk: ${risk}`, MAX_FIELD_LENGTH));
    }
  }

  if (points.length === 0 && partialWork !== null) {
    points.push(
      "Worker crashed or timed out before producing a result packet. " +
        `${String(partialWork.modifiedFiles.length)} file(s) were modified before failure.`,
    );
  }

  if (points.length === 0) {
    points.push("No detailed failure information available from the failed run.");
  }

  return points.slice(0, MAX_FAILURE_POINTS);
}

/**
 * Build a concise human-readable failure summary string.
 */
export function buildFailureSummary(
  runInfo: FailedRunInfo | null,
  partialWork: { readonly modifiedFiles: readonly string[] } | null,
): string {
  if (runInfo?.resultSummary) {
    return truncate(runInfo.resultSummary, MAX_FIELD_LENGTH);
  }

  if (partialWork !== null) {
    return truncate(
      `Worker crashed/timed out. ${String(partialWork.modifiedFiles.length)} file(s) modified before failure.`,
      MAX_FIELD_LENGTH,
    );
  }

  return "Failed run produced no result packet or partial work snapshot.";
}

/**
 * Enforce the character limit on a retry summary by progressively
 * truncating less-critical fields until the serialized size fits.
 *
 * Truncation priority (least important first):
 * 1. Reduce file changes list
 * 2. Reduce validation results list
 * 3. Reduce failure points list
 * 4. Truncate failure summary
 */
export function enforceCharacterLimit(summary: RetrySummary): RetrySummary {
  let current = { ...summary };
  let serialized = JSON.stringify(current, null, 2);

  if (serialized.length <= SUMMARY_CHARACTER_LIMIT) {
    return { ...current, characterCount: serialized.length };
  }

  // Round 1: Reduce file changes
  if (current.filesChanged.length > 3) {
    const truncatedFiles = current.filesChanged.slice(0, 3);
    current = { ...current, filesChanged: truncatedFiles };
    serialized = JSON.stringify(current, null, 2);
    if (serialized.length <= SUMMARY_CHARACTER_LIMIT) {
      return { ...current, characterCount: serialized.length };
    }
  }

  // Round 2: Reduce validations
  if (current.validationsRun.length > 2) {
    const truncatedValidations = current.validationsRun.slice(0, 2);
    current = { ...current, validationsRun: truncatedValidations };
    serialized = JSON.stringify(current, null, 2);
    if (serialized.length <= SUMMARY_CHARACTER_LIMIT) {
      return { ...current, characterCount: serialized.length };
    }
  }

  // Round 3: Reduce failure points
  if (current.failurePoints.length > 1) {
    current = { ...current, failurePoints: current.failurePoints.slice(0, 1) };
    serialized = JSON.stringify(current, null, 2);
    if (serialized.length <= SUMMARY_CHARACTER_LIMIT) {
      return { ...current, characterCount: serialized.length };
    }
  }

  // Round 4: Remove file changes entirely
  current = { ...current, filesChanged: [] };
  serialized = JSON.stringify(current, null, 2);
  if (serialized.length <= SUMMARY_CHARACTER_LIMIT) {
    return { ...current, characterCount: serialized.length };
  }

  // Round 5: Remove validations entirely
  current = { ...current, validationsRun: [] };
  serialized = JSON.stringify(current, null, 2);
  if (serialized.length <= SUMMARY_CHARACTER_LIMIT) {
    return { ...current, characterCount: serialized.length };
  }

  // Round 6: Aggressively truncate remaining text fields
  current = {
    ...current,
    failureSummary: truncate(current.failureSummary, 100),
    failurePoints: current.failurePoints.map((p) => truncate(p, 80)),
  };
  serialized = JSON.stringify(current, null, 2);

  return { ...current, characterCount: serialized.length };
}

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Truncate a string to a maximum length, appending "…" if truncated.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + "…";
}

/**
 * Execute an async operation, returning null on any error.
 * Used for best-effort artifact reads where missing data is acceptable.
 */
async function safeAsync<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}
