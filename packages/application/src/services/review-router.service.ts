/**
 * Review Router service — deterministic routing of reviews to specialist reviewers.
 *
 * The Review Router evaluates a set of deterministic rules to determine which
 * specialist reviewers should review a task based on changed files, task tags,
 * risk level, and repository settings.
 *
 * Rule evaluation order (§10.6.2):
 * 1. Explicit repository-required reviewers
 * 2. Path-based rules (glob patterns against changed file paths)
 * 3. Task tag/domain rules
 * 4. Risk-based rules
 *
 * The "general" reviewer type is always required per V1 scope (§9.9).
 * AI recommendations (step 5 in §10.6.2) are out of scope for V1.
 *
 * @module @factory/application/services/review-router
 * @see {@link file://docs/prd/010-integration-contracts.md} §10.6 Review Routing Contract
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.9 Review Policy
 */

import type { RiskLevel } from "@factory/domain";

import picomatch from "picomatch";

// ─── Rule Configuration Types ───────────────────────────────────────────────

/**
 * A condition clause within a routing rule.
 *
 * Each field is optional. When multiple fields are present, ALL must match
 * (logical AND). At least one field must be present for the condition to be
 * evaluable.
 *
 * @see {@link file://docs/prd/010-integration-contracts.md} §10.6.3 Canonical Rule Shape
 */
export interface ReviewRoutingCondition {
  /**
   * Glob patterns matched against changed file paths.
   * The condition matches if ANY changed file matches ANY pattern.
   */
  readonly changed_path_matches?: readonly string[];

  /**
   * Task tag values. The condition matches if the task has ANY of these tags.
   */
  readonly task_tag_in?: readonly string[];

  /**
   * Task domain values. The condition matches if the task's domain matches ANY of these.
   */
  readonly task_domain_in?: readonly string[];

  /**
   * Risk levels. The condition matches if the task's risk level is one of these.
   */
  readonly risk_level_in?: readonly string[];
}

/**
 * A single review routing rule in the canonical shape from §10.6.3.
 *
 * Each rule has a name (for rationale), a `when` condition clause, and
 * lists of reviewer types to require or optionally suggest.
 *
 * @see {@link file://docs/prd/010-integration-contracts.md} §10.6.3 Canonical Rule Shape
 */
export interface ReviewRoutingRule {
  /** Human-readable rule name used in routing rationale. */
  readonly name: string;

  /** Condition clause — when this matches, the rule fires. */
  readonly when: ReviewRoutingCondition;

  /**
   * Reviewer types to add to required_reviewers when this rule fires.
   * These reviewers MUST complete their review before consolidation.
   */
  readonly require_reviewers?: readonly string[];

  /**
   * Reviewer types to add to optional_reviewers when this rule fires.
   * These reviewers MAY be consulted but are not required.
   */
  readonly optional_reviewers?: readonly string[];
}

/**
 * Complete review routing configuration for a repository.
 *
 * Contains the ordered list of rules and default required reviewer types.
 * The "general" reviewer type is always added to required_reviewers
 * regardless of configuration (V1 invariant from §9.9).
 */
export interface ReviewRoutingConfig {
  /** Ordered list of routing rules. Evaluated in array order within each category. */
  readonly rules: readonly ReviewRoutingRule[];
}

// ─── Routing Input ──────────────────────────────────────────────────────────

/**
 * Input to the Review Router containing all information needed to determine
 * reviewer assignment.
 *
 * @see {@link file://docs/prd/010-integration-contracts.md} §10.6.1 Inputs
 */
export interface ReviewRoutingInput {
  /** Repository-relative paths of files changed in the development result. */
  readonly changedFilePaths: readonly string[];

  /** Tags assigned to the task (e.g., "auth", "api", "database"). */
  readonly taskTags: readonly string[];

  /** Domain the task belongs to (e.g., "authentication", "payments"). */
  readonly taskDomain?: string;

  /** Risk level of the task as determined during planning. */
  readonly riskLevel: RiskLevel;

  /**
   * Reviewer types explicitly required by the repository configuration,
   * independent of any rule evaluation. These are evaluated first (step 1).
   */
  readonly repositoryRequiredReviewers: readonly string[];

  /** Routing rules from the repository/workflow template configuration. */
  readonly routingConfig: ReviewRoutingConfig;
}

// ─── Routing Output ─────────────────────────────────────────────────────────

/**
 * A single entry in the routing rationale explaining why a reviewer type
 * was included in the routing decision.
 */
export interface RoutingRationaleEntry {
  /** The reviewer type that was added. */
  readonly reviewerType: string;

