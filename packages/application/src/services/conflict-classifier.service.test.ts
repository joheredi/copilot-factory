/**
 * Tests for the conflict classifier service.
 *
 * These tests validate the merge conflict classification logic from
 * PRD §10.10.2 — determining whether merge conflicts are reworkable
 * (developer can fix them) or non-reworkable (irrecoverable).
 *
 * The test suite covers three classification dimensions:
 * 1. **File count threshold** — conflicts exceeding `maxConflictFiles` are
 *    non-reworkable.
 * 2. **Protected path matching** — conflicts in protected paths (e.g.,
 *    `.github/`, `package.json`) are non-reworkable regardless of count.
 * 3. **Reworkable classification** — conflicts below thresholds and outside
 *    protected paths are reworkable.
 *
 * Additional coverage:
 * - Edge cases (empty inputs, boundary values, zero thresholds)
 * - Directory prefix patterns vs exact file patterns
 * - Glob wildcards in protected paths
 * - The `ConflictClassifierPort` contract via `createConflictClassifierService`
 * - Detailed classification results via `createDetailedConflictClassifier`
 * - Default policy values match PRD §10.10.2 specification
 *
 * @see docs/prd/010-integration-contracts.md §10.10.2
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.11.5
 * @see T066 — Implement merge conflict classification
 */

import { describe, it, expect } from "vitest";

import type { MergeConflictPolicy } from "./conflict-classifier.service.js";
import {
  classifyConflict,
  createConflictClassifierService,
  createDetailedConflictClassifier,
  DEFAULT_MERGE_CONFLICT_POLICY,
} from "./conflict-classifier.service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard policy for most tests: threshold of 5, default protected paths. */
const DEFAULT_POLICY: MergeConflictPolicy = {
  maxConflictFiles: 5,
  protectedPaths: [".github/", "package.json", "pnpm-lock.yaml"],
};

/** Policy with no protected paths — only the file count threshold applies. */
const NO_PROTECTED_PATHS_POLICY: MergeConflictPolicy = {
  maxConflictFiles: 5,
  protectedPaths: [],
};

// ---------------------------------------------------------------------------
// Tests: classifyConflict (pure function)
// ---------------------------------------------------------------------------

