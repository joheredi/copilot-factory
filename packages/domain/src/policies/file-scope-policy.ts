/**
 * File scope policy model and enforcement.
 *
 * Controls which files workers can read and write by evaluating paths against
 * configured read_roots, write_roots, and deny_roots with strict precedence:
 * deny_roots > write_roots > read_roots > outside.
 *
 * @module @factory/domain/policies/file-scope-policy
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.4 File Scope Policy
 * @see {@link file://docs/design-decisions/file-scope-policy-design.md}
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Action to take when a file scope violation is detected.
 *
 * Controls the severity of the response:
 * - `fail_run` — immediately fail the worker run (strictest)
 * - `deny_access` — deny the individual access but continue the run
 * - `audit_only` — log the violation but allow the access
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.4.1
 */
export const FileScopeViolationAction = {
  /** Fail the entire worker run on violation. Strictest enforcement. */
  FAIL_RUN: "fail_run",
  /** Deny the individual file access but continue the run. */
  DENY_ACCESS: "deny_access",
  /** Log the violation but allow the access. Least restrictive. */
  AUDIT_ONLY: "audit_only",
} as const;

/** Union type of all valid violation action values. */
export type FileScopeViolationAction =
  (typeof FileScopeViolationAction)[keyof typeof FileScopeViolationAction];

/**
 * Reason why a file access was denied.
 *
 * Each reason maps to a specific precedence rule in the evaluation algorithm,
 * making it possible to trace exactly which policy clause caused the denial.
 */
export const FileScopeViolationReason = {
  /** Path falls under a deny_root. Highest precedence — always blocks. */
  DENIED_BY_DENY_ROOT: "denied_by_deny_root",
  /** Write attempted on a path only covered by read_roots. */
  WRITE_IN_READ_ONLY_ROOT: "write_in_read_only_root",
  /** Read or write attempted on a path outside all configured roots. */
  OUTSIDE_ALL_ROOTS: "outside_all_roots",
  /** Write attempted outside write_roots and allow_write_outside_scope is false. */
  WRITE_OUTSIDE_SCOPE: "write_outside_scope",
  /** Read attempted outside read_roots and allow_read_outside_scope is false. */
  READ_OUTSIDE_SCOPE: "read_outside_scope",
  /** Invalid path — empty or only whitespace. */
  INVALID_PATH: "invalid_path",
} as const;

/** Union type of all valid violation reason values. */
export type FileScopeViolationReason =
  (typeof FileScopeViolationReason)[keyof typeof FileScopeViolationReason];

/**
 * Which root category matched a path during evaluation.
 *
 * Used in evaluation results to trace which root governed the decision.
 */
export const FileScopeRootMatch = {
  /** Path matched a deny_root. */
  DENY_ROOT: "deny_root",
  /** Path matched a write_root. */
  WRITE_ROOT: "write_root",
  /** Path matched a read_root. */
  READ_ROOT: "read_root",
  /** Path did not match any configured root. */
  OUTSIDE: "outside",
} as const;

/** Union type of all valid root match values. */
export type FileScopeRootMatch = (typeof FileScopeRootMatch)[keyof typeof FileScopeRootMatch];

// ─── Data Model ─────────────────────────────────────────────────────────────

/**
 * Complete file scope policy definition.
 *
 * Defines read/write access boundaries for worker file operations using
 * path prefix matching against configured root directories.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.4.1
 */
export interface FileScopePolicy {
  /** Directories where read access is permitted. Path prefixes (e.g., "apps/control-plane/"). */
  readonly read_roots: readonly string[];
  /** Directories where write access is permitted. Also grants read access. */
  readonly write_roots: readonly string[];
  /** Directories where all access is denied. Takes highest precedence. */
  readonly deny_roots: readonly string[];
  /** Whether reads are allowed for paths outside all configured roots. */
  readonly allow_read_outside_scope: boolean;
  /** Whether writes are allowed for paths outside all configured roots. */
  readonly allow_write_outside_scope: boolean;
  /** Action to take when a violation is detected. */
  readonly on_violation: FileScopeViolationAction;
}

