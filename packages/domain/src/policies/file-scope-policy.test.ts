/**
 * Tests for file scope policy model and enforcement.
 *
 * Validates the core access control logic that determines which files workers
 * can read and write. Tests cover the full precedence chain (deny > write >
 * read > outside), edge cases in path normalization, and post-run diff
 * validation.
 *
 * @module @factory/domain/policies/file-scope-policy.test
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.4
 */

import { describe, it, expect } from "vitest";

import {
  FileScopeViolationAction,
  FileScopeViolationReason,
  FileScopeRootMatch,
  normalizePath,
  checkReadAccess,
  checkWriteAccess,
  validatePostRunDiff,
} from "./file-scope-policy.js";

import type { FileScopePolicy } from "./file-scope-policy.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

/**
 * Standard test policy following the spec's canonical shape from §9.4.1.
 * - Read roots: apps/control-plane/, packages/domain/, docs/
 * - Write roots: apps/control-plane/, packages/domain/
 * - Deny roots: .github/workflows/, secrets/, infra/production/
 * - Outside reads: allowed
 * - Outside writes: denied
 */
const STANDARD_POLICY: FileScopePolicy = {
  read_roots: ["apps/control-plane/", "packages/domain/", "docs/"],
  write_roots: ["apps/control-plane/", "packages/domain/"],
  deny_roots: [".github/workflows/", "secrets/", "infra/production/"],
  allow_read_outside_scope: true,
  allow_write_outside_scope: false,
  on_violation: FileScopeViolationAction.FAIL_RUN,
};

/**
 * Restrictive policy that denies all access outside configured roots.
 * Tests the deny-by-default case for both reads and writes.
 */
const RESTRICTIVE_POLICY: FileScopePolicy = {
  read_roots: ["src/"],
  write_roots: ["src/modules/"],
  deny_roots: ["src/modules/secrets/"],
  allow_read_outside_scope: false,
  allow_write_outside_scope: false,
  on_violation: FileScopeViolationAction.DENY_ACCESS,
};

/**
 * Permissive policy that allows reads and writes outside scope.
 * Deny roots still take precedence even with this permissive setup.
 */
const PERMISSIVE_POLICY: FileScopePolicy = {
  read_roots: [],
  write_roots: [],
  deny_roots: ["secrets/"],
  allow_read_outside_scope: true,
  allow_write_outside_scope: true,
  on_violation: FileScopeViolationAction.AUDIT_ONLY,
};

// ─── Path Normalization ─────────────────────────────────────────────────────

describe("normalizePath", () => {
  /**
   * Validates that leading "./" is stripped so paths match root prefixes
   * consistently regardless of whether they use relative notation.
   */
  it("strips leading ./", () => {
    expect(normalizePath("./apps/control-plane/src/index.ts")).toBe(
      "apps/control-plane/src/index.ts",
    );
  });

  /**
   * Validates that leading "/" is stripped because roots are defined
   * as relative paths in the policy.
   */
  it("strips leading /", () => {
    expect(normalizePath("/packages/domain/src/main.ts")).toBe("packages/domain/src/main.ts");
  });

  /**
   * Validates that multiple leading slashes and dot-slashes are all stripped.
   */
  it("strips multiple leading ./ and /", () => {
    expect(normalizePath("././apps/foo.ts")).toBe("apps/foo.ts");
    expect(normalizePath("///apps/foo.ts")).toBe("apps/foo.ts");
  });

  /**
   * Validates that repeated slashes within a path are collapsed to a single
   * slash so that path prefix matching works correctly.
   */
  it("collapses repeated slashes", () => {
    expect(normalizePath("apps//control-plane///src/index.ts")).toBe(
      "apps/control-plane/src/index.ts",
    );
  });

  /**
   * Validates that surrounding whitespace is trimmed.
   */
  it("trims whitespace", () => {
    expect(normalizePath("  apps/foo.ts  ")).toBe("apps/foo.ts");
  });

  /**
   * Validates that an empty string normalizes to empty,
   * which will be caught as invalid in the access checkers.
   */
  it("returns empty string for empty input", () => {
    expect(normalizePath("")).toBe("");
    expect(normalizePath("   ")).toBe("");
  });

  /**
   * Validates that paths without any prefix issues pass through unchanged.
   */
  it("returns already-clean paths unchanged", () => {
    expect(normalizePath("apps/control-plane/src/index.ts")).toBe(
      "apps/control-plane/src/index.ts",
    );
  });
});

