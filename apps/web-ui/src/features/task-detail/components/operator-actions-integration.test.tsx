// @vitest-environment jsdom
/**
 * Integration tests for the TaskActionBar on the TaskDetailPage.
 *
 * These tests validate that the operator action bar renders correctly
 * within the task detail page context, showing the right buttons for
 * each task state and dispatching the correct API calls when actions
 * are confirmed.
 *
 * Tests use a mocked fetch to simulate API responses and verify that:
 * - Action bar appears with correct buttons per task status
 * - Confirmation dialogs open when action buttons are clicked
 * - Priority selector is visible for non-terminal states
 * - Escalation resolution panel appears for ESCALATED tasks
 * - Feedback banners appear after successful/failed actions
 * - Cancel action for IN_DEVELOPMENT shows acknowledge checkbox
 *
 * @see T104 — Integrate operator controls into task detail UI
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { WebSocketProvider } from "../../../lib/websocket/index.js";
import TaskDetailPage from "../TaskDetailPage.js";
import type {
  TaskDetail,
  AuditEvent,
  PaginatedResponse,
  ReviewHistoryResponse,
  ArtifactTree,
  OperatorActionResult,
  Task,
} from "../../../api/types.js";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: "task-abc-123",
    repositoryId: "repo-1",
    title: "Test Task",
    description: "A test task.",
    taskType: "feature",
    priority: "high",
    status: "IN_DEVELOPMENT",
    source: "manual",
    externalRef: null,
    severity: null,
    acceptanceCriteria: null,
    definitionOfDone: null,
    estimatedSize: null,
    riskLevel: null,
    requiredCapabilities: null,
    suggestedFileScope: null,
    version: 1,
    createdAt: "2026-03-01T10:00:00Z",
    updatedAt: "2026-03-10T15:30:00Z",
    ...overrides,
  };
}

function makeTaskDetail(taskOverrides?: Partial<Task>): TaskDetail {
  return {
    task: makeTask(taskOverrides),
    currentLease: null,
    currentReviewCycle: null,
    dependencies: [],
    dependents: [],
  };
}

function makeEmptyTimeline(): PaginatedResponse<AuditEvent> {
  return { items: [], page: 1, limit: 50, total: 0, hasMore: false };
}

function makeEmptyReviewHistory(): ReviewHistoryResponse {
  return { taskId: "task-abc-123", cycles: [] };
}

function makeEmptyArtifactTree(): ArtifactTree {
  return { taskId: "task-abc-123", artifacts: [] };
}

function makeActionResult(taskOverrides?: Partial<Task>): OperatorActionResult {
  return {
    task: makeTask(taskOverrides),
    auditEvent: {
      id: "audit-new-1",
      entityType: "task",
      entityId: "task-abc-123",
      eventType: "task.transition",
      actorType: "operator",
      actorId: "operator",
      oldState: null,
      newState: null,
      metadata: {},
      timestamp: "2026-03-10T16:00:00Z",
    },
  };
}

function setupResponses(detail: TaskDetail, actionResponse?: { status: number; body: unknown }) {
  fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    // POST to actions endpoint
    if (method === "POST" && url.includes("/actions/")) {
      if (actionResponse) {
        return Promise.resolve(fakeResponse(actionResponse.body, actionResponse.status));
      }
      return Promise.resolve(fakeResponse(makeActionResult()));
    }

    if (url.includes("/timeline")) return Promise.resolve(fakeResponse(makeEmptyTimeline()));
    if (url.includes("/reviews")) return Promise.resolve(fakeResponse(makeEmptyReviewHistory()));
    if (url.includes("/artifacts")) return Promise.resolve(fakeResponse(makeEmptyArtifactTree()));
    if (url.includes("/tasks/")) return Promise.resolve(fakeResponse(detail));

    return Promise.resolve(fakeResponse({}));
  });
}

function renderTaskDetail(taskId = "task-abc-123") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={false}>
        <MemoryRouter initialEntries={[`/tasks/${taskId}`]}>
          <Routes>
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
          </Routes>
        </MemoryRouter>
      </WebSocketProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskActionBar integration", () => {
  /**
   * Validates that the action bar renders for an IN_DEVELOPMENT task
   * with the expected buttons: Pause, Requeue, Cancel, and priority selector.
   */
  it("renders action buttons for IN_DEVELOPMENT task", async () => {
    setupResponses(makeTaskDetail({ status: "IN_DEVELOPMENT" }));
    renderTaskDetail();

    const actionBar = await screen.findByTestId("task-action-bar");
    expect(actionBar).toBeInTheDocument();

    expect(within(actionBar).getByTestId("action-btn-pause")).toHaveTextContent("Pause");
    expect(within(actionBar).getByTestId("action-btn-requeue")).toHaveTextContent("Requeue");
    expect(within(actionBar).getByTestId("action-btn-cancel")).toHaveTextContent("Cancel");
    expect(within(actionBar).getByTestId("priority-change-select")).toBeInTheDocument();
  });

  /**
   * Validates that terminal states show only the reopen button.
   */
  it("renders only reopen for DONE task", async () => {
    setupResponses(makeTaskDetail({ status: "DONE" }));
    renderTaskDetail();

    const actionBar = await screen.findByTestId("task-action-bar");
    expect(within(actionBar).getByTestId("action-btn-reopen")).toHaveTextContent("Reopen");
    expect(within(actionBar).queryByTestId("priority-change-select")).not.toBeInTheDocument();
    expect(within(actionBar).queryByTestId("action-btn-cancel")).not.toBeInTheDocument();
  });

  /**
   * Validates that ESCALATED tasks show the escalation resolution panel
   * with Retry, Cancel Task, and Mark Done buttons.
   */
  it("renders escalation resolution panel for ESCALATED task", async () => {
    setupResponses(makeTaskDetail({ status: "ESCALATED" }));
    renderTaskDetail();

    const panel = await screen.findByTestId("escalation-resolution-panel");
    expect(panel).toBeInTheDocument();
    expect(within(panel).getByTestId("escalation-retry-btn")).toBeInTheDocument();
    expect(within(panel).getByTestId("escalation-cancel-btn")).toBeInTheDocument();
    expect(within(panel).getByTestId("escalation-mark-done-btn")).toBeInTheDocument();
  });

  /**
   * Validates that MERGING tasks only show priority change (no cancel).
   * Cancelling during merge could corrupt the repository.
   */
  it("renders only priority selector for MERGING task", async () => {
    setupResponses(makeTaskDetail({ status: "MERGING" }));
    renderTaskDetail();

    const actionBar = await screen.findByTestId("task-action-bar");
    expect(within(actionBar).getByTestId("priority-change-select")).toBeInTheDocument();
    expect(within(actionBar).queryByTestId("action-btn-cancel")).not.toBeInTheDocument();
    expect(within(actionBar).queryByTestId("action-btn-pause")).not.toBeInTheDocument();
  });

  /**
   * Validates that clicking Pause opens a confirmation dialog
   * with reason input, and that confirming dispatches the API call.
   */
  it("opens confirmation dialog on Pause click and submits", async () => {
    const user = userEvent.setup();
    setupResponses(makeTaskDetail({ status: "ASSIGNED" }));
    renderTaskDetail();

    const actionBar = await screen.findByTestId("task-action-bar");
    await user.click(within(actionBar).getByTestId("action-btn-pause"));

    // Dialog should be open
    const dialog = await screen.findByTestId("confirm-action-dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId("confirm-dialog-title")).toHaveTextContent("Pause");

    // Submit should be disabled without reason
    expect(screen.getByTestId("confirm-dialog-submit")).toBeDisabled();

    // Type a reason
    await user.type(screen.getByTestId("confirm-dialog-reason"), "Investigating flaky tests");

    // Submit should be enabled now
    expect(screen.getByTestId("confirm-dialog-submit")).not.toBeDisabled();

    // Click confirm
    await user.click(screen.getByTestId("confirm-dialog-submit"));

    // Verify the API call was made
    await waitFor(() => {
      const postCalls = fetchSpy.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCalls.length).toBeGreaterThanOrEqual(1);
      const pauseCall = postCalls.find(([url]) => (url as string).includes("/actions/pause"));
      expect(pauseCall).toBeDefined();
    });

    // Feedback banner should appear
    await screen.findByTestId("action-feedback");
  });

  /**
   * Validates that cancel on IN_DEVELOPMENT shows the acknowledge checkbox
   * and that submit requires both reason and acknowledgment.
   */
  it("shows acknowledge checkbox for cancel on IN_DEVELOPMENT", async () => {
    const user = userEvent.setup();
    setupResponses(makeTaskDetail({ status: "IN_DEVELOPMENT" }));
    renderTaskDetail();

    const actionBar = await screen.findByTestId("task-action-bar");
    await user.click(within(actionBar).getByTestId("action-btn-cancel"));

    const dialog = await screen.findByTestId("confirm-action-dialog");
    expect(dialog).toBeInTheDocument();

    // Acknowledge checkbox should be visible
    const ack = screen.getByTestId("acknowledge-in-progress");
    expect(ack).toBeInTheDocument();

    // Type reason but don't check box — submit should still be disabled
    await user.type(screen.getByTestId("confirm-dialog-reason"), "No longer needed");
    expect(screen.getByTestId("confirm-dialog-submit")).toBeDisabled();

    // Check the box — submit should become enabled
    const checkbox = within(ack).getByRole("checkbox");
    await user.click(checkbox);
    expect(screen.getByTestId("confirm-dialog-submit")).not.toBeDisabled();
  });

  /**
   * Validates that closing a confirmation dialog (via cancel button)
   * does not trigger an API call.
   */
  it("closes confirmation dialog without action on cancel", async () => {
    const user = userEvent.setup();
    setupResponses(makeTaskDetail({ status: "READY" }));
    renderTaskDetail();

    const actionBar = await screen.findByTestId("task-action-bar");
    await user.click(within(actionBar).getByTestId("action-btn-cancel"));

    await screen.findByTestId("confirm-action-dialog");
    await user.click(screen.getByTestId("confirm-dialog-cancel"));

    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByTestId("confirm-action-dialog")).not.toBeInTheDocument();
    });

    // No POST calls should have been made
    const postCalls = fetchSpy.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCalls).toHaveLength(0);
  });

  /**
   * Validates that changing priority dispatches the API call directly
   * (no confirmation dialog needed).
   */
  it("changes priority without confirmation dialog", async () => {
    const user = userEvent.setup();
    setupResponses(makeTaskDetail({ status: "READY", priority: "medium" }));
    renderTaskDetail();

    const actionBar = await screen.findByTestId("task-action-bar");
    const select = within(actionBar).getByTestId("priority-select");

    await user.selectOptions(select, "critical");

    // Verify API call was made
    await waitFor(() => {
      const postCalls = fetchSpy.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      );
      const priorityCall = postCalls.find(([url]) =>
        (url as string).includes("/actions/change-priority"),
      );
      expect(priorityCall).toBeDefined();
    });
  });

  /**
   * Validates that BLOCKED tasks show force-unblock with a destructive style.
   */
  it("renders force-unblock button for BLOCKED task", async () => {
    setupResponses(makeTaskDetail({ status: "BLOCKED" }));
    renderTaskDetail();

    const actionBar = await screen.findByTestId("task-action-bar");
    const btn = within(actionBar).getByTestId("action-btn-force-unblock");
    expect(btn).toHaveTextContent("Force Unblock");
  });

  /**
   * Validates that API errors result in an error feedback banner.
   */
  it("shows error feedback when action fails", async () => {
    const user = userEvent.setup();
    setupResponses(makeTaskDetail({ status: "ASSIGNED" }), {
      status: 400,
      body: {
        statusCode: 400,
        error: "Bad Request",
        message: "Cannot pause.",
        timestamp: "",
        path: "",
      },
    });
    renderTaskDetail();

    const actionBar = await screen.findByTestId("task-action-bar");
    await user.click(within(actionBar).getByTestId("action-btn-pause"));

    await screen.findByTestId("confirm-action-dialog");
    await user.type(screen.getByTestId("confirm-dialog-reason"), "Test error");
    await user.click(screen.getByTestId("confirm-dialog-submit"));

    // Error feedback should appear
    const feedback = await screen.findByTestId("action-feedback");
    expect(feedback).toHaveTextContent("Cannot pause.");
  });

  /**
   * Validates that the rerun-review button appears for IN_REVIEW tasks.
   */
  it("renders rerun-review for IN_REVIEW task", async () => {
    setupResponses(makeTaskDetail({ status: "IN_REVIEW" }));
    renderTaskDetail();

    const actionBar = await screen.findByTestId("task-action-bar");
    expect(within(actionBar).getByTestId("action-btn-rerun-review")).toHaveTextContent(
      "Rerun Review",
    );
  });

  /**
   * Validates that override-merge-order appears for QUEUED_FOR_MERGE.
   */
  it("renders override-merge-order for QUEUED_FOR_MERGE task", async () => {
    setupResponses(makeTaskDetail({ status: "QUEUED_FOR_MERGE" }));
    renderTaskDetail();

    const actionBar = await screen.findByTestId("task-action-bar");
    expect(within(actionBar).getByTestId("action-btn-override-merge-order")).toHaveTextContent(
      "Override Merge Order",
    );
  });
});