/**
 * Result of evaluating a single file access against the policy.
 *
 * Always includes the normalized path and a human-readable explanation.
 * When access is denied, includes the violation reason and configured action.
 */
export interface FileScopeEvaluation {
  /** Whether the access is permitted. */
  readonly allowed: boolean;
  /** Violation reason, present only when denied. */
  readonly reason?: FileScopeViolationReason;
  /** Human-readable explanation of the evaluation outcome. */
  readonly explanation: string;
  /** Violation action from policy, present only when denied. */
  readonly action?: FileScopeViolationAction;
  /** The normalized path that was evaluated. */
  readonly normalizedPath: string;
  /** Which root category the path matched. */
  readonly matchedRoot: FileScopeRootMatch;
  /** The specific root prefix that matched, if any. */
  readonly matchedRootValue?: string;
}

/**
 * Result of validating a post-run diff against the file scope policy.
 *
 * Used after a worker run completes to verify that all file modifications
 * stayed within the allowed write scope.
 */
export interface PostRunDiffValidation {
  /** Whether all modified files are within the allowed write scope. */
  readonly valid: boolean;
  /** Per-file evaluation results. */
  readonly evaluations: readonly FileScopeEvaluation[];
  /** Subset of evaluations where the write was denied. */
  readonly violations: readonly FileScopeEvaluation[];
  /** Summary explanation of the validation outcome. */
  readonly summary: string;
}

// ─── Path Normalization ─────────────────────────────────────────────────────

/**
 * Normalize a file path for consistent prefix matching.
 *
 * Strips leading `./` and `/`, collapses repeated slashes, and trims whitespace.
 * Does NOT resolve `..` segments — those should be rejected or resolved by the
 * caller before policy evaluation.
 *
 * @param rawPath - The raw file path to normalize.
 * @returns The normalized path suitable for prefix matching against roots.
 *
 * @example
 * ```ts
 * normalizePath("./apps/control-plane/src/index.ts")
 * // => "apps/control-plane/src/index.ts"
 *
 * normalizePath("/packages/domain/")
 * // => "packages/domain/"
 * ```
 */
export function normalizePath(rawPath: string): string {
  let p = rawPath.trim();
  // Collapse repeated slashes
  p = p.replace(/\/+/g, "/");
  // Strip leading "./"
  while (p.startsWith("./")) {
    p = p.slice(2);
  }
  // Strip leading "/"
  while (p.startsWith("/")) {
    p = p.slice(1);
  }
  return p;
}

/**
 * Normalize a root path for consistent prefix matching.
 *
 * Same as {@link normalizePath} but also ensures the root ends with "/"
 * so that prefix matching does not produce false positives (e.g.,
 * root "app" should not match path "application/index.ts").
 *
 * @param rawRoot - The raw root directory path to normalize.
 * @returns The normalized root with trailing slash.
 */
function normalizeRoot(rawRoot: string): string {
  const p = normalizePath(rawRoot);
  if (p === "") return "";
  return p.endsWith("/") ? p : p + "/";
}

// ─── Root Classification ────────────────────────────────────────────────────

/**
 * Classify a normalized path against the policy's root lists.
 *
 * Returns the highest-precedence root category that matches the path,
 * following the precedence defined in §9.4.2:
 * 1. deny_roots (highest)
 * 2. write_roots
 * 3. read_roots
 * 4. outside (no match)
 *
 * @param normalizedPath - Path already processed by {@link normalizePath}.
 * @param policy - The file scope policy to evaluate against.
 * @returns The root match category and the specific root that matched.
 */
function classifyPath(
  normalizedPath: string,
  policy: FileScopePolicy,
): { match: FileScopeRootMatch; rootValue?: string } {
  // 1. Check deny_roots first (highest precedence)
  for (const root of policy.deny_roots) {
    const normalizedRoot = normalizeRoot(root);
    if (normalizedRoot !== "" && normalizedPath.startsWith(normalizedRoot)) {
      return { match: FileScopeRootMatch.DENY_ROOT, rootValue: root };
    }
  }

  // 2. Check write_roots (second precedence)
  for (const root of policy.write_roots) {
    const normalizedRoot = normalizeRoot(root);
    if (normalizedRoot !== "" && normalizedPath.startsWith(normalizedRoot)) {
      return { match: FileScopeRootMatch.WRITE_ROOT, rootValue: root };
    }
  }

  // 3. Check read_roots (third precedence)
  for (const root of policy.read_roots) {
    const normalizedRoot = normalizeRoot(root);
    if (normalizedRoot !== "" && normalizedPath.startsWith(normalizedRoot)) {
      return { match: FileScopeRootMatch.READ_ROOT, rootValue: root };
    }
  }

  // 4. No match — outside all roots
  return { match: FileScopeRootMatch.OUTSIDE };
}