// ─── Read Access ────────────────────────────────────────────────────────────

describe("checkReadAccess", () => {
  // ── Deny roots (highest precedence) ─────────────────────────────────────

  /**
   * Deny roots have the highest precedence per §9.4.2.
   * A path matching a deny root must ALWAYS be denied, even if it also
   * matches a write_root or read_root.
   */
  it("denies read access for paths in deny_roots", () => {
    const result = checkReadAccess(".github/workflows/ci.yml", STANDARD_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.DENIED_BY_DENY_ROOT);
    expect(result.action).toBe(FileScopeViolationAction.FAIL_RUN);
    expect(result.matchedRoot).toBe(FileScopeRootMatch.DENY_ROOT);
    expect(result.matchedRootValue).toBe(".github/workflows/");
  });

  /**
   * Deny roots block even when a path would otherwise be allowed by
   * allow_read_outside_scope or other permissive settings.
   */
  it("deny roots override permissive outside-scope settings", () => {
    const result = checkReadAccess("secrets/api-key.txt", PERMISSIVE_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.DENIED_BY_DENY_ROOT);
  });

  // ── Write roots (grant read + write) ────────────────────────────────────

  /**
   * Write roots grant both read and write access per §9.4.2.
   * This test verifies that read access is explicitly allowed for
   * paths in write_roots.
   */
  it("allows read access for paths in write_roots", () => {
    const result = checkReadAccess("apps/control-plane/src/main.ts", STANDARD_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.matchedRoot).toBe(FileScopeRootMatch.WRITE_ROOT);
  });

  // ── Read roots ──────────────────────────────────────────────────────────

  /**
   * Read roots grant read-only access per §9.4.2.
   */
  it("allows read access for paths in read_roots", () => {
    const result = checkReadAccess("docs/architecture.md", STANDARD_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.matchedRoot).toBe(FileScopeRootMatch.READ_ROOT);
  });

  // ── Outside roots ──────────────────────────────────────────────────────

  /**
   * When allow_read_outside_scope is true, reads outside all roots
   * are permitted. This is the default V1 behavior per §9.4.2.
   */
  it("allows reads outside scope when allow_read_outside_scope is true", () => {
    const result = checkReadAccess("random/file.txt", STANDARD_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.matchedRoot).toBe(FileScopeRootMatch.OUTSIDE);
  });

  /**
   * When allow_read_outside_scope is false, reads outside all roots
   * are denied. Used for strict isolation scenarios.
   */
  it("denies reads outside scope when allow_read_outside_scope is false", () => {
    const result = checkReadAccess("random/file.txt", RESTRICTIVE_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.READ_OUTSIDE_SCOPE);
    expect(result.action).toBe(FileScopeViolationAction.DENY_ACCESS);
  });

  // ── Path normalization in access checks ─────────────────────────────────

  /**
   * Paths with leading "./" should be normalized before comparison.
   * This ensures consistent behavior regardless of path format.
   */
  it("normalizes paths before checking", () => {
    const result = checkReadAccess("./apps/control-plane/src/main.ts", STANDARD_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.normalizedPath).toBe("apps/control-plane/src/main.ts");
  });

  /**
   * Paths with leading "/" should be normalized before comparison.
   */
  it("normalizes absolute paths before checking", () => {
    const result = checkReadAccess("/docs/architecture.md", STANDARD_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.normalizedPath).toBe("docs/architecture.md");
  });

  // ── Invalid paths ──────────────────────────────────────────────────────

  /**
   * Empty paths must be rejected to prevent accidental match-all behavior.
   */
  it("rejects empty paths", () => {
    const result = checkReadAccess("", STANDARD_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.INVALID_PATH);
  });

  /**
   * Whitespace-only paths must be rejected after normalization.
   */
  it("rejects whitespace-only paths", () => {
    const result = checkReadAccess("   ", STANDARD_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.INVALID_PATH);
  });
});

