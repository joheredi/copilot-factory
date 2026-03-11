/**
 * Tests for the Review Router service.
 *
 * The Review Router is a pure deterministic function that routes reviews to
 * specialist reviewers based on changed files, task tags, risk level, and
 * repository configuration. These tests verify all rule evaluation tiers
 * (§10.6.2), edge cases, and the V1 invariant that "general" is always required.
 *
 * @module @factory/application/services/review-router.service.test
 * @see {@link file://docs/prd/010-integration-contracts.md} §10.6 Review Routing Contract
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RiskLevel } from "@factory/domain";

import {
  createReviewRouterService,
  evaluateCondition,
  categorizeRules,
} from "./review-router.service.js";
import type {
  ReviewRouterService,
  ReviewRoutingInput,
  ReviewRoutingRule,
  ReviewRoutingCondition,
} from "./review-router.service.js";

// ─── Test Data Builders ─────────────────────────────────────────────────────

/**
 * Creates a ReviewRoutingInput with sensible defaults.
 * Override any field for specific test scenarios.
 */
function createInput(overrides: Partial<ReviewRoutingInput> = {}): ReviewRoutingInput {
  return {
    changedFilePaths: [],
    taskTags: [],
    taskDomain: undefined,
    riskLevel: RiskLevel.LOW,
    repositoryRequiredReviewers: [],
    routingConfig: { rules: [] },
    ...overrides,
  };
}

/**
 * Creates a ReviewRoutingRule with sensible defaults.
 * Override any field for specific test scenarios.
 */
function createRule(overrides: Partial<ReviewRoutingRule> = {}): ReviewRoutingRule {
  return {
    name: "test-rule",
    when: {},
    ...overrides,
  };
}

// ─── evaluateCondition ──────────────────────────────────────────────────────