// ─── Access Evaluation ──────────────────────────────────────────────────────

/**
 * Check whether a path can be read under the given file scope policy.
 *
 * Evaluates the path against the policy's root lists following the
 * precedence rules defined in §9.4.2:
 * 1. deny_roots — always denied for read and write
 * 2. write_roots — read and write permitted
 * 3. read_roots — read-only permitted
 * 4. outside — governed by allow_read_outside_scope
 *
 * @param path - The file path to check. Will be normalized internally.
 * @param policy - The file scope policy to evaluate against.
 * @returns Evaluation result indicating whether read access is permitted.
 *
 * @example
 * ```ts
 * const result = checkReadAccess("apps/control-plane/src/main.ts", policy);
 * if (!result.allowed) {
 *   console.error(result.explanation);
 * }
 * ```
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.4.2
 */
export function checkReadAccess(path: string, policy: FileScopePolicy): FileScopeEvaluation {
  const normalizedPath = normalizePath(path);

  if (normalizedPath === "") {
    return {
      allowed: false,
      reason: FileScopeViolationReason.INVALID_PATH,
      explanation: "Path is empty or whitespace-only.",
      action: policy.on_violation,
      normalizedPath,
      matchedRoot: FileScopeRootMatch.OUTSIDE,
    };
  }

  const { match, rootValue } = classifyPath(normalizedPath, policy);

  switch (match) {
    case FileScopeRootMatch.DENY_ROOT:
      return {
        allowed: false,
        reason: FileScopeViolationReason.DENIED_BY_DENY_ROOT,
        explanation: `Read access denied: path "${normalizedPath}" falls under deny root "${rootValue}".`,
        action: policy.on_violation,
        normalizedPath,
        matchedRoot: match,
        matchedRootValue: rootValue,
      };

    case FileScopeRootMatch.WRITE_ROOT:
      return {
        allowed: true,
        explanation: `Read access permitted: path "${normalizedPath}" is within write root "${rootValue}" (write roots grant read+write).`,
        normalizedPath,
        matchedRoot: match,
        matchedRootValue: rootValue,
      };

    case FileScopeRootMatch.READ_ROOT:
      return {
        allowed: true,
        explanation: `Read access permitted: path "${normalizedPath}" is within read root "${rootValue}".`,
        normalizedPath,
        matchedRoot: match,
        matchedRootValue: rootValue,
      };

    case FileScopeRootMatch.OUTSIDE:
      if (policy.allow_read_outside_scope) {
        return {
          allowed: true,
          explanation: `Read access permitted: path "${normalizedPath}" is outside all roots but allow_read_outside_scope is true.`,
          normalizedPath,
          matchedRoot: match,
        };
      }
      return {
        allowed: false,
        reason: FileScopeViolationReason.READ_OUTSIDE_SCOPE,
        explanation: `Read access denied: path "${normalizedPath}" is outside all configured roots and allow_read_outside_scope is false.`,
        action: policy.on_violation,
        normalizedPath,
        matchedRoot: match,
      };
  }
}

/**
 * Check whether a path can be written under the given file scope policy.
 *
 * Evaluates the path against the policy's root lists following the
 * precedence rules defined in §9.4.2:
 * 1. deny_roots — always denied
 * 2. write_roots — write permitted
 * 3. read_roots — write denied (read-only)
 * 4. outside — governed by allow_write_outside_scope
 *
 * @param path - The file path to check. Will be normalized internally.
 * @param policy - The file scope policy to evaluate against.
 * @returns Evaluation result indicating whether write access is permitted.
 *
 * @example
 * ```ts
 * const result = checkWriteAccess("apps/control-plane/src/main.ts", policy);
 * if (!result.allowed) {
 *   console.error(`Write blocked: ${result.explanation}`);
 * }
 * ```
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.4.2
 */