// ─── Write Access ───────────────────────────────────────────────────────────

describe("checkWriteAccess", () => {
  // ── Deny roots (highest precedence) ─────────────────────────────────────

  /**
   * Deny roots have the highest precedence for writes too.
   * Even though .github/workflows/ is not in any other root list,
   * the deny root must explicitly block the write.
   */
  it("denies write access for paths in deny_roots", () => {
    const result = checkWriteAccess(".github/workflows/ci.yml", STANDARD_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.DENIED_BY_DENY_ROOT);
    expect(result.action).toBe(FileScopeViolationAction.FAIL_RUN);
    expect(result.matchedRoot).toBe(FileScopeRootMatch.DENY_ROOT);
  });

  /**
   * When a path is nested under a deny_root, writes must be denied
   * even if the path also matches a write_root. This tests the case
   * where deny_roots overlap with write_roots and verifies deny wins.
   */
  it("deny roots take precedence over write roots when paths overlap", () => {
    const overlappingPolicy: FileScopePolicy = {
      read_roots: [],
      write_roots: ["src/"],
      deny_roots: ["src/secrets/"],
      allow_read_outside_scope: false,
      allow_write_outside_scope: false,
      on_violation: FileScopeViolationAction.FAIL_RUN,
    };
    const result = checkWriteAccess("src/secrets/api-key.ts", overlappingPolicy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.DENIED_BY_DENY_ROOT);
  });

  // ── Write roots ─────────────────────────────────────────────────────────

  /**
   * Write roots grant write access per §9.4.2.
   */
  it("allows write access for paths in write_roots", () => {
    const result = checkWriteAccess("apps/control-plane/src/main.ts", STANDARD_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.matchedRoot).toBe(FileScopeRootMatch.WRITE_ROOT);
    expect(result.matchedRootValue).toBe("apps/control-plane/");
  });

  /**
   * Deeply nested paths within a write root should still be allowed.
   */
  it("allows writes to deeply nested paths within write_roots", () => {
    const result = checkWriteAccess(
      "packages/domain/src/policies/file-scope-policy.ts",
      STANDARD_POLICY,
    );
    expect(result.allowed).toBe(true);
    expect(result.matchedRoot).toBe(FileScopeRootMatch.WRITE_ROOT);
  });

  // ── Read roots (write denied) ──────────────────────────────────────────

  /**
   * Read roots only grant read access. Writing to a read-only root
   * must be denied per §9.4.2 — even though read access would be allowed.
   */
  it("denies write access for paths in read_roots", () => {
    const result = checkWriteAccess("docs/architecture.md", STANDARD_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.WRITE_IN_READ_ONLY_ROOT);
    expect(result.matchedRoot).toBe(FileScopeRootMatch.READ_ROOT);
  });

  // ── Outside roots ──────────────────────────────────────────────────────

  /**
   * Default policy denies writes outside scope per §9.4.2.
   * This is the secure default: workers cannot modify arbitrary files.
   */
  it("denies writes outside scope when allow_write_outside_scope is false", () => {
    const result = checkWriteAccess("random/file.txt", STANDARD_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.WRITE_OUTSIDE_SCOPE);
    expect(result.matchedRoot).toBe(FileScopeRootMatch.OUTSIDE);
  });

  /**
   * When allow_write_outside_scope is true, writes outside scope are allowed.
   * This is a permissive configuration typically used with human override.
   */
  it("allows writes outside scope when allow_write_outside_scope is true", () => {
    const result = checkWriteAccess("random/file.txt", PERMISSIVE_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.matchedRoot).toBe(FileScopeRootMatch.OUTSIDE);
  });

  // ── Path normalization ────────────────────────────────────────────────

  /**
   * Ensures paths are normalized before write access checks,
   * preventing bypass via leading "./" or "/".
   */
  it("normalizes paths before checking write access", () => {
    const result = checkWriteAccess("./packages/domain/src/main.ts", STANDARD_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.normalizedPath).toBe("packages/domain/src/main.ts");
  });

  // ── Invalid paths ──────────────────────────────────────────────────────

  /**
   * Empty paths must be rejected for write access.
   */
  it("rejects empty paths", () => {
    const result = checkWriteAccess("", STANDARD_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.INVALID_PATH);
  });

  // ── Violation action ──────────────────────────────────────────────────

  /**
   * The violation action from the policy must be included in denied results.
   * This ensures the caller knows what action to take.
   */
  it("includes the configured violation action on denial", () => {
    const result = checkWriteAccess("random/file.txt", RESTRICTIVE_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.action).toBe(FileScopeViolationAction.DENY_ACCESS);
  });

  /**
   * Allowed results must not include a violation action or reason.
   */
  it("does not include action or reason on allowed results", () => {
    const result = checkWriteAccess("apps/control-plane/src/main.ts", STANDARD_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.action).toBeUndefined();
    expect(result.reason).toBeUndefined();
  });
});