  /** Whether this reviewer is required or optional. */
  readonly requirement: "required" | "optional";

  /** The rule or reason that caused this reviewer to be added. */
  readonly reason: string;
}

/**
 * The routing decision emitted by the Review Router.
 *
 * Contains the deduplicated sets of required and optional reviewers,
 * plus a rationale explaining each routing decision.
 *
 * @see {@link file://docs/prd/010-integration-contracts.md} §10.6.4 Output
 */
export interface RoutingDecision {
  /** Reviewer types that MUST complete a review before consolidation. */
  readonly requiredReviewers: readonly string[];

  /** Reviewer types that MAY be consulted but are not required. */
  readonly optionalReviewers: readonly string[];

  /** Ordered list of rationale entries explaining each routing decision. */
  readonly routingRationale: readonly RoutingRationaleEntry[];
}

// ─── Service Interface ──────────────────────────────────────────────────────

/**
 * Review Router service interface.
 *
 * Pure deterministic service — receives all inputs and produces a routing
 * decision without side effects or database lookups.
 */
export interface ReviewRouterService {
  /**
   * Routes a review to specialist reviewers based on deterministic rules.
   *
   * @param input - All information needed to determine reviewer assignment
   * @returns The routing decision with required/optional reviewers and rationale
   */
  routeReview(input: ReviewRoutingInput): RoutingDecision;
}

// ─── Rule Evaluation ────────────────────────────────────────────────────────

/**
 * The general reviewer type that is always required per V1 scope.
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.9 Review Policy
 */
const GENERAL_REVIEWER_TYPE = "general";

/**
 * Evaluates whether a routing condition matches the given input.
 *
 * All present condition fields must match (logical AND).
 * Within each field, any match suffices (logical OR).
 *
 * @param condition - The rule's condition clause
 * @param input - The routing input to evaluate against
 * @returns true if all condition fields match
 */
export function evaluateCondition(
  condition: ReviewRoutingCondition,
  input: ReviewRoutingInput,
): boolean {
  let hasAnyField = false;

  // Path-based matching: any changed file matches any glob pattern
  if (condition.changed_path_matches !== undefined && condition.changed_path_matches.length > 0) {
    hasAnyField = true;
    const matchers = condition.changed_path_matches.map((pattern) =>
      picomatch(pattern, { dot: true }),
    );
    const pathMatches = input.changedFilePaths.some((filePath) =>
      matchers.some((matcher) => matcher(filePath)),
    );
    if (!pathMatches) {
      return false;
    }
  }

  // Tag matching: task has any of the specified tags
  if (condition.task_tag_in !== undefined && condition.task_tag_in.length > 0) {
    hasAnyField = true;
    const tagSet = new Set(condition.task_tag_in);
    const tagMatches = input.taskTags.some((tag) => tagSet.has(tag));
    if (!tagMatches) {
      return false;
    }
  }

  // Domain matching: task domain matches any of the specified domains
  if (condition.task_domain_in !== undefined && condition.task_domain_in.length > 0) {
    hasAnyField = true;
    const domainSet = new Set(condition.task_domain_in);
    const domainMatches = input.taskDomain !== undefined && domainSet.has(input.taskDomain);
    if (!domainMatches) {
      return false;
    }
  }

  // Risk level matching: task risk level is one of the specified levels
  if (condition.risk_level_in !== undefined && condition.risk_level_in.length > 0) {
    hasAnyField = true;
    const riskSet = new Set(condition.risk_level_in);
    const riskMatches = riskSet.has(input.riskLevel);
    if (!riskMatches) {
      return false;
    }
  }

  // A condition with no fields never matches (safety guard)
  return hasAnyField;
}

/**
 * Categorizes rules into the four evaluation tiers from §10.6.2.
 *
 * Rules are categorized by their condition fields:
 * - Path-based: has `changed_path_matches`
 * - Tag/domain: has `task_tag_in` or `task_domain_in`
 * - Risk-based: has `risk_level_in`
 *
 * A rule may fall into multiple categories. It is evaluated once per
 * category it appears in, but its effects are deduplicated at the end.
 *
 * @param rules - All rules to categorize
 * @returns Rules grouped by category in evaluation order
 */
