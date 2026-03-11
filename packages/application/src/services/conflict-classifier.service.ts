/**
 * Conflict classifier service — determines whether a merge conflict is
 * reworkable (developer can fix) or non-reworkable (irrecoverable).
 *
 * Implements the classification rules from PRD §10.10.2:
 * - If the number of conflict files meets or exceeds {@link MergeConflictPolicy.maxConflictFiles},
 *   the conflict is non-reworkable.
 * - If any conflict file matches a protected path pattern from
 *   {@link MergeConflictPolicy.protectedPaths}, the conflict is non-reworkable.
 * - Otherwise, the conflict is reworkable.
 *
 * Protected path matching uses picomatch glob patterns with `dot: true` so
 * that paths starting with "." (e.g., `.github/`) are matched correctly.
 * Patterns ending with "/" are treated as directory prefixes (e.g., ".github/"
 * matches any file under the .github directory).
 *
 * @see docs/prd/010-integration-contracts.md §10.10.2 — Merge Conflict Classification
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.11.5 — Merge Strategy Policy
 * @see T066 — Implement merge conflict classification
 * @module @factory/application/services/conflict-classifier.service
 */

import picomatch from "picomatch";

import type {
  ConflictClassification,
  ConflictClassifierPort,
} from "../ports/merge-executor.ports.js";

// ---------------------------------------------------------------------------
// Policy configuration
// ---------------------------------------------------------------------------

/**
 * Merge conflict classification policy thresholds.
 *
 * These values are typically sourced from the effective merge policy
 * (`merge_policy.conflict_classification` in the PRD §9.11.5 schema).
 *
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.11.5
 */
export interface MergeConflictPolicy {
  /**
   * Maximum number of conflicting files before a conflict is classified
   * as non-reworkable. Conflicts with this many or more files are
   * non-reworkable.
   *
   * Default: 5 (per PRD §10.10.2)
   */
  readonly maxConflictFiles: number;

  /**
   * Glob patterns for protected paths. If any conflicting file matches
   * any pattern, the conflict is non-reworkable.
   *
   * Patterns ending with "/" are treated as directory prefixes — they match
   * any file path that starts with that prefix. Other patterns use standard
   * picomatch glob matching.
   *
   * Default: `[".github/", "package.json", "pnpm-lock.yaml"]` (per PRD §10.10.2)
   */
  readonly protectedPaths: readonly string[];
}

/**
 * Default V1 conflict classification policy values from PRD §10.10.2.
 *
 * @see docs/prd/010-integration-contracts.md §10.10.2
 */
export const DEFAULT_MERGE_CONFLICT_POLICY: MergeConflictPolicy = {
  maxConflictFiles: 5,
  protectedPaths: [".github/", "package.json", "pnpm-lock.yaml"],
};

// ---------------------------------------------------------------------------
// Classification result (extended)
// ---------------------------------------------------------------------------

/**
 * Detailed result of conflict classification, including the classification
 * label and a human-readable reason explaining *why* that classification
 * was chosen.
 *
 * The `reason` field is useful for audit logging and developer feedback.
 */
export interface ConflictClassificationResult {
  /** The classification: reworkable or non-reworkable. */
  readonly classification: ConflictClassification;