describe("evaluateCondition", () => {
  /**
   * Validates that a condition with no fields never matches.
   * This prevents accidental "match everything" behavior from empty conditions,
   * which would assign unintended reviewers.
   */
  it("returns false for an empty condition (no fields defined)", () => {
    const condition: ReviewRoutingCondition = {};
    const input = createInput({ changedFilePaths: ["src/foo.ts"] });
    expect(evaluateCondition(condition, input)).toBe(false);
  });

  /**
   * Validates that a condition with empty arrays (but defined fields) does
   * not match. This is a degenerate case that should behave like "no condition."
   */
  it("returns false for a condition with empty arrays", () => {
    const condition: ReviewRoutingCondition = {
      changed_path_matches: [],
      task_tag_in: [],
      risk_level_in: [],
    };
    const input = createInput({ changedFilePaths: ["src/foo.ts"] });
    expect(evaluateCondition(condition, input)).toBe(false);
  });

  // ── Path-based matching ──

  describe("path-based matching", () => {
    /**
     * Validates that glob pattern `src/auth/**` matches files nested under
     * src/auth/. This is the primary path-matching mechanism from §10.6.3.
     */
    it("matches files using glob patterns with **", () => {
      const condition: ReviewRoutingCondition = {
        changed_path_matches: ["src/auth/**"],
      };
      const input = createInput({ changedFilePaths: ["src/auth/login.ts"] });
      expect(evaluateCondition(condition, input)).toBe(true);
    });

    /**
     * Validates that deeply nested files also match `**` glob patterns.
     */
    it("matches deeply nested files", () => {
      const condition: ReviewRoutingCondition = {
        changed_path_matches: ["src/auth/**"],
      };
      const input = createInput({ changedFilePaths: ["src/auth/providers/oauth/google.ts"] });
      expect(evaluateCondition(condition, input)).toBe(true);
    });

    /**
     * Validates that a glob pattern does NOT match files in different directories.
     */
    it("does not match files outside the glob pattern", () => {
      const condition: ReviewRoutingCondition = {
        changed_path_matches: ["src/auth/**"],
      };
      const input = createInput({ changedFilePaths: ["src/api/routes.ts"] });
      expect(evaluateCondition(condition, input)).toBe(false);
    });

    /**
     * Validates that matching succeeds when ANY changed file matches
     * ANY pattern (logical OR across files and patterns).
     */
    it("matches if any file matches any of multiple patterns", () => {
      const condition: ReviewRoutingCondition = {
        changed_path_matches: ["src/auth/**", "packages/security/**"],
      };
      const input = createInput({
        changedFilePaths: ["src/api/routes.ts", "packages/security/crypto.ts"],
      });
      expect(evaluateCondition(condition, input)).toBe(true);
    });

    /**
     * Validates that none of multiple files matching none of the patterns
     * correctly returns false.
     */
    it("returns false when no files match any pattern", () => {
      const condition: ReviewRoutingCondition = {
        changed_path_matches: ["src/auth/**", "packages/security/**"],
      };
      const input = createInput({
        changedFilePaths: ["src/api/routes.ts", "src/utils/helpers.ts"],
      });
      expect(evaluateCondition(condition, input)).toBe(false);
    });

    /**
     * Validates that glob patterns with single `*` only match within
     * a single directory level.
     */
    it("matches single-level glob patterns", () => {
      const condition: ReviewRoutingCondition = {
        changed_path_matches: ["src/*.ts"],
      };
      const inputMatch = createInput({ changedFilePaths: ["src/index.ts"] });
      const inputNoMatch = createInput({ changedFilePaths: ["src/auth/index.ts"] });
      expect(evaluateCondition(condition, inputMatch)).toBe(true);
      expect(evaluateCondition(condition, inputNoMatch)).toBe(false);
    });

    /**
     * Validates that no changed files means path conditions cannot match.
     */
    it("returns false when changedFilePaths is empty", () => {
      const condition: ReviewRoutingCondition = {
        changed_path_matches: ["src/auth/**"],
      };
      const input = createInput({ changedFilePaths: [] });
      expect(evaluateCondition(condition, input)).toBe(false);
    });
  });

  // ── Tag matching ──

  describe("tag matching", () => {
    /**
     * Validates that task tags match when the task has one of the specified tags.
     */
    it("matches when task has a matching tag", () => {
      const condition: ReviewRoutingCondition = {
        task_tag_in: ["auth", "security"],
      };
      const input = createInput({ taskTags: ["auth", "api"] });
      expect(evaluateCondition(condition, input)).toBe(true);
    });

    /**
     * Validates that tag matching returns false when no tags overlap.
     */
    it("returns false when no tags match", () => {
      const condition: ReviewRoutingCondition = {
        task_tag_in: ["auth", "security"],
      };
      const input = createInput({ taskTags: ["ui", "frontend"] });
      expect(evaluateCondition(condition, input)).toBe(false);
    });

    /**
     * Validates that tag matching returns false when task has no tags.
     */
    it("returns false when task has no tags", () => {
      const condition: ReviewRoutingCondition = {
        task_tag_in: ["auth"],
      };
      const input = createInput({ taskTags: [] });
      expect(evaluateCondition(condition, input)).toBe(false);
    });
  });

  // ── Domain matching ──

  describe("domain matching", () => {
    /**
     * Validates that domain matching works when the task domain is specified.
     */
    it("matches when task domain is in the condition set", () => {
      const condition: ReviewRoutingCondition = {
        task_domain_in: ["authentication", "payments"],
      };
      const input = createInput({ taskDomain: "authentication" });
      expect(evaluateCondition(condition, input)).toBe(true);
    });

    /**
     * Validates that domain matching fails when the domain doesn't match.
     */
    it("returns false when task domain is not in the condition set", () => {
      const condition: ReviewRoutingCondition = {
        task_domain_in: ["authentication"],
      };
      const input = createInput({ taskDomain: "analytics" });
      expect(evaluateCondition(condition, input)).toBe(false);
    });

    /**
     * Validates that domain matching fails when the task has no domain.
     */
    it("returns false when task has no domain", () => {
      const condition: ReviewRoutingCondition = {
        task_domain_in: ["authentication"],
      };
      const input = createInput({ taskDomain: undefined });
      expect(evaluateCondition(condition, input)).toBe(false);
    });
  });

  // ── Risk level matching ──

  describe("risk level matching", () => {
    /**
     * Validates that risk level matching works for high-risk tasks.
     */
    it("matches when task risk level is in the condition set", () => {
      const condition: ReviewRoutingCondition = {
        risk_level_in: ["high", "critical"],
      };
      const input = createInput({ riskLevel: RiskLevel.HIGH });
      expect(evaluateCondition(condition, input)).toBe(true);
    });

    /**
     * Validates that risk level matching fails for non-matching levels.
     */
    it("returns false when risk level is not in the condition set", () => {
      const condition: ReviewRoutingCondition = {
        risk_level_in: ["high"],
      };
      const input = createInput({ riskLevel: RiskLevel.LOW });
      expect(evaluateCondition(condition, input)).toBe(false);
    });
  });

  // ── Compound conditions (AND logic) ──

  describe("compound conditions (AND logic)", () => {
    /**
     * Validates that when multiple condition fields are present, ALL must match
     * (logical AND). This is critical for precision in routing — we don't want
     * a path match alone to trigger a rule that also requires a specific risk level.
     */
    it("requires all fields to match when multiple are present", () => {
      const condition: ReviewRoutingCondition = {
        changed_path_matches: ["src/auth/**"],
        risk_level_in: ["high"],
      };

      // Path matches but risk doesn't → false
      const inputPathOnly = createInput({
        changedFilePaths: ["src/auth/login.ts"],
        riskLevel: RiskLevel.LOW,
      });
      expect(evaluateCondition(condition, inputPathOnly)).toBe(false);

      // Risk matches but path doesn't → false
      const inputRiskOnly = createInput({
        changedFilePaths: ["src/api/routes.ts"],
        riskLevel: RiskLevel.HIGH,
      });
      expect(evaluateCondition(condition, inputRiskOnly)).toBe(false);

      // Both match → true
      const inputBoth = createInput({
        changedFilePaths: ["src/auth/login.ts"],
        riskLevel: RiskLevel.HIGH,
      });
      expect(evaluateCondition(condition, inputBoth)).toBe(true);
    });

    /**
     * Validates three-way AND: path + tag + risk must all match.
     */
    it("requires all three fields to match for a triple condition", () => {
      const condition: ReviewRoutingCondition = {
        changed_path_matches: ["src/payments/**"],
        task_tag_in: ["billing"],
        risk_level_in: ["high"],
      };

      const input = createInput({
        changedFilePaths: ["src/payments/checkout.ts"],
        taskTags: ["billing"],
        riskLevel: RiskLevel.HIGH,
      });
      expect(evaluateCondition(condition, input)).toBe(true);

      // Missing one → false
      const inputMissingTag = createInput({
        changedFilePaths: ["src/payments/checkout.ts"],
        taskTags: ["api"],
        riskLevel: RiskLevel.HIGH,
      });
      expect(evaluateCondition(condition, inputMissingTag)).toBe(false);
    });
  });
});