export function categorizeRules(rules: readonly ReviewRoutingRule[]): {
  readonly pathBased: readonly ReviewRoutingRule[];
  readonly tagDomain: readonly ReviewRoutingRule[];
  readonly riskBased: readonly ReviewRoutingRule[];
} {
  const pathBased: ReviewRoutingRule[] = [];
  const tagDomain: ReviewRoutingRule[] = [];
  const riskBased: ReviewRoutingRule[] = [];

  for (const rule of rules) {
    const { when } = rule;
    if (when.changed_path_matches !== undefined && when.changed_path_matches.length > 0) {
      pathBased.push(rule);
    }
    if (
      (when.task_tag_in !== undefined && when.task_tag_in.length > 0) ||
      (when.task_domain_in !== undefined && when.task_domain_in.length > 0)
    ) {
      tagDomain.push(rule);
    }
    if (when.risk_level_in !== undefined && when.risk_level_in.length > 0) {
      riskBased.push(rule);
    }
  }

  return { pathBased, tagDomain, riskBased };
}

// ─── Service Factory ────────────────────────────────────────────────────────

/**
 * Creates a Review Router service instance.
 *
 * The Review Router is a pure deterministic service with no external
 * dependencies. It evaluates routing rules in the order specified by
 * §10.6.2 and produces a routing decision.
 *
 * @returns A ReviewRouterService instance
 *
 * @example
 * ```ts
 * const router = createReviewRouterService();
 * const decision = router.routeReview({
 *   changedFilePaths: ["src/auth/login.ts"],
 *   taskTags: ["auth"],
 *   riskLevel: RiskLevel.HIGH,
 *   repositoryRequiredReviewers: [],
 *   routingConfig: {
 *     rules: [
 *       {
 *         name: "auth-paths-require-security",
 *         when: { changed_path_matches: ["src/auth/**"] },
 *         require_reviewers: ["security"],
 *       },
 *     ],
 *   },
 * });
 * // decision.requiredReviewers === ["general", "security"]
 * ```
 */
export function createReviewRouterService(): ReviewRouterService {
  return {
    routeReview(input: ReviewRoutingInput): RoutingDecision {
      const requiredSet = new Set<string>();
      const optionalSet = new Set<string>();
      const rationale: RoutingRationaleEntry[] = [];

      // ── Step 0: General reviewer is always required (V1 invariant §9.9) ──
      requiredSet.add(GENERAL_REVIEWER_TYPE);
      rationale.push({
        reviewerType: GENERAL_REVIEWER_TYPE,
        requirement: "required",
        reason: "General reviewer is always required per V1 review policy (§9.9)",
      });

      // ── Step 1: Explicit repository-required reviewers ──────────────────
      for (const reviewerType of input.repositoryRequiredReviewers) {
        if (!requiredSet.has(reviewerType)) {
          requiredSet.add(reviewerType);
          rationale.push({
            reviewerType,
            requirement: "required",
            reason: "Explicitly required by repository configuration",
          });
        }
      }

      // ── Steps 2–4: Rule-based evaluation in deterministic order ─────────
      const { pathBased, tagDomain, riskBased } = categorizeRules(input.routingConfig.rules);

      const evaluateRuleTier = (
        tierRules: readonly ReviewRoutingRule[],
        tierName: string,
      ): void => {
        for (const rule of tierRules) {
          if (!evaluateCondition(rule.when, input)) {
            continue;
          }

          // Add required reviewers from the matched rule
          if (rule.require_reviewers !== undefined) {
            for (const reviewerType of rule.require_reviewers) {
              if (!requiredSet.has(reviewerType)) {
                requiredSet.add(reviewerType);
                // If it was previously optional, remove from optional
                optionalSet.delete(reviewerType);
                rationale.push({
                  reviewerType,
                  requirement: "required",
                  reason: `Rule "${rule.name}" matched (${tierName})`,
                });
              }
            }
          }

          // Add optional reviewers from the matched rule
          if (rule.optional_reviewers !== undefined) {
            for (const reviewerType of rule.optional_reviewers) {
              // Only add as optional if not already required
              if (!requiredSet.has(reviewerType) && !optionalSet.has(reviewerType)) {
                optionalSet.add(reviewerType);
                rationale.push({
                  reviewerType,
                  requirement: "optional",
                  reason: `Rule "${rule.name}" matched (${tierName})`,
                });
              }
            }
          }
        }
      };

      // Step 2: Path-based rules
      evaluateRuleTier(pathBased, "path-based");

      // Step 3: Tag/domain rules
      evaluateRuleTier(tagDomain, "tag/domain");

      // Step 4: Risk-based rules
      evaluateRuleTier(riskBased, "risk-based");

      return {
        requiredReviewers: [...requiredSet],
        optionalReviewers: [...optionalSet],
        routingRationale: rationale,
      };
    },
  };
}