export function checkWriteAccess(path: string, policy: FileScopePolicy): FileScopeEvaluation {
  const normalizedPath = normalizePath(path);

  if (normalizedPath === "") {
    return {
      allowed: false,
      reason: FileScopeViolationReason.INVALID_PATH,
      explanation: "Path is empty or whitespace-only.",
      action: policy.on_violation,
      normalizedPath,
      matchedRoot: FileScopeRootMatch.OUTSIDE,
    };
  }

  const { match, rootValue } = classifyPath(normalizedPath, policy);

  switch (match) {
    case FileScopeRootMatch.DENY_ROOT:
      return {
        allowed: false,
        reason: FileScopeViolationReason.DENIED_BY_DENY_ROOT,
        explanation: `Write access denied: path "${normalizedPath}" falls under deny root "${rootValue}".`,
        action: policy.on_violation,
        normalizedPath,
        matchedRoot: match,
        matchedRootValue: rootValue,
      };

    case FileScopeRootMatch.WRITE_ROOT:
      return {
        allowed: true,
        explanation: `Write access permitted: path "${normalizedPath}" is within write root "${rootValue}".`,
        normalizedPath,
        matchedRoot: match,
        matchedRootValue: rootValue,
      };

    case FileScopeRootMatch.READ_ROOT:
      return {
        allowed: false,
        reason: FileScopeViolationReason.WRITE_IN_READ_ONLY_ROOT,
        explanation: `Write access denied: path "${normalizedPath}" is within read root "${rootValue}" which only permits reads.`,
        action: policy.on_violation,
        normalizedPath,
        matchedRoot: match,
        matchedRootValue: rootValue,
      };

    case FileScopeRootMatch.OUTSIDE:
      if (policy.allow_write_outside_scope) {
        return {
          allowed: true,
          explanation: `Write access permitted: path "${normalizedPath}" is outside all roots but allow_write_outside_scope is true.`,
          normalizedPath,
          matchedRoot: match,
        };
      }
      return {
        allowed: false,
        reason: FileScopeViolationReason.WRITE_OUTSIDE_SCOPE,
        explanation: `Write access denied: path "${normalizedPath}" is outside all configured roots and allow_write_outside_scope is false.`,
        action: policy.on_violation,
        normalizedPath,
        matchedRoot: match,
      };
  }
}

/**
 * Validate a list of modified files from a post-run git diff against the policy.
 *
 * After a worker run completes, this function checks every modified file path
 * against the write access rules to detect out-of-scope modifications. This is
 * the post-run validation described in §9.4.2.
 *
 * @param modifiedFiles - Array of file paths from the git diff output.
 * @param policy - The file scope policy to validate against.
 * @returns Validation result with per-file evaluations and a summary.
 *
 * @example
 * ```ts
 * const diff = ["apps/control-plane/src/main.ts", ".github/workflows/ci.yml"];
 * const result = validatePostRunDiff(diff, policy);
 * if (!result.valid) {
 *   console.error(result.summary);
 *   for (const v of result.violations) {
 *     console.error(`  - ${v.normalizedPath}: ${v.explanation}`);
 *   }
 * }
 * ```
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.4.2
 */
export function validatePostRunDiff(
  modifiedFiles: readonly string[],
  policy: FileScopePolicy,
): PostRunDiffValidation {
  const evaluations = modifiedFiles.map((file) => checkWriteAccess(file, policy));
  const violations = evaluations.filter((e) => !e.allowed);

  if (violations.length === 0) {
    return {
      valid: true,
      evaluations,
      violations: [],
      summary: `Post-run diff validation passed: all ${evaluations.length} modified file(s) are within allowed write scope.`,
    };
  }

  const violationPaths = violations.map((v) => v.normalizedPath).join(", ");

  return {
    valid: false,
    evaluations,
    violations,
    summary: `Post-run diff validation failed: ${violations.length} of ${evaluations.length} modified file(s) violate write scope policy. Violations: ${violationPaths}`,
  };
}