// ─── Precedence Rules ───────────────────────────────────────────────────────

describe("precedence rules", () => {
  /**
   * Tests the complete precedence chain with overlapping roots.
   * When a path matches both deny_roots and write_roots, deny wins.
   * This is the most critical invariant in the file scope policy.
   */
  it("deny_roots override write_roots and read_roots", () => {
    const policy: FileScopePolicy = {
      read_roots: ["shared/"],
      write_roots: ["shared/code/"],
      deny_roots: ["shared/code/secrets/"],
      allow_read_outside_scope: false,
      allow_write_outside_scope: false,
      on_violation: FileScopeViolationAction.FAIL_RUN,
    };

    // Path in deny root — denied even though it's also under write root
    const denyResult = checkWriteAccess("shared/code/secrets/key.ts", policy);
    expect(denyResult.allowed).toBe(false);
    expect(denyResult.reason).toBe(FileScopeViolationReason.DENIED_BY_DENY_ROOT);

    // Path in write root but not deny root — allowed
    const writeResult = checkWriteAccess("shared/code/utils.ts", policy);
    expect(writeResult.allowed).toBe(true);
    expect(writeResult.matchedRoot).toBe(FileScopeRootMatch.WRITE_ROOT);

    // Path in read root but not write root — read-only
    const readResult = checkWriteAccess("shared/readme.md", policy);
    expect(readResult.allowed).toBe(false);
    expect(readResult.reason).toBe(FileScopeViolationReason.WRITE_IN_READ_ONLY_ROOT);

    // Path outside all roots — denied (allow_write_outside_scope=false)
    const outsideResult = checkWriteAccess("other/file.ts", policy);
    expect(outsideResult.allowed).toBe(false);
    expect(outsideResult.reason).toBe(FileScopeViolationReason.WRITE_OUTSIDE_SCOPE);
  });

  /**
   * Verifies that write_roots grant read access (second precedence).
   * A path in write_roots should be readable even if not in read_roots.
   */
  it("write_roots grant read access even without explicit read_root", () => {
    const policy: FileScopePolicy = {
      read_roots: [],
      write_roots: ["src/"],
      deny_roots: [],
      allow_read_outside_scope: false,
      allow_write_outside_scope: false,
      on_violation: FileScopeViolationAction.FAIL_RUN,
    };

    const result = checkReadAccess("src/main.ts", policy);
    expect(result.allowed).toBe(true);
    expect(result.matchedRoot).toBe(FileScopeRootMatch.WRITE_ROOT);
  });

  /**
   * Verifies that read_roots do NOT grant write access.
   * This is the key distinction: read roots are read-only.
   */
  it("read_roots do not grant write access", () => {
    const policy: FileScopePolicy = {
      read_roots: ["docs/"],
      write_roots: [],
      deny_roots: [],
      allow_read_outside_scope: false,
      allow_write_outside_scope: false,
      on_violation: FileScopeViolationAction.FAIL_RUN,
    };

    const readResult = checkReadAccess("docs/readme.md", policy);
    expect(readResult.allowed).toBe(true);

    const writeResult = checkWriteAccess("docs/readme.md", policy);
    expect(writeResult.allowed).toBe(false);
    expect(writeResult.reason).toBe(FileScopeViolationReason.WRITE_IN_READ_ONLY_ROOT);
  });
});