describe("classifyConflict", () => {
  // -------------------------------------------------------------------------
  // File count threshold
  // -------------------------------------------------------------------------

  describe("file count threshold", () => {
    /**
     * When the number of conflict files equals the threshold, the conflict
     * is non-reworkable. This is the boundary case — the PRD says "fewer
     * than max_conflict_files" for reworkable, meaning >= is non-reworkable.
     */
    it("classifies as non_reworkable when conflict count equals threshold", () => {
      const files = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("non_reworkable");
      expect(result.reason).toContain("5");
      expect(result.reason).toContain("threshold");
    });

    /**
     * When the number of conflict files exceeds the threshold, the conflict
     * is non-reworkable. This is the common case for large conflicts.
     */
    it("classifies as non_reworkable when conflict count exceeds threshold", () => {
      const files = [
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
        "src/d.ts",
        "src/e.ts",
        "src/f.ts",
        "src/g.ts",
      ];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("non_reworkable");
      expect(result.reason).toContain("7");
    });

    /**
     * When the number of conflict files is below the threshold and no
     * protected paths are matched, the conflict is reworkable.
     */
    it("classifies as reworkable when conflict count is below threshold", () => {
      const files = ["src/a.ts", "src/b.ts"];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("reworkable");
    });

    /**
     * A threshold of 1 means any conflict is non-reworkable (very strict).
     */
    it("enforces threshold of 1 correctly", () => {
      const policy: MergeConflictPolicy = {
        maxConflictFiles: 1,
        protectedPaths: [],
      };
      const result = classifyConflict(["src/a.ts"], policy);
      expect(result.classification).toBe("non_reworkable");
    });

    /**
     * A large threshold allows many conflicts to remain reworkable.
     */
    it("allows many conflicts with high threshold", () => {
      const policy: MergeConflictPolicy = {
        maxConflictFiles: 100,
        protectedPaths: [],
      };
      const files = Array.from({ length: 99 }, (_, i) => `src/file-${i}.ts`);
      const result = classifyConflict(files, policy);
      expect(result.classification).toBe("reworkable");
    });
  });

  // -------------------------------------------------------------------------
  // Protected path matching
  // -------------------------------------------------------------------------

  describe("protected path matching", () => {
    /**
     * A conflict in `.github/workflows/ci.yml` matches the `.github/`
     * directory prefix pattern — this is non-reworkable.
     */
    it("detects conflicts in .github/ directory", () => {
      const files = [".github/workflows/ci.yml"];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("non_reworkable");
      expect(result.reason).toContain(".github/");
      expect(result.reason).toContain("protected path");
    });

    /**
     * A conflict in `package.json` (exact match) is non-reworkable.
     */
    it("detects conflicts in package.json", () => {
      const files = ["package.json"];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("non_reworkable");
      expect(result.reason).toContain("package.json");
    });

    /**
     * A conflict in `pnpm-lock.yaml` is non-reworkable.
     */
    it("detects conflicts in pnpm-lock.yaml", () => {
      const files = ["pnpm-lock.yaml"];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("non_reworkable");
      expect(result.reason).toContain("pnpm-lock.yaml");
    });

    /**
     * A deeply nested file under `.github/` still matches the directory
     * prefix pattern. This verifies the "**" glob expansion for "/" suffixes.
     */
    it("matches deeply nested files under directory prefix", () => {
      const files = [".github/actions/setup/action.yml"];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("non_reworkable");
      expect(result.reason).toContain(".github/");
    });

    /**
     * Protected path matching is evaluated even when only one file is in
     * conflict and it's below the count threshold.
     */
    it("protected path takes precedence over low file count", () => {
      const files = ["package.json"];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("non_reworkable");
    });

    /**
     * When multiple files are in conflict but only one matches a protected
     * path, the classification is still non-reworkable. The reason should
     * reference the first matching file.
     */
    it("reports first matching protected file in reason", () => {
      const files = ["src/utils.ts", "package.json", ".github/ci.yml"];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("non_reworkable");
      // package.json is checked before .github/ because it comes first
      // in conflictFiles iteration
      expect(result.reason).toContain("package.json");
    });

    /**
     * A file named `packages/foo/package.json` should NOT match the
     * exact `package.json` pattern — picomatch matches against the full
     * path, so only root `package.json` matches.
     */
    it("does not match nested package.json with exact pattern", () => {
      const files = ["packages/foo/package.json"];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("reworkable");
    });

    /**
     * Custom protected paths can use full glob patterns like `**\/*.lock`.
     */
    it("supports glob wildcard patterns in protected paths", () => {
      const policy: MergeConflictPolicy = {
        maxConflictFiles: 10,
        protectedPaths: ["**/*.lock"],
      };
      const files = ["packages/foo/yarn.lock"];
      const result = classifyConflict(files, policy);
      expect(result.classification).toBe("non_reworkable");
      expect(result.reason).toContain("**/*.lock");
    });

    /**
     * Custom protected paths can match specific subdirectories.
     */
    it("supports custom directory prefix patterns", () => {
      const policy: MergeConflictPolicy = {
        maxConflictFiles: 10,
        protectedPaths: ["migrations/"],
      };
      const files = ["migrations/001-init.sql"];
      const result = classifyConflict(files, policy);
      expect(result.classification).toBe("non_reworkable");
    });

    /**
     * When no protected paths are configured, only the file count threshold
     * determines classification.
     */
    it("skips protected path check when protectedPaths is empty", () => {
      const files = ["package.json", ".github/ci.yml"];
      const result = classifyConflict(files, NO_PROTECTED_PATHS_POLICY);
      expect(result.classification).toBe("reworkable");
    });
  });

  // -------------------------------------------------------------------------
  // Reworkable classification
  // -------------------------------------------------------------------------

  describe("reworkable classification", () => {
    /**
     * A small number of conflict files in non-protected paths is reworkable.
     * This is the happy path for developer-fixable conflicts.
     */
    it("classifies non-protected files below threshold as reworkable", () => {
      const files = ["src/index.ts", "src/utils.ts"];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("reworkable");
      expect(result.reason).toContain("2 conflict file(s)");
      expect(result.reason).toContain("none in protected paths");
    });

    /**
     * A single conflict file in a non-protected path is reworkable.
     */
    it("classifies single non-protected file as reworkable", () => {
      const files = ["src/app.ts"];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("reworkable");
    });

    /**
     * Four conflict files (just under the default threshold of 5) in
     * non-protected paths — reworkable.
     */
    it("classifies files just under threshold as reworkable", () => {
      const files = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("reworkable");
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    /**
     * An empty conflict file list should be classified as reworkable.
     * This can happen if the rebase reports failure but no specific
     * conflict files (edge case in git).
     */
    it("classifies empty conflict list as reworkable", () => {
      const result = classifyConflict([], DEFAULT_POLICY);
      expect(result.classification).toBe("reworkable");
      expect(result.reason).toBe("No conflict files");
    });

    /**
     * With maxConflictFiles set to 0, ANY conflict is non-reworkable.
     * This is an extreme policy configuration but should be handled.
     */
    it("handles zero threshold — all conflicts non-reworkable", () => {
      const policy: MergeConflictPolicy = {
        maxConflictFiles: 0,
        protectedPaths: [],
      };
      // Even empty list has length 0 which is >= 0
      const result = classifyConflict([], policy);
      expect(result.classification).toBe("non_reworkable");
    });

    /**
     * File count threshold is evaluated before protected paths. If the
     * count alone makes the conflict non-reworkable, the reason should
     * reference the count, not protected paths.
     */
    it("evaluates file count before protected paths", () => {
      const files = ["package.json", ".github/ci.yml", "src/a.ts", "src/b.ts", "src/c.ts"];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("non_reworkable");
      expect(result.reason).toContain("threshold");
    });

    /**
     * Dot-prefixed files that are NOT in protected paths should not
     * trigger false positives. The `dot: true` option in picomatch
     * enables matching but doesn't make all dot-files protected.
     */
    it("does not false-positive on unprotected dot files", () => {
      const files = [".eslintrc.json"];
      const result = classifyConflict(files, DEFAULT_POLICY);
      expect(result.classification).toBe("reworkable");
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: DEFAULT_MERGE_CONFLICT_POLICY
// ---------------------------------------------------------------------------

describe("DEFAULT_MERGE_CONFLICT_POLICY", () => {
  /**
   * Verify the default policy matches PRD §10.10.2 specification.
   * This test acts as a regression guard — if someone changes the defaults,
   * this test fails, prompting a review of whether the change is intentional.
   */
  it("matches PRD §10.10.2 V1 defaults", () => {
    expect(DEFAULT_MERGE_CONFLICT_POLICY).toEqual({
      maxConflictFiles: 5,
      protectedPaths: [".github/", "package.json", "pnpm-lock.yaml"],
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: createConflictClassifierService (ConflictClassifierPort)
// ---------------------------------------------------------------------------

describe("createConflictClassifierService", () => {
  /**
   * The factory function must return an object that satisfies the
   * ConflictClassifierPort interface — it has a `classify` method
   * that returns a Promise of ConflictClassification.
   */
  it("returns a ConflictClassifierPort implementation", () => {
    const classifier = createConflictClassifierService();
    expect(classifier).toHaveProperty("classify");
    expect(typeof classifier.classify).toBe("function");
  });

  /**
   * The classifier uses default policy when none is provided.
   * A conflict in a protected path should be non-reworkable.
   */
  it("uses default policy when none provided", async () => {
    const classifier = createConflictClassifierService();
    const result = await classifier.classify(["package.json"]);
    expect(result).toBe("non_reworkable");
  });

  /**
   * The classifier returns "reworkable" for non-protected files
   * below the threshold.
   */
  it("returns reworkable for safe conflicts", async () => {
    const classifier = createConflictClassifierService();
    const result = await classifier.classify(["src/app.ts"]);
    expect(result).toBe("reworkable");
  });

  /**
   * Custom policy thresholds are respected by the classifier.
   */
  it("respects custom policy thresholds", async () => {
    const classifier = createConflictClassifierService({
      maxConflictFiles: 2,
      protectedPaths: [],
    });
    const result = await classifier.classify(["src/a.ts", "src/b.ts"]);
    expect(result).toBe("non_reworkable");
  });

  /**
   * Custom protected paths are respected by the classifier.
   */
  it("respects custom protected paths", async () => {
    const classifier = createConflictClassifierService({
      maxConflictFiles: 10,
      protectedPaths: ["config/"],
    });
    const result = await classifier.classify(["config/database.yml"]);
    expect(result).toBe("non_reworkable");
  });

  /**
   * The classify method returns a Promise (async), matching the
   * ConflictClassifierPort contract.
   */
  it("returns a Promise", () => {
    const classifier = createConflictClassifierService();
    const result = classifier.classify(["src/a.ts"]);
    expect(result).toBeInstanceOf(Promise);
  });
});

// ---------------------------------------------------------------------------
// Tests: createDetailedConflictClassifier
// ---------------------------------------------------------------------------

describe("createDetailedConflictClassifier", () => {
  /**
   * The detailed classifier returns a ConflictClassificationResult with
   * both classification and reason — useful for audit logging and
   * MergePacket metadata.
   */
  it("returns classification and reason for reworkable conflicts", () => {
    const classify = createDetailedConflictClassifier();
    const result = classify(["src/utils.ts"]);
    expect(result.classification).toBe("reworkable");
    expect(result.reason).toContain("1 conflict file(s)");
  });

  /**
   * Non-reworkable results include the reason, which helps operators
   * understand why a merge failed.
   */
  it("returns classification and reason for non-reworkable conflicts", () => {
    const classify = createDetailedConflictClassifier();
    const result = classify(["package.json"]);
    expect(result.classification).toBe("non_reworkable");
    expect(result.reason).toContain("protected path");
  });

  /**
   * Custom policy is forwarded to the underlying classifyConflict call.
   */
  it("respects custom policy", () => {
    const classify = createDetailedConflictClassifier({
      maxConflictFiles: 1,
      protectedPaths: [],
    });
    const result = classify(["src/a.ts"]);
    expect(result.classification).toBe("non_reworkable");
    expect(result.reason).toContain("threshold");
  });
});