// ─── categorizeRules ────────────────────────────────────────────────────────

describe("categorizeRules", () => {
  /**
   * Validates that rules are correctly sorted into path-based, tag/domain,
   * and risk-based categories. This ensures the evaluation order from §10.6.2
   * is maintained.
   */
  it("categorizes rules into the correct tiers", () => {
    const pathRule = createRule({
      name: "path-rule",
      when: { changed_path_matches: ["src/**"] },
    });
    const tagRule = createRule({
      name: "tag-rule",
      when: { task_tag_in: ["auth"] },
    });
    const domainRule = createRule({
      name: "domain-rule",
      when: { task_domain_in: ["payments"] },
    });
    const riskRule = createRule({
      name: "risk-rule",
      when: { risk_level_in: ["high"] },
    });

    const result = categorizeRules([pathRule, tagRule, domainRule, riskRule]);

    expect(result.pathBased).toEqual([pathRule]);
    expect(result.tagDomain).toEqual([tagRule, domainRule]);
    expect(result.riskBased).toEqual([riskRule]);
  });

  /**
   * Validates that a rule with multiple condition fields appears in
   * multiple categories. This is correct because the rule should be
   * evaluated in each tier it belongs to.
   */
  it("places multi-field rules into multiple categories", () => {
    const multiRule = createRule({
      name: "multi-rule",
      when: {
        changed_path_matches: ["src/auth/**"],
        task_tag_in: ["auth"],
        risk_level_in: ["high"],
      },
    });

    const result = categorizeRules([multiRule]);

    expect(result.pathBased).toEqual([multiRule]);
    expect(result.tagDomain).toEqual([multiRule]);
    expect(result.riskBased).toEqual([multiRule]);
  });

  /**
   * Validates that rules with no condition fields are not categorized
   * (they have no trigger and will never fire).
   */
  it("excludes rules with empty or undefined conditions", () => {
    const emptyRule = createRule({ name: "empty", when: {} });
    const result = categorizeRules([emptyRule]);

    expect(result.pathBased).toEqual([]);
    expect(result.tagDomain).toEqual([]);
    expect(result.riskBased).toEqual([]);
  });
});