// ─── Root Prefix Matching ───────────────────────────────────────────────────

describe("root prefix matching", () => {
  /**
   * Root matching must use directory-level prefix matching (with trailing
   * slash), not substring matching. "app" should not match "application/".
   * This prevents false positives from partial directory name matches.
   */
  it("does not match partial directory names", () => {
    const policy: FileScopePolicy = {
      read_roots: ["app/"],
      write_roots: [],
      deny_roots: [],
      allow_read_outside_scope: false,
      allow_write_outside_scope: false,
      on_violation: FileScopeViolationAction.FAIL_RUN,
    };

    // "app/" root should NOT match "application/" directory
    const result = checkReadAccess("application/index.ts", policy);
    expect(result.allowed).toBe(false);
    expect(result.matchedRoot).toBe(FileScopeRootMatch.OUTSIDE);
  });

  /**
   * Roots defined without trailing slash should still be normalized to
   * include a trailing slash for correct prefix matching.
   */
  it("normalizes roots without trailing slash", () => {
    const policy: FileScopePolicy = {
      read_roots: ["docs"],
      write_roots: [],
      deny_roots: [],
      allow_read_outside_scope: false,
      allow_write_outside_scope: false,
      on_violation: FileScopeViolationAction.FAIL_RUN,
    };

    const result = checkReadAccess("docs/readme.md", policy);
    expect(result.allowed).toBe(true);
    expect(result.matchedRoot).toBe(FileScopeRootMatch.READ_ROOT);
  });

  /**
   * Roots defined with leading "./" should be normalized.
   */
  it("normalizes roots with leading ./", () => {
    const policy: FileScopePolicy = {
      read_roots: ["./docs/"],
      write_roots: [],
      deny_roots: [],
      allow_read_outside_scope: false,
      allow_write_outside_scope: false,
      on_violation: FileScopeViolationAction.FAIL_RUN,
    };

    const result = checkReadAccess("docs/readme.md", policy);
    expect(result.allowed).toBe(true);
  });

  /**
   * Roots defined with leading "/" should be normalized.
   */
  it("normalizes roots with leading /", () => {
    const policy: FileScopePolicy = {
      read_roots: ["/docs/"],
      write_roots: [],
      deny_roots: [],
      allow_read_outside_scope: false,
      allow_write_outside_scope: false,
      on_violation: FileScopeViolationAction.FAIL_RUN,
    };

    const result = checkReadAccess("docs/readme.md", policy);
    expect(result.allowed).toBe(true);
  });
});

// ─── Post-Run Diff Validation ───────────────────────────────────────────────

