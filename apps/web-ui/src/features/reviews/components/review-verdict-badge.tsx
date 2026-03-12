/**
 * Color-coded badge for specialist review verdicts and lead review decisions.
 *
 * Verdicts represent the judgment of specialist reviewers:
 * - **approved**: Green — review passed
 * - **changes_requested**: Red — blocking issues found
 * - **escalated**: Orange — reviewer cannot decide
 *
 * Lead decisions have the additional:
 * - **approved_with_follow_up**: Teal — approved but follow-up tasks needed
 *
 * @see packages/domain/src/enums.ts — ReviewVerdict and LeadReviewDecision enums
 * @see T097 — Build review center view
 */

import { Badge } from "../../../components/ui/badge";
import { cn } from "../../../lib/utils";

/** Tailwind classes for each verdict/decision value. */
const VERDICT_STYLES: Record<string, string> = {
  approved:
    "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
  approved_with_follow_up:
    "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300",
  changes_requested:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
  escalated:
    "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300",
};

/** Human-readable labels for verdicts/decisions. */
const VERDICT_LABELS: Record<string, string> = {
  approved: "Approved",
  approved_with_follow_up: "Approved (Follow-up)",
  changes_requested: "Changes Requested",
  escalated: "Escalated",
};

const DEFAULT_STYLE =
  "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300";

export interface ReviewVerdictBadgeProps {
  /** The verdict or decision value (e.g. "approved", "changes_requested"). */
  readonly verdict: string;
  /** Optional additional CSS classes. */
  readonly className?: string;
}

/**
 * Renders a color-coded badge for a specialist verdict or lead decision.
 *
 * Used in the review center to visually communicate review outcomes
 * so operators can quickly identify approved, rejected, and escalated
 * reviews without reading detailed packet content.
 */
export function ReviewVerdictBadge({ verdict, className }: ReviewVerdictBadgeProps) {
  const style = VERDICT_STYLES[verdict] ?? DEFAULT_STYLE;
  const label = VERDICT_LABELS[verdict] ?? verdict;

  return (
    <Badge
      variant="outline"
      className={cn(style, className)}
      data-testid={`review-verdict-${verdict.replace(/_/g, "-")}`}
    >
      {label}
    </Badge>
  );
}
