/**
 * Custom hook for managing operator action feedback state.
 *
 * Provides success/error message state with auto-dismiss behavior.
 * Used by the TaskActionBar to show inline feedback after an
 * operator action completes or fails, without requiring a toast
 * library dependency.
 *
 * @see T104 — Integrate operator controls into task detail UI
 */

import { useState, useCallback, useRef, useEffect } from "react";

/** Feedback state for operator action results. */
export interface ActionFeedback {
  /** The type of feedback — success or error. */
  readonly type: "success" | "error";
  /** Human-readable message to display. */
  readonly message: string;
}

/** Auto-dismiss delay in milliseconds. */
const AUTO_DISMISS_MS = 5000;

/**
 * Hook that manages operator action feedback state.
 *
 * Returns the current feedback (or null), and functions to show
 * success/error messages. Messages auto-dismiss after 5 seconds.
 *
 * @returns Feedback state and control functions.
 */
export function useActionFeedback() {
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFeedback = useCallback(() => {
    setFeedback(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const showFeedback = useCallback((type: ActionFeedback["type"], message: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setFeedback({ type, message });
    timerRef.current = setTimeout(() => {
      setFeedback(null);
      timerRef.current = null;
    }, AUTO_DISMISS_MS);
  }, []);

  const showSuccess = useCallback(
    (message: string) => showFeedback("success", message),
    [showFeedback],
  );

  const showError = useCallback(
    (message: string) => showFeedback("error", message),
    [showFeedback],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { feedback, showSuccess, showError, clearFeedback } as const;
}
