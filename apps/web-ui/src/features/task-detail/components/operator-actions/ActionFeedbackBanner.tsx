/**
 * Inline feedback banner for operator action results.
 *
 * Displays a dismissible success or error message after an operator
 * action completes. Uses color-coded backgrounds (green for success,
 * red for error) for immediate visual feedback.
 *
 * @see T104 — Integrate operator controls into task detail UI
 */

import { X } from "lucide-react";
import type { ActionFeedback } from "./use-action-feedback";

/** Props for the ActionFeedbackBanner component. */
interface ActionFeedbackBannerProps {
  /** Current feedback state, or null to render nothing. */
  readonly feedback: ActionFeedback | null;
  /** Callback to dismiss the banner. */
  readonly onDismiss: () => void;
}

/**
 * Renders an inline feedback banner for operator action results.
 *
 * Shows nothing when feedback is null. Renders a color-coded
 * dismissible alert when feedback is present.
 */
export function ActionFeedbackBanner({ feedback, onDismiss }: ActionFeedbackBannerProps) {
  if (!feedback) return null;

  const isSuccess = feedback.type === "success";

  return (
    <div
      className={`flex items-center justify-between rounded-md border px-4 py-2 text-sm ${
        isSuccess
          ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
          : "border-destructive/50 bg-destructive/10 text-destructive"
      }`}
      role="alert"
      data-testid="action-feedback"
    >
      <span data-testid="action-feedback-message">{feedback.message}</span>
      <button
        onClick={onDismiss}
        className="ml-2 rounded-sm opacity-70 hover:opacity-100"
        aria-label="Dismiss"
        data-testid="action-feedback-dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
