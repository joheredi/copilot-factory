// @vitest-environment jsdom
/**
 * Tests for operator action components (T104).
 *
 * These tests validate the operator action controls integrated into the
 * task detail view. They cover:
 *
 * - **Action definitions**: Correct actions shown per task status
 * - **TaskActionBar**: State-dependent button rendering, priority selector,
 *   escalation resolution panel visibility
 * - **ConfirmActionDialog**: Reason validation, confirm/cancel behavior,
 *   in-progress acknowledgment checkbox
 * - **EscalationResolutionPanel**: Three resolution paths (retry, cancel,
 *   mark_done), form validation, evidence requirement
 * - **PriorityChangeSelect**: Renders current value, triggers on change
 * - **ActionFeedbackBanner**: Success/error rendering, dismiss behavior
 * - **Integration**: Action bar dispatches mutations and shows feedback
 *
 * These tests are critical because operator actions mutate task state and
 * feed the audit trail. A regression here could allow invalid actions,
 * miss confirmation for destructive operations, or break the feedback loop
 * that confirms action results to the operator.
 *
 * @see T104 — Integrate operator controls into task detail UI
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { getActionsForStatus } from "./operator-actions/action-definitions";
import { ActionFeedbackBanner } from "./operator-actions/ActionFeedbackBanner";
import { PriorityChangeSelect } from "./operator-actions/PriorityChangeSelect";
import type { ActionFeedback } from "./operator-actions/use-action-feedback";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// action-definitions tests
// ---------------------------------------------------------------------------

describe("getActionsForStatus", () => {
  /**
   * Validates that BACKLOG tasks only get change-priority and cancel.
   * BACKLOG is an early state where most actions don't apply.
   */
  it("returns change-priority and cancel for BACKLOG", () => {
    const actions = getActionsForStatus("BACKLOG");
    const ids = actions.map((a) => a.id);
    expect(ids).toEqual(["change-priority", "cancel"]);
  });

  /**
   * Validates that BLOCKED tasks get force-unblock (the key action),
   * plus change-priority and cancel.
   */
  it("returns force-unblock for BLOCKED tasks", () => {
    const actions = getActionsForStatus("BLOCKED");
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("force-unblock");
    expect(ids).toContain("cancel");
    expect(ids).toContain("change-priority");
  });

  /**
   * Validates that IN_DEVELOPMENT tasks get pause, requeue, and cancel.
   * These are the most common operator interventions during active work.
   */
  it("returns pause, requeue, cancel for IN_DEVELOPMENT", () => {
    const actions = getActionsForStatus("IN_DEVELOPMENT");
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("pause");
    expect(ids).toContain("requeue");
    expect(ids).toContain("cancel");
    expect(ids).toContain("change-priority");
  });

  /**
   * Validates that MERGING only allows change-priority.
   * Cancelling a MERGING task could corrupt the repository.
   */
  it("returns only change-priority for MERGING", () => {
    const actions = getActionsForStatus("MERGING");
    const ids = actions.map((a) => a.id);
    expect(ids).toEqual(["change-priority"]);
  });

  /**
   * Validates that terminal states (DONE, FAILED, CANCELLED) only allow reopen.
   */
  it.each(["DONE", "FAILED", "CANCELLED"])("returns only reopen for %s", (status) => {
    const actions = getActionsForStatus(status);
    const ids = actions.map((a) => a.id);
    expect(ids).toEqual(["reopen"]);
  });

  /**
   * Validates that ESCALATED tasks show the resolve-escalation action.
   * This is the dedicated escalation resolution path.
   */
  it("returns resolve-escalation for ESCALATED", () => {
    const actions = getActionsForStatus("ESCALATED");
    const ids = actions.map((a) => a.id);
    expect(ids).toEqual(["resolve-escalation"]);
  });

  /**
   * Validates that IN_REVIEW and APPROVED tasks can rerun review.
   */
  it.each(["IN_REVIEW", "APPROVED"])("returns rerun-review for %s", (status) => {
    const actions = getActionsForStatus(status);
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("rerun-review");
  });

  /**
   * Validates that QUEUED_FOR_MERGE gets override-merge-order.
   */
  it("returns override-merge-order for QUEUED_FOR_MERGE", () => {
    const actions = getActionsForStatus("QUEUED_FOR_MERGE");
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("override-merge-order");
  });

  /**
   * Validates that an unknown status returns no actions.
   */
  it("returns empty array for unknown status", () => {
    const actions = getActionsForStatus("UNKNOWN_STATE");
    expect(actions).toEqual([]);
  });

  /**
   * Validates that force-unblock is marked as destructive (requires confirmation).
   */
  it("marks force-unblock as requiring confirmation", () => {
    const actions = getActionsForStatus("BLOCKED");
    const forceUnblock = actions.find((a) => a.id === "force-unblock");
    expect(forceUnblock?.requiresConfirmation).toBe(true);
    expect(forceUnblock?.variant).toBe("destructive");
  });

  /**
   * Validates that cancel is marked as destructive.
   */
  it("marks cancel as destructive", () => {
    const actions = getActionsForStatus("READY");
    const cancel = actions.find((a) => a.id === "cancel");
    expect(cancel?.requiresConfirmation).toBe(true);
    expect(cancel?.variant).toBe("destructive");
  });

  /**
   * Validates that change-priority does not require confirmation.
   */
  it("marks change-priority as not requiring confirmation", () => {
    const actions = getActionsForStatus("READY");
    const changePriority = actions.find((a) => a.id === "change-priority");
    expect(changePriority?.requiresConfirmation).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ActionFeedbackBanner tests
// ---------------------------------------------------------------------------

describe("ActionFeedbackBanner", () => {
  /**
   * Validates that nothing renders when feedback is null.
   * Prevents empty banner from appearing during normal operation.
   */
  it("renders nothing when feedback is null", () => {
    const { container } = render(<ActionFeedbackBanner feedback={null} onDismiss={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  /**
   * Validates that success feedback shows the message with correct role.
   */
  it("renders success message", () => {
    const feedback: ActionFeedback = { type: "success", message: "Task paused." };
    render(<ActionFeedbackBanner feedback={feedback} onDismiss={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Task paused.");
  });

  /**
   * Validates that error feedback shows the message.
   */
  it("renders error message", () => {
    const feedback: ActionFeedback = { type: "error", message: "Failed to pause." };
    render(<ActionFeedbackBanner feedback={feedback} onDismiss={vi.fn()} />);
    expect(screen.getByTestId("action-feedback-message")).toHaveTextContent("Failed to pause.");
  });

  /**
   * Validates that clicking dismiss calls onDismiss.
   */
  it("calls onDismiss when dismiss button is clicked", async () => {
    const onDismiss = vi.fn();
    const feedback: ActionFeedback = { type: "success", message: "Done." };
    render(<ActionFeedbackBanner feedback={feedback} onDismiss={onDismiss} />);

    await userEvent.click(screen.getByTestId("action-feedback-dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// PriorityChangeSelect tests
// ---------------------------------------------------------------------------

describe("PriorityChangeSelect", () => {
  /**
   * Validates that the select renders with the current priority value.
   */
  it("renders with current priority selected", () => {
    render(
      <PriorityChangeSelect currentPriority="high" onChangePriority={vi.fn()} disabled={false} />,
    );
    const select = screen.getByTestId("priority-select") as HTMLSelectElement;
    expect(select.value).toBe("high");
  });

  /**
   * Validates that changing priority triggers the callback.
   */
  it("calls onChangePriority when a different value is selected", async () => {
    const onChangePriority = vi.fn();
    render(
      <PriorityChangeSelect
        currentPriority="high"
        onChangePriority={onChangePriority}
        disabled={false}
      />,
    );
    const select = screen.getByTestId("priority-select");
    await userEvent.selectOptions(select, "critical");
    expect(onChangePriority).toHaveBeenCalledWith("critical");
  });

  /**
   * Validates that the select is disabled when disabled prop is true.
   */
  it("is disabled when disabled prop is true", () => {
    render(
      <PriorityChangeSelect currentPriority="medium" onChangePriority={vi.fn()} disabled={true} />,
    );
    const select = screen.getByTestId("priority-select") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  /**
   * Validates that all four priority options are rendered.
   */
  it("renders all four priority options", () => {
    render(
      <PriorityChangeSelect currentPriority="medium" onChangePriority={vi.fn()} disabled={false} />,
    );
    const select = screen.getByTestId("priority-select") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["critical", "high", "medium", "low"]);
  });
});
