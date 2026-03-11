/**
 * Rework context service — assembles a {@link RejectionContext} for tasks
 * that have been rejected via `CHANGES_REQUESTED` during lead review.
 *
 * When a task enters the `CHANGES_REQUESTED` state, it will eventually be
 * re-scheduled for another development attempt. The next {@link TaskPacket}
 * must include a `context.rejection_context` field (per PRD §8.12) so the
 * developer knows exactly what blocking issues to address.
 *
 * This service reads the persisted lead review decision, specialist review
 * packets, and prior dev result to assemble a complete RejectionContext:
 *
 * 1. Finds the most recently rejected review cycle for the task
 * 2. Reads the lead review decision to get the summary and blocking issues
 * 3. Merges blocking issues from specialist review packets
 * 4. Optionally includes unresolved issues from the prior dev result
 * 5. Validates the assembled context against {@link RejectionContextSchema}
 *
 * The assembled RejectionContext is derived entirely from already-persisted
 * data (LeadReviewDecision records and specialist ReviewPackets), so no
 * additional storage is required.
 *
 * @see docs/prd/008-packet-and-schema-spec.md §8.12 — RejectionContext
 * @see docs/prd/002-data-model.md §2.5 — Rework and Review Round Rules
 * @see docs/backlog/tasks/T062-rework-loop.md
 *
 * @module @factory/application/services/rework-context
 */

import { RejectionContextSchema } from "@factory/schemas";
import type { RejectionContext, Issue } from "@factory/schemas";

import { EntityNotFoundError } from "../errors.js";
import type {
  ReworkContextUnitOfWork,
  ReworkContextTransactionRepositories,
  ReworkLeadReviewDecision,
  ReworkSpecialistPacket,
  ReworkDevResult,
} from "../ports/rework-context.ports.js";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

/**
 * Parameters for building a rejection context.
 *
 * The caller may provide an explicit review cycle ID (when known),
 * or omit it to have the service find the most recently rejected
 * cycle for the task.
 */
export interface BuildRejectionContextParams {
  /** The task that was rejected. */
  readonly taskId: string;

  /**
   * The review cycle that produced the rejection.
   * If omitted, the service finds the latest rejected cycle.
   */
  readonly reviewCycleId?: string;
}

/**
 * Result of a successful rejection context assembly.
 *
 * Contains the validated RejectionContext ready for inclusion in
 * a TaskPacket's `context.rejection_context` field, along with
 * metadata about how it was assembled.
 */
export interface BuildRejectionContextResult {
  /** The assembled and validated RejectionContext. */
  readonly rejectionContext: RejectionContext;

  /** The review cycle ID from which the context was assembled. */
  readonly reviewCycleId: string;

  /** Unresolved issues from the prior dev result, if available. */
  readonly priorUnresolvedIssues: readonly string[];
}

/**
 * The rework context service interface.
 *
 * Exposes methods for assembling rejection context from persisted
 * review data for inclusion in rework TaskPackets.
 */