  /** Human-readable explanation of the classification decision. */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Normalize a protected-path pattern into a picomatch-compatible glob.
 *
 * Patterns ending with "/" are directory prefixes — we convert them to
 * `<prefix>**` so that picomatch matches any file under that directory.
 * All other patterns are returned unchanged.
 */
function normalizePattern(pattern: string): string {
  if (pattern.endsWith("/")) {
    return `${pattern}**`;
  }
  return pattern;
}

/**
 * Classify a set of conflicting files against the provided merge policy.
 *
 * This is the core pure-logic function. It evaluates the two classification
 * rules in order:
 *
 * 1. **File count threshold** — if the number of conflict files is ≥
 *    `maxConflictFiles`, classify as non-reworkable.
 * 2. **Protected path matching** — if any conflict file matches any
 *    protected path pattern, classify as non-reworkable. The first
 *    matching file and pattern are reported in the reason.
 * 3. **Otherwise** — classify as reworkable.
 *
 * @param conflictFiles - List of file paths with merge conflicts.
 * @param policy - The merge conflict classification policy thresholds.
 * @returns A detailed classification result with reason.
 *
 * @see docs/prd/010-integration-contracts.md §10.10.2
 */
export function classifyConflict(
  conflictFiles: readonly string[],
  policy: MergeConflictPolicy,
): ConflictClassificationResult {
  // Rule 1: file count threshold
  if (conflictFiles.length >= policy.maxConflictFiles) {
    return {
      classification: "non_reworkable",
      reason:
        `Conflict file count (${conflictFiles.length}) meets or exceeds ` +
        `threshold (${policy.maxConflictFiles})`,
    };
  }

  // Rule 2: protected path matching
  if (policy.protectedPaths.length > 0) {
    const matchers = policy.protectedPaths.map((pattern) => ({
      pattern,
      isMatch: picomatch(normalizePattern(pattern), { dot: true }),
    }));

    for (const file of conflictFiles) {
      for (const { pattern, isMatch } of matchers) {
        if (isMatch(file)) {
          return {
            classification: "non_reworkable",
            reason: `Conflict in protected path: "${file}" matches ` + `pattern "${pattern}"`,
          };
        }
      }
    }
  }

  // Rule 3: reworkable
  return {
    classification: "reworkable",
    reason:
      conflictFiles.length === 0
        ? "No conflict files"
        : `${conflictFiles.length} conflict file(s), none in protected paths`,
  };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

/**
 * Create a conflict classifier that implements {@link ConflictClassifierPort}.
 *
 * The classifier uses the provided policy thresholds (or V1 defaults) to
 * determine whether a merge conflict is reworkable or non-reworkable.
 *
 * Usage:
 * ```typescript
 * const classifier = createConflictClassifierService({
 *   maxConflictFiles: 5,
 *   protectedPaths: [".github/", "package.json", "pnpm-lock.yaml"],
 * });
 *
 * const result = await classifier.classify(["src/index.ts", "package.json"]);
 * // result === "non_reworkable" (package.json is a protected path)
 * ```
 *
 * @param policy - Merge conflict classification policy. Falls back to
 *                 {@link DEFAULT_MERGE_CONFLICT_POLICY} when omitted.
 * @returns A {@link ConflictClassifierPort} implementation.
 *
 * @see docs/prd/010-integration-contracts.md §10.10.2
 * @see T066 — Implement merge conflict classification
 */
export function createConflictClassifierService(
  policy: MergeConflictPolicy = DEFAULT_MERGE_CONFLICT_POLICY,
): ConflictClassifierPort {
  return {
    async classify(conflictFiles: readonly string[]): Promise<ConflictClassification> {
      const result = classifyConflict(conflictFiles, policy);
      return result.classification;
    },
  };
}

/**
 * Create a conflict classifier that returns detailed results including
 * the reason for the classification decision.
 *
 * This is useful for audit logging, MergePacket metadata, and developer
 * feedback when a conflict is non-reworkable.
 *
 * @param policy - Merge conflict classification policy. Falls back to
 *                 {@link DEFAULT_MERGE_CONFLICT_POLICY} when omitted.
 * @returns A function that classifies conflicts with detailed reasons.
 *
 * @see docs/prd/010-integration-contracts.md §10.10.2
 */
export function createDetailedConflictClassifier(
  policy: MergeConflictPolicy = DEFAULT_MERGE_CONFLICT_POLICY,
): (conflictFiles: readonly string[]) => ConflictClassificationResult {
  return (conflictFiles) => classifyConflict(conflictFiles, policy);
}