describe("validatePostRunDiff", () => {
  /**
   * When all modified files are within write_roots, the validation
   * should pass with zero violations. This is the happy path.
   */
  it("passes when all files are within write scope", () => {
    const files = ["apps/control-plane/src/main.ts", "packages/domain/src/index.ts"];
    const result = validatePostRunDiff(files, STANDARD_POLICY);

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.evaluations).toHaveLength(2);
    expect(result.summary).toContain("passed");
  });

  /**
   * When some modified files are outside write scope, the validation
   * should fail and report the specific violations.
   */
  it("fails when files are outside write scope", () => {
    const files = [
      "apps/control-plane/src/main.ts",
      "docs/architecture.md", // read-only root
      "random/file.txt", // outside all roots
    ];
    const result = validatePostRunDiff(files, STANDARD_POLICY);

    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.evaluations).toHaveLength(3);
    expect(result.summary).toContain("2 of 3");
  });

  /**
   * When modified files include deny_root paths, those must be reported
   * as violations. This catches the worst case: modifications to
   * protected infrastructure files.
   */
  it("catches writes to deny roots", () => {
    const files = [".github/workflows/ci.yml"];
    const result = validatePostRunDiff(files, STANDARD_POLICY);

    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.reason).toBe(FileScopeViolationReason.DENIED_BY_DENY_ROOT);
  });

  /**
   * An empty diff should pass validation — no files means no violations.
   */
  it("passes for empty file list", () => {
    const result = validatePostRunDiff([], STANDARD_POLICY);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.evaluations).toHaveLength(0);
  });

  /**
   * Violation paths in the summary should be normalized, matching the
   * paths in individual evaluation results.
   */
  it("reports normalized paths in violation summary", () => {
    const files = ["./secrets/api-key.txt"];
    const result = validatePostRunDiff(files, STANDARD_POLICY);

    expect(result.valid).toBe(false);
    expect(result.violations[0]!.normalizedPath).toBe("secrets/api-key.txt");
    expect(result.summary).toContain("secrets/api-key.txt");
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe("edge cases", () => {
  /**
   * A policy with no roots at all and both outside flags set to false
   * should deny all access. This is the most restrictive possible config.
   */
  it("denies all access with empty roots and no outside-scope flags", () => {
    const emptyPolicy: FileScopePolicy = {
      read_roots: [],
      write_roots: [],
      deny_roots: [],
      allow_read_outside_scope: false,
      allow_write_outside_scope: false,
      on_violation: FileScopeViolationAction.FAIL_RUN,
    };

    expect(checkReadAccess("any/file.ts", emptyPolicy).allowed).toBe(false);
    expect(checkWriteAccess("any/file.ts", emptyPolicy).allowed).toBe(false);
  });

  /**
   * A policy with no roots but both outside flags set to true should
   * allow all access except to deny roots. This tests the permissive case.
   */
  it("allows all access with empty roots and outside-scope flags true", () => {
    const openPolicy: FileScopePolicy = {
      read_roots: [],
      write_roots: [],
      deny_roots: [],
      allow_read_outside_scope: true,
      allow_write_outside_scope: true,
      on_violation: FileScopeViolationAction.AUDIT_ONLY,
    };

    expect(checkReadAccess("any/file.ts", openPolicy).allowed).toBe(true);
    expect(checkWriteAccess("any/file.ts", openPolicy).allowed).toBe(true);
  });

  /**
   * All evaluation results must include the normalizedPath and matchedRoot
   * fields, regardless of whether access was allowed or denied.
   * These are required for audit trail purposes.
   */
  it("always includes normalizedPath and matchedRoot in results", () => {
    const readResult = checkReadAccess("./apps/control-plane/src/main.ts", STANDARD_POLICY);
    expect(readResult.normalizedPath).toBe("apps/control-plane/src/main.ts");
    expect(readResult.matchedRoot).toBeDefined();

    const writeResult = checkWriteAccess("random/file.txt", STANDARD_POLICY);
    expect(writeResult.normalizedPath).toBe("random/file.txt");
    expect(writeResult.matchedRoot).toBeDefined();
  });

  /**
   * All evaluation results must include a human-readable explanation.
   * This is important for audit logs and debugging policy violations.
   */
  it("always includes an explanation in results", () => {
    const allowed = checkReadAccess("docs/readme.md", STANDARD_POLICY);
    expect(allowed.explanation).toBeTruthy();
    expect(typeof allowed.explanation).toBe("string");

    const denied = checkWriteAccess("docs/readme.md", STANDARD_POLICY);
    expect(denied.explanation).toBeTruthy();
    expect(typeof denied.explanation).toBe("string");
  });

  /**
   * Paths with ".." segments are not resolved by normalizePath. They pass
   * through for matching purposes. The caller is responsible for resolving
   * or rejecting these before evaluation if traversal prevention is needed.
   */
  it("does not resolve .. segments (caller responsibility)", () => {
    const result = checkWriteAccess("apps/control-plane/../../../etc/passwd", STANDARD_POLICY);
    // Normalized path starts with "apps/control-plane/" so it matches write root
    // The caller should resolve ".." before calling if traversal is a concern
    expect(result.normalizedPath).toBe("apps/control-plane/../../../etc/passwd");
  });
});