export interface ReworkContextService {
  /**
   * Build a RejectionContext for a task that received `changes_requested`.
   *
   * Assembles the context from the lead review decision and specialist
   * review packets of the rejected review cycle. Validates the result
   * against the RejectionContext schema.
   *
   * @param params - The assembly parameters
   * @returns The assembled rejection context with metadata
   * @throws {EntityNotFoundError} if the task, review cycle, or decision is not found
   * @throws {RejectionContextAssemblyError} if the context cannot be assembled
   */
  buildRejectionContext(params: BuildRejectionContextParams): BuildRejectionContextResult;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into the rework context service factory.
 */
export interface ReworkContextDependencies {
  /** Unit of work for consistent reads across multiple repositories. */
  readonly unitOfWork: ReworkContextUnitOfWork;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the rejection context cannot be assembled from the
 * available data (e.g., no blocking issues found, schema validation fails).
 */
export class RejectionContextAssemblyError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly reviewCycleId: string,
    reason: string,
  ) {
    super(
      `Failed to assemble RejectionContext for task "${taskId}" ` +
        `from review cycle "${reviewCycleId}": ${reason}`,
    );
    this.name = "RejectionContextAssemblyError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extracts blocking issues from a lead review decision packet JSON.
 *
 * The packet is stored as `unknown` in the database. This function
 * safely extracts the `blocking_issues` array, falling back to an
 * empty array if the structure is unexpected.
 */
function extractBlockingIssuesFromDecision(decision: ReworkLeadReviewDecision): readonly Issue[] {
  const packet = decision.packetJson;
  if (typeof packet === "object" && packet !== null && "blocking_issues" in packet) {
    const obj = packet as Record<string, unknown>;
    const issues = obj["blocking_issues"];
    if (Array.isArray(issues)) {
      return issues as Issue[];
    }
  }
  return [];
}

/**
 * Extracts the decision summary from the lead review decision.
 *
 * Falls back to the `summary` field stored on the decision record
 * if the packet JSON doesn't contain a summary.
 */
function extractDecisionSummary(decision: ReworkLeadReviewDecision): string {
  const packet = decision.packetJson;
  if (typeof packet === "object" && packet !== null && "summary" in packet) {
    const obj = packet as Record<string, unknown>;
    const summary = obj["summary"];
    if (typeof summary === "string") {
      return summary;
    }
  }
  return decision.summary;
}

/**
 * Extracts blocking issues from specialist review packets.
 *
 * Iterates through all specialist packets for the review cycle and
 * collects issues marked as blocking. Issues from different specialists
 * are concatenated; deduplication is left to the lead reviewer.
 */
function extractBlockingIssuesFromSpecialists(
  packets: readonly ReworkSpecialistPacket[],
): readonly Issue[] {
  const issues: Issue[] = [];

  for (const packet of packets) {
    const json = packet.packetJson;
    if (typeof json === "object" && json !== null && "blocking_issues" in json) {
      const obj = json as Record<string, unknown>;
      const blockingArr = obj["blocking_issues"];
      if (Array.isArray(blockingArr)) {
        for (const issue of blockingArr as Issue[]) {
          issues.push(issue);
        }
      }
    }
  }

  return issues;
}

/**
 * Extracts unresolved issues from a dev result packet.
 *
 * The `result.unresolved_issues` field is an array of strings
 * describing issues the developer flagged but did not resolve.
 */
function extractUnresolvedIssues(devResult: ReworkDevResult | undefined): readonly string[] {
  if (!devResult) {
    return [];
  }

  const json = devResult.packetJson;
  if (typeof json === "object" && json !== null && "result" in json) {
    const outer = json as Record<string, unknown>;
    const resultObj = outer["result"];
    if (typeof resultObj === "object" && resultObj !== null) {
      const inner = resultObj as Record<string, unknown>;
      if ("unresolved_issues" in inner) {
        const unresolvedArr = inner["unresolved_issues"];
        if (Array.isArray(unresolvedArr)) {
          return unresolvedArr as string[];
        }
      }
    }
  }

  return [];
}

/**
 * Merges blocking issues from the lead decision and specialists.
 *
 * The lead review decision packet typically contains a consolidated
 * list of blocking issues. Specialist packets contain the original
 * issues per reviewer. We use the lead decision's blocking issues
 * as the primary source (since the lead may have deduplicated or
 * re-prioritized), and fall back to specialist issues if the lead
 * decision has none.
 */
function mergeBlockingIssues(
  leadIssues: readonly Issue[],
  specialistIssues: readonly Issue[],
): readonly Issue[] {
  // The lead reviewer's consolidated blocking issues take precedence
  if (leadIssues.length > 0) {
    return leadIssues;
  }

  // Fall back to specialist issues if lead didn't include any
  // (this shouldn't happen per PRD constraints, but handle defensively)
  return specialistIssues;
}

// ---------------------------------------------------------------------------
// Core assembly logic
// ---------------------------------------------------------------------------

/**
 * Assembles a RejectionContext within a transaction.
 *
 * This function is extracted for testability — it contains all reads
 * that must be consistent.
 */
function assembleInTransaction(
  repos: ReworkContextTransactionRepositories,
  params: BuildRejectionContextParams,
): {
  readonly rejectionContext: RejectionContext;
  readonly reviewCycleId: string;
  readonly priorUnresolvedIssues: readonly string[];
} {
  // ── 1. Find the task ────────────────────────────────────────────
  const task = repos.task.findById(params.taskId);
  if (!task) {
    throw new EntityNotFoundError("Task", params.taskId);
  }

  // ── 2. Find the rejected review cycle ───────────────────────────
  let reviewCycleId: string;
  if (params.reviewCycleId) {
    // Explicit cycle ID provided — verify it exists and belongs to the task
    const cycle = repos.reviewCycle.findById(params.reviewCycleId);
    if (!cycle) {
      throw new EntityNotFoundError("ReviewCycle", params.reviewCycleId);
    }
    if (cycle.taskId !== params.taskId) {
      throw new EntityNotFoundError(
        "ReviewCycle",
        `${params.reviewCycleId} (not associated with task ${params.taskId})`,
      );
    }
    reviewCycleId = params.reviewCycleId;
  } else {
    // Find the most recently rejected cycle
    const latestRejected = repos.reviewCycle.findLatestRejectedByTaskId(params.taskId);
    if (!latestRejected) {
      throw new EntityNotFoundError(
        "ReviewCycle",
        `latest rejected cycle for task ${params.taskId}`,
      );
    }
    reviewCycleId = latestRejected.reviewCycleId;
  }

  // ── 3. Read the lead review decision ────────────────────────────
  const leadDecision = repos.leadReviewDecision.findByReviewCycleId(reviewCycleId);
  if (!leadDecision) {
    throw new EntityNotFoundError(
      "LeadReviewDecision",
      `decision for review cycle ${reviewCycleId}`,
    );
  }

  // ── 4. Extract blocking issues from lead decision ───────────────
  const leadBlockingIssues = extractBlockingIssuesFromDecision(leadDecision);

  // ── 5. Extract blocking issues from specialist packets ──────────
  const specialistPackets = repos.specialistPacket.findByReviewCycleId(reviewCycleId);
  const specialistBlockingIssues = extractBlockingIssuesFromSpecialists(specialistPackets);

  // ── 6. Merge blocking issues ────────────────────────────────────
  const mergedBlockingIssues = mergeBlockingIssues(leadBlockingIssues, specialistBlockingIssues);

  // ── 7. Extract lead decision summary ────────────────────────────
  const leadDecisionSummary = extractDecisionSummary(leadDecision);

  // ── 8. Extract unresolved issues from prior dev result ──────────
  const latestDevResult = repos.devResult.findLatestByTaskId(params.taskId);
  const priorUnresolvedIssues = extractUnresolvedIssues(latestDevResult);

  // ── 9. Assemble the RejectionContext ────────────────────────────
  const rawContext = {
    prior_review_cycle_id: reviewCycleId,
    blocking_issues: mergedBlockingIssues,
    lead_decision_summary: leadDecisionSummary,
  };

  // ── 10. Validate against RejectionContextSchema ─────────────────
  const parseResult = RejectionContextSchema.safeParse(rawContext);
  if (!parseResult.success) {
    throw new RejectionContextAssemblyError(
      params.taskId,
      reviewCycleId,
      `Schema validation failed: ${parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }

  return {
    rejectionContext: parseResult.data,
    reviewCycleId,
    priorUnresolvedIssues,
  };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

/**
 * Creates a ReworkContextService instance.
 *
 * The service assembles RejectionContext objects from persisted review
 * data for inclusion in rework TaskPackets. All data reads occur within
 * a single transaction for consistency.
 *
 * @param deps - Injected dependencies
 * @returns A ReworkContextService instance
 *
 * @example
 * ```ts
 * const service = createReworkContextService({ unitOfWork });
 *
 * // Build rejection context for a task in CHANGES_REQUESTED state
 * const result = service.buildRejectionContext({
 *   taskId: "task-123",
 *   reviewCycleId: "review-1",
 * });
 *
 * // result.rejectionContext can be set on TaskPacket.context.rejection_context
 * // result.priorUnresolvedIssues can inform the new TaskPacket context
 * ```
 *
 * @example
 * ```ts
 * // Auto-discover the latest rejected cycle
 * const result = service.buildRejectionContext({
 *   taskId: "task-123",
 * });
 * ```
 */
export function createReworkContextService(deps: ReworkContextDependencies): ReworkContextService {
  const { unitOfWork } = deps;

  return {
    buildRejectionContext(params: BuildRejectionContextParams): BuildRejectionContextResult {
      return unitOfWork.runInTransaction((repos) => assembleInTransaction(repos, params));
    },
  };
}
