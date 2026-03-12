// @vitest-environment jsdom
/**
 * Tests for merge queue operator controls (T105).
 *
 * Validates the operator controls integrated into the merge queue view:
 *
 * - **ResumeQueueButton**: Shows when failed items exist, confirmation
 *   dialog with item count, sequential requeue of all failed items,
 *   success/error feedback with counts, hidden when no failures.
 * - **QueueItemActions**: Reorder buttons for ENQUEUED/REQUEUED items,
 *   requeue button for FAILED items, no actions for active/completed items,
 *   confirmation dialogs with reason input, API integration.
 *
 * These tests are critical because merge queue reordering affects which
 * changes land first (priority ordering), and requeuing failed items
 * re-enters tasks into the merge pipeline. Incorrect behavior could
 * reorder merges in a way that introduces conflicts or requeue items
 * that should remain failed for investigation.
 *
 * @see T105 — Integrate operator controls into pool and merge queue UI
 * @see docs/prd/006-additional-refinements.md §6.2 — Merge queue management
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ResumeQueueButton } from "./components/resume-queue-button";
import { QueueItemActions } from "./components/queue-item-actions";

afterEach(cleanup);

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// ResumeQueueButton tests
// ---------------------------------------------------------------------------

describe("ResumeQueueButton", () => {
  /**
   * Validates that the button renders when failed task IDs are provided.
   * This is the main entry point for operators to resume a paused queue.
   */
  it("renders resume button when failed tasks exist", () => {
    render(
      <ResumeQueueButton
        failedTaskIds={["task-1", "task-2"]}
        onFeedback={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.getByTestId("resume-queue-btn")).toBeInTheDocument();
    expect(screen.getByTestId("resume-queue-btn")).toHaveTextContent("Resume Queue");
  });

  /**
   * Validates that the button renders nothing when no failed tasks exist.
   * Prevents the operator from seeing an action that does nothing.
   */
  it("renders nothing when no failed tasks", () => {
    const { container } = render(
      <ResumeQueueButton failedTaskIds={[]} onFeedback={vi.fn()} onComplete={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  /**
   * Validates that clicking the button opens a confirmation dialog.
   */
  it("opens confirmation dialog on click", async () => {
    render(
      <ResumeQueueButton failedTaskIds={["task-1"]} onFeedback={vi.fn()} onComplete={vi.fn()} />,
    );
    await userEvent.click(screen.getByTestId("resume-queue-btn"));
    expect(screen.getByTestId("confirm-action-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-dialog-title")).toHaveTextContent("Resume Merge Queue");
  });

  /**
   * Validates that confirming requeues all failed items and reports success.
   */
  it("requeues all failed items on confirm", async () => {
    const onFeedback = vi.fn();
    const onComplete = vi.fn();
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse({ task: {}, auditEvent: {} })));

    render(
      <ResumeQueueButton
        failedTaskIds={["task-1", "task-2"]}
        onFeedback={onFeedback}
        onComplete={onComplete}
      />,
    );

    await userEvent.click(screen.getByTestId("resume-queue-btn"));
    await userEvent.type(screen.getByTestId("confirm-dialog-reason"), "Retry after fix");
    await userEvent.click(screen.getByTestId("confirm-dialog-submit"));

    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith(
        "success",
        expect.stringContaining("Requeued 2 failed items"),
      ),
    );
    expect(onComplete).toHaveBeenCalled();

    // Should have made 2 API calls
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const url1 = fetchSpy.mock.calls[0]![0] as string;
    const url2 = fetchSpy.mock.calls[1]![0] as string;
    expect(url1).toBe("/api/tasks/task-1/actions/requeue");
    expect(url2).toBe("/api/tasks/task-2/actions/requeue");
  });

  /**
   * Validates that partial failures are reported with accurate counts.
   */
  it("reports partial failures with correct counts", async () => {
    const onFeedback = vi.fn();
    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.resolve(fakeResponse({ message: "Error" }, 500));
      }
      return Promise.resolve(fakeResponse({ task: {}, auditEvent: {} }));
    });

    render(
      <ResumeQueueButton
        failedTaskIds={["task-1", "task-2", "task-3"]}
        onFeedback={onFeedback}
        onComplete={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId("resume-queue-btn"));
    await userEvent.type(screen.getByTestId("confirm-dialog-reason"), "Retry");
    await userEvent.click(screen.getByTestId("confirm-dialog-submit"));

    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("2 items, but 1 failed"),
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// QueueItemActions tests
// ---------------------------------------------------------------------------

describe("QueueItemActions", () => {
  /**
   * Validates that ENQUEUED items get reorder controls (up/down arrows).
   * These items are waiting in queue and can be reordered by operators.
   */
  it("shows reorder buttons for ENQUEUED items", () => {
    render(
      <QueueItemActions
        taskId="task-1"
        currentPosition={2}
        status="ENQUEUED"
        onFeedback={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.getByTestId("queue-actions-task-1")).toBeInTheDocument();
    expect(screen.getByTestId("move-up-task-1")).toBeInTheDocument();
    expect(screen.getByTestId("move-down-task-1")).toBeInTheDocument();
  });

  /**
   * Validates that REQUEUED items also get reorder controls.
   */
  it("shows reorder buttons for REQUEUED items", () => {
    render(
      <QueueItemActions
        taskId="task-1"
        currentPosition={3}
        status="REQUEUED"
        onFeedback={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.getByTestId("move-up-task-1")).toBeInTheDocument();
    expect(screen.getByTestId("move-down-task-1")).toBeInTheDocument();
  });

  /**
   * Validates that FAILED items get a requeue button.
   */
  it("shows requeue button for FAILED items", () => {
    render(
      <QueueItemActions
        taskId="task-1"
        currentPosition={1}
        status="FAILED"
        onFeedback={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.getByTestId("requeue-item-task-1")).toBeInTheDocument();
    expect(screen.getByTestId("requeue-item-task-1")).toHaveTextContent("Requeue");
  });

  /**
   * Validates that active statuses (MERGING, PREPARING, etc.) get no actions.
   * Active items cannot be reordered or requeued since they're in progress.
   */
  it.each(["MERGING", "PREPARING", "REBASING", "VALIDATING", "MERGED"])(
    "renders nothing for %s status",
    (status) => {
      const { container } = render(
        <QueueItemActions
          taskId="task-1"
          currentPosition={1}
          status={status}
          onFeedback={vi.fn()}
          onComplete={vi.fn()}
        />,
      );
      expect(container.firstChild).toBeNull();
    },
  );

  /**
   * Validates that the move-up button is disabled at position 1.
   * Position 1 is already the top of the queue.
   */
  it("disables move-up at position 1", () => {
    render(
      <QueueItemActions
        taskId="task-1"
        currentPosition={1}
        status="ENQUEUED"
        onFeedback={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.getByTestId("move-up-task-1")).toBeDisabled();
    expect(screen.getByTestId("move-down-task-1")).not.toBeDisabled();
  });

  /**
   * Validates that clicking move-up opens the reorder confirmation dialog.
   */
  it("opens reorder dialog on move-up click", async () => {
    render(
      <QueueItemActions
        taskId="task-1"
        currentPosition={3}
        status="ENQUEUED"
        onFeedback={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("move-up-task-1"));
    expect(screen.getByTestId("reorder-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("reorder-position-input")).toHaveValue(2);
  });

  /**
   * Validates that clicking move-down opens the reorder dialog with position + 1.
   */
  it("opens reorder dialog on move-down click", async () => {
    render(
      <QueueItemActions
        taskId="task-1"
        currentPosition={2}
        status="ENQUEUED"
        onFeedback={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("move-down-task-1"));
    expect(screen.getByTestId("reorder-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("reorder-position-input")).toHaveValue(3);
  });

  /**
   * Validates that confirming reorder calls the API with correct payload.
   */
  it("calls override-merge-order on reorder confirm", async () => {
    const onFeedback = vi.fn();
    const onComplete = vi.fn();
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse({ task: {}, auditEvent: {} })));

    render(
      <QueueItemActions
        taskId="task-1"
        currentPosition={3}
        status="ENQUEUED"
        onFeedback={onFeedback}
        onComplete={onComplete}
      />,
    );

    await userEvent.click(screen.getByTestId("move-up-task-1"));
    await userEvent.type(screen.getByTestId("reorder-reason-input"), "Priority merge");
    await userEvent.click(screen.getByTestId("reorder-confirm-btn"));

    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith(
        "success",
        expect.stringContaining("position 3 to 2"),
      ),
    );
    expect(onComplete).toHaveBeenCalled();

    const callUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(callUrl).toBe("/api/tasks/task-1/actions/override-merge-order");

    const callInit = fetchSpy.mock.calls[0]![1]!;
    const body = JSON.parse(callInit.body as string);
    expect(body.position).toBe(2);
    expect(body.reason).toBe("Priority merge");
  });

  /**
   * Validates that confirming requeue calls the API correctly for failed items.
   */
  it("calls requeue on requeue confirm", async () => {
    const onFeedback = vi.fn();
    const onComplete = vi.fn();
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse({ task: {}, auditEvent: {} })));

    render(
      <QueueItemActions
        taskId="task-1"
        currentPosition={1}
        status="FAILED"
        onFeedback={onFeedback}
        onComplete={onComplete}
      />,
    );

    await userEvent.click(screen.getByTestId("requeue-item-task-1"));
    expect(screen.getByTestId("requeue-dialog")).toBeInTheDocument();

    await userEvent.type(screen.getByTestId("requeue-reason-input"), "Retrying after fix");
    await userEvent.click(screen.getByTestId("requeue-confirm-btn"));

    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith("success", "Item requeued successfully."),
    );
    expect(onComplete).toHaveBeenCalled();

    const callUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(callUrl).toBe("/api/tasks/task-1/actions/requeue");
  });

  /**
   * Validates that the reorder confirm button is disabled without reason.
   * Reasons are required for the audit trail.
   */
  it("disables reorder confirm without reason", async () => {
    render(
      <QueueItemActions
        taskId="task-1"
        currentPosition={3}
        status="ENQUEUED"
        onFeedback={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("move-up-task-1"));
    expect(screen.getByTestId("reorder-confirm-btn")).toBeDisabled();
  });

  /**
   * Validates that the requeue confirm button is disabled without reason.
   */
  it("disables requeue confirm without reason", async () => {
    render(
      <QueueItemActions
        taskId="task-1"
        currentPosition={1}
        status="FAILED"
        onFeedback={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("requeue-item-task-1"));
    expect(screen.getByTestId("requeue-confirm-btn")).toBeDisabled();
  });

  /**
   * Validates that reorder API errors surface as error feedback.
   */
  it("shows error feedback on reorder API failure", async () => {
    const onFeedback = vi.fn();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(fakeResponse({ message: "Not allowed" }, 400)),
    );

    render(
      <QueueItemActions
        taskId="task-1"
        currentPosition={3}
        status="ENQUEUED"
        onFeedback={onFeedback}
        onComplete={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId("move-up-task-1"));
    await userEvent.type(screen.getByTestId("reorder-reason-input"), "Priority");
    await userEvent.click(screen.getByTestId("reorder-confirm-btn"));

    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("Failed to reorder"),
      ),
    );
  });
});