// ─── ReviewRouterService ────────────────────────────────────────────────────

describe("ReviewRouterService", () => {
  let service: ReviewRouterService;

  beforeEach(() => {
    service = createReviewRouterService();
  });

  // ── V1 invariant: general reviewer always required ──

  describe("V1 invariant — general reviewer", () => {
    /**
     * Validates the critical V1 invariant from §9.9: the "general" reviewer
     * type is always in required_reviewers regardless of configuration.
     * This ensures every task gets at least one review perspective.
     */
    it("always includes general in required reviewers", () => {
      const input = createInput();
      const decision = service.routeReview(input);

      expect(decision.requiredReviewers).toContain("general");
    });

    /**
     * Validates that general appears in the rationale with the correct reason.
     */
    it("includes rationale for general reviewer", () => {
      const input = createInput();
      const decision = service.routeReview(input);

      const generalRationale = decision.routingRationale.find((r) => r.reviewerType === "general");
      expect(generalRationale).toBeDefined();
      expect(generalRationale!.requirement).toBe("required");
    });

    /**
     * Validates that even with no rules and no repository-required reviewers,
     * general is still present. This is the minimal routing decision.
     */
    it("returns general as only required reviewer with empty configuration", () => {
      const input = createInput();
      const decision = service.routeReview(input);

      expect(decision.requiredReviewers).toEqual(["general"]);
      expect(decision.optionalReviewers).toEqual([]);
    });
  });

  // ── Step 1: Repository-required reviewers ──

  describe("step 1 — repository-required reviewers", () => {
    /**
     * Validates that explicitly configured repository-required reviewers are
     * included in required_reviewers. This is evaluated first per §10.6.2.
     */
    it("adds repository-required reviewers to required set", () => {
      const input = createInput({
        repositoryRequiredReviewers: ["security", "architecture"],
      });
      const decision = service.routeReview(input);

      expect(decision.requiredReviewers).toContain("security");
      expect(decision.requiredReviewers).toContain("architecture");
    });

    /**
     * Validates that general is not duplicated when also present in
     * repository-required reviewers.
     */
    it("does not duplicate general if listed in repository-required", () => {
      const input = createInput({
        repositoryRequiredReviewers: ["general", "security"],
      });
      const decision = service.routeReview(input);

      const generalCount = decision.requiredReviewers.filter((r) => r === "general").length;
      expect(generalCount).toBe(1);
    });

    /**
     * Validates that rationale entries exist for each repository-required reviewer.
     */
    it("provides rationale for each repository-required reviewer", () => {
      const input = createInput({
        repositoryRequiredReviewers: ["security"],
      });
      const decision = service.routeReview(input);

      const securityRationale = decision.routingRationale.find(
        (r) => r.reviewerType === "security" && r.requirement === "required",
      );
      expect(securityRationale).toBeDefined();
      expect(securityRationale!.reason).toContain("repository configuration");
    });
  });

  // ── Step 2: Path-based rules ──

  describe("step 2 — path-based rules", () => {
    /**
     * Validates the canonical example from §10.6.3: auth paths require security review.
     */
    it("requires security reviewer when auth paths are changed", () => {
      const input = createInput({
        changedFilePaths: ["src/auth/login.ts", "src/auth/session.ts"],
        routingConfig: {
          rules: [
            {
              name: "auth-paths-require-security",
              when: { changed_path_matches: ["src/auth/**", "packages/security/**"] },
              require_reviewers: ["security"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      expect(decision.requiredReviewers).toContain("security");
      const rationale = decision.routingRationale.find((r) => r.reviewerType === "security");
      expect(rationale).toBeDefined();
      expect(rationale!.reason).toContain("auth-paths-require-security");
      expect(rationale!.reason).toContain("path-based");
    });

    /**
     * Validates that path-based rules do not fire when no files match.
     */
    it("does not add reviewer when no paths match", () => {
      const input = createInput({
        changedFilePaths: ["src/utils/helpers.ts"],
        routingConfig: {
          rules: [
            {
              name: "auth-paths-require-security",
              when: { changed_path_matches: ["src/auth/**"] },
              require_reviewers: ["security"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      expect(decision.requiredReviewers).not.toContain("security");
    });

    /**
     * Validates that path-based rules can add optional reviewers.
     */
    it("adds optional reviewers from path-based rules", () => {
      const input = createInput({
        changedFilePaths: ["src/api/routes.ts"],
        routingConfig: {
          rules: [
            {
              name: "api-paths-suggest-performance",
              when: { changed_path_matches: ["src/api/**"] },
              optional_reviewers: ["performance"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      expect(decision.optionalReviewers).toContain("performance");
      expect(decision.requiredReviewers).not.toContain("performance");
    });
  });

  // ── Step 3: Tag/domain rules ──

  describe("step 3 — tag/domain rules", () => {
    /**
     * Validates that tag-based rules fire when the task has a matching tag.
     */
    it("requires reviewer when task tag matches", () => {
      const input = createInput({
        taskTags: ["database", "migration"],
        routingConfig: {
          rules: [
            {
              name: "db-tasks-require-dba",
              when: { task_tag_in: ["database"] },
              require_reviewers: ["database"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      expect(decision.requiredReviewers).toContain("database");
    });

    /**
     * Validates that domain-based rules fire when the task domain matches.
     */
    it("requires reviewer when task domain matches", () => {
      const input = createInput({
        taskDomain: "payments",
        routingConfig: {
          rules: [
            {
              name: "payments-domain-require-finops",
              when: { task_domain_in: ["payments", "billing"] },
              require_reviewers: ["finops"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      expect(decision.requiredReviewers).toContain("finops");
    });

    /**
     * Validates that tag/domain rules do not fire when no match.
     */
    it("does not fire tag rule when no tags match", () => {
      const input = createInput({
        taskTags: ["frontend"],
        routingConfig: {
          rules: [
            {
              name: "db-tasks-require-dba",
              when: { task_tag_in: ["database"] },
              require_reviewers: ["database"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      expect(decision.requiredReviewers).not.toContain("database");
    });
  });

  // ── Step 4: Risk-based rules ──

  describe("step 4 — risk-based rules", () => {
    /**
     * Validates the canonical example from §10.6.3: high-risk tasks require
     * architecture review.
     */
    it("requires architecture reviewer for high-risk tasks", () => {
      const input = createInput({
        riskLevel: RiskLevel.HIGH,
        routingConfig: {
          rules: [
            {
              name: "high-risk-require-architecture",
              when: { risk_level_in: ["high"] },
              require_reviewers: ["architecture"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      expect(decision.requiredReviewers).toContain("architecture");
      const rationale = decision.routingRationale.find((r) => r.reviewerType === "architecture");
      expect(rationale!.reason).toContain("high-risk-require-architecture");
      expect(rationale!.reason).toContain("risk-based");
    });

    /**
     * Validates that risk-based rules don't fire for non-matching risk levels.
     */
    it("does not require architecture for low-risk tasks", () => {
      const input = createInput({
        riskLevel: RiskLevel.LOW,
        routingConfig: {
          rules: [
            {
              name: "high-risk-require-architecture",
              when: { risk_level_in: ["high"] },
              require_reviewers: ["architecture"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      expect(decision.requiredReviewers).not.toContain("architecture");
    });
  });

  // ── Deduplication and promotion ──

  describe("deduplication and promotion", () => {
    /**
     * Validates that a reviewer type appearing in both required and optional
     * rules ends up only in required (promotion). This prevents contradictory
     * assignments where a reviewer is simultaneously required and optional.
     */
    it("promotes optional to required when a later rule requires the same type", () => {
      const input = createInput({
        changedFilePaths: ["src/api/routes.ts"],
        riskLevel: RiskLevel.HIGH,
        routingConfig: {
          rules: [
            {
              name: "api-suggest-security",
              when: { changed_path_matches: ["src/api/**"] },
              optional_reviewers: ["security"],
            },
            {
              name: "high-risk-require-security",
              when: { risk_level_in: ["high"] },
              require_reviewers: ["security"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      expect(decision.requiredReviewers).toContain("security");
      expect(decision.optionalReviewers).not.toContain("security");
    });

    /**
     * Validates that a reviewer already required is not added again as optional.
     */
    it("does not add required reviewer as optional from a later rule", () => {
      const input = createInput({
        changedFilePaths: ["src/auth/login.ts"],
        riskLevel: RiskLevel.HIGH,
        routingConfig: {
          rules: [
            {
              name: "auth-require-security",
              when: { changed_path_matches: ["src/auth/**"] },
              require_reviewers: ["security"],
            },
            {
              name: "high-risk-suggest-security",
              when: { risk_level_in: ["high"] },
              optional_reviewers: ["security"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      expect(decision.requiredReviewers).toContain("security");
      expect(decision.optionalReviewers).not.toContain("security");
    });

    /**
     * Validates that duplicate required reviewer entries from multiple rules
     * result in only one entry in required_reviewers (set semantics).
     */
    it("deduplicates required reviewers from multiple rules", () => {
      const input = createInput({
        changedFilePaths: ["src/auth/login.ts"],
        taskTags: ["auth"],
        routingConfig: {
          rules: [
            {
              name: "auth-path-require-security",
              when: { changed_path_matches: ["src/auth/**"] },
              require_reviewers: ["security"],
            },
            {
              name: "auth-tag-require-security",
              when: { task_tag_in: ["auth"] },
              require_reviewers: ["security"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      const securityCount = decision.requiredReviewers.filter((r) => r === "security").length;
      expect(securityCount).toBe(1);
    });
  });

  // ── Complex routing scenarios ──

  describe("complex routing scenarios", () => {
    /**
     * Validates a realistic multi-rule scenario with rules from all tiers.
     * This tests the full evaluation pipeline with mixed required and optional
     * reviewers across path, tag, and risk categories.
     */
    it("handles a complex multi-rule scenario", () => {
      const rules: ReviewRoutingRule[] = [
        {
          name: "auth-paths-require-security",
          when: { changed_path_matches: ["src/auth/**", "packages/security/**"] },
          require_reviewers: ["security"],
        },
        {
          name: "db-migration-require-dba",
          when: { changed_path_matches: ["**/migrations/**"] },
          require_reviewers: ["database"],
        },
        {
          name: "api-suggest-performance",
          when: { changed_path_matches: ["src/api/**"] },
          optional_reviewers: ["performance"],
        },
        {
          name: "billing-domain-require-finops",
          when: { task_domain_in: ["billing", "payments"] },
          require_reviewers: ["finops"],
        },
        {
          name: "high-risk-require-architecture",
          when: { risk_level_in: ["high"] },
          require_reviewers: ["architecture"],
        },
      ];

      const input = createInput({
        changedFilePaths: [
          "src/auth/session.ts",
          "src/api/payments/charge.ts",
          "db/migrations/001-add-payments.sql",
        ],
        taskTags: ["billing"],
        taskDomain: "payments",
        riskLevel: RiskLevel.HIGH,
        routingConfig: { rules },
      });

      const decision = service.routeReview(input);

      // Required: general (always), security (auth path), database (migration path),
      //           finops (payments domain), architecture (high risk)
      expect(decision.requiredReviewers).toContain("general");
      expect(decision.requiredReviewers).toContain("security");
      expect(decision.requiredReviewers).toContain("database");
      expect(decision.requiredReviewers).toContain("finops");
      expect(decision.requiredReviewers).toContain("architecture");

      // Optional: performance (api path)
      expect(decision.optionalReviewers).toContain("performance");

      // Rationale should have entries for all
      expect(decision.routingRationale.length).toBeGreaterThanOrEqual(6);
    });

    /**
     * Validates that repository-required reviewers are combined with rule-based
     * reviewers without duplication.
     */
    it("combines repository-required with rule-based reviewers", () => {
      const input = createInput({
        changedFilePaths: ["src/auth/login.ts"],
        repositoryRequiredReviewers: ["compliance"],
        routingConfig: {
          rules: [
            {
              name: "auth-require-security",
              when: { changed_path_matches: ["src/auth/**"] },
              require_reviewers: ["security"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      expect(decision.requiredReviewers).toContain("general");
      expect(decision.requiredReviewers).toContain("compliance");
      expect(decision.requiredReviewers).toContain("security");
      expect(decision.requiredReviewers).toHaveLength(3);
    });

    /**
     * Validates that the evaluation order is maintained: path-based fires before
     * risk-based. This matters when a rule could be categorized in multiple tiers.
     */
    it("evaluates path rules before risk rules", () => {
      const input = createInput({
        changedFilePaths: ["src/auth/login.ts"],
        riskLevel: RiskLevel.HIGH,
        routingConfig: {
          rules: [
            {
              name: "high-risk-suggest-security",
              when: { risk_level_in: ["high"] },
              optional_reviewers: ["security"],
            },
            {
              name: "auth-require-security",
              when: { changed_path_matches: ["src/auth/**"] },
              require_reviewers: ["security"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      // Path-based rules evaluate first (step 2 before step 4),
      // so security is required (from path rule), not optional (from risk rule)
      expect(decision.requiredReviewers).toContain("security");
      expect(decision.optionalReviewers).not.toContain("security");
    });

    /**
     * Validates that with no changed files, no tags, no domain, and low risk,
     * only the general reviewer is assigned.
     */
    it("returns minimal assignment for empty input", () => {
      const input = createInput({
        routingConfig: {
          rules: [
            {
              name: "auth-require-security",
              when: { changed_path_matches: ["src/auth/**"] },
              require_reviewers: ["security"],
            },
            {
              name: "high-risk-require-arch",
              when: { risk_level_in: ["high"] },
              require_reviewers: ["architecture"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      expect(decision.requiredReviewers).toEqual(["general"]);
      expect(decision.optionalReviewers).toEqual([]);
    });
  });

  // ── Rationale ──

  describe("routing rationale", () => {
    /**
     * Validates that every reviewer in the decision has a corresponding
     * rationale entry. This is important for auditability — operators need
     * to understand why each reviewer was assigned.
     */
    it("provides rationale for every assigned reviewer", () => {
      const input = createInput({
        changedFilePaths: ["src/auth/login.ts"],
        repositoryRequiredReviewers: ["compliance"],
        riskLevel: RiskLevel.HIGH,
        routingConfig: {
          rules: [
            {
              name: "auth-require-security",
              when: { changed_path_matches: ["src/auth/**"] },
              require_reviewers: ["security"],
            },
            {
              name: "high-risk-require-arch",
              when: { risk_level_in: ["high"] },
              require_reviewers: ["architecture"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      const allReviewers = [...decision.requiredReviewers, ...decision.optionalReviewers];
      for (const reviewer of allReviewers) {
        const hasRationale = decision.routingRationale.some((r) => r.reviewerType === reviewer);
        expect(hasRationale).toBe(true);
      }
    });

    /**
     * Validates that rationale entries include the rule name that triggered them.
     * This allows operators to trace back to the specific rule configuration.
     */
    it("includes rule name in rationale for rule-based assignments", () => {
      const input = createInput({
        changedFilePaths: ["src/auth/login.ts"],
        routingConfig: {
          rules: [
            {
              name: "auth-paths-require-security",
              when: { changed_path_matches: ["src/auth/**"] },
              require_reviewers: ["security"],
            },
          ],
        },
      });

      const decision = service.routeReview(input);

      const securityRationale = decision.routingRationale.find(
        (r) => r.reviewerType === "security",
      );
      expect(securityRationale!.reason).toContain("auth-paths-require-security");
    });
  });
});
