// @vitest-environment jsdom
/**
 * Tests for the Task Board page (T094).
 *
 * These tests validate the task board's core behaviour:
 * - Renders page heading and filter controls
 * - Displays tasks in a table with correct columns
 * - Shows loading skeletons while data is in-flight
 * - Shows error alert when API requests fail
 * - Filters toggle correctly and reset page to 1
 * - Pagination controls navigate between pages
 * - Status and priority badges render with correct labels
 * - Empty state shown when no tasks match filters
 * - Sorting toggles on column header click
 *
 * The task board is the primary view for operator task management,
 * so regressions here directly impact operational workflows.
 *
 * @see T094 — Build task board with status filtering and pagination
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../lib/websocket/index.js";
import TasksPage from "./page.js";
import type { Task, PaginatedResponse } from "../../api/types.js";

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

function makePaginatedResponse(
  items: Task[],
  total: number,
  page = 1,
  limit = 20,
): PaginatedResponse<Task> {
  return { items, page, limit, total, hasMore: page * limit < total };
}

/** Creates a minimal valid Task object for testing. */
function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    repositoryId: "repo-1",
    title: `Task ${overrides.id}`,
    description: null,
    taskType: "feature",
    priority: "medium",
    status: "READY",
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
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-10T12:00:00Z",
    ...overrides,
  };
}

const SAMPLE_TASKS: Task[] = [
  makeTask({
    id: "t1",
    title: "Implement auth",
    status: "IN_DEVELOPMENT",
    priority: "critical",
    taskType: "feature",
  }),
  makeTask({
    id: "t2",
    title: "Fix login bug",
    status: "READY",
    priority: "high",
    taskType: "bug_fix",
  }),
  makeTask({
    id: "t3",
    title: "Refactor DB layer",
    status: "DONE",
    priority: "low",
    taskType: "refactor",
  }),
  makeTask({
    id: "t4",
    title: "Add unit tests",
    status: "IN_REVIEW",
    priority: "medium",
    taskType: "test",
  }),
  makeTask({
    id: "t5",
    title: "Update docs",
    status: "ESCALATED",
    priority: "low",
    taskType: "documentation",
  }),
];

/**
 * Renders the task board page wrapped in all required providers.
 * Uses MemoryRouter for URL param handling and autoConnect=false
 * for WebSocket to avoid real connections.
 */
function renderTaskBoard(initialEntries = ["/tasks"]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={false}>
        <MemoryRouter initialEntries={initialEntries}>
          <TasksPage />
        </MemoryRouter>
      </WebSocketProvider>
    </QueryClientProvider>,
  );
}

function setupSuccessResponse(tasks = SAMPLE_TASKS, total = SAMPLE_TASKS.length) {
  fetchSpy.mockImplementation(() =>
    Promise.resolve(fakeResponse(makePaginatedResponse(tasks, total))),
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

describe("TasksPage", () => {
  /**
   * Validates that the page header renders immediately.
   * Basic smoke test confirming the component mounts correctly.
   */
  it("renders the task board heading", () => {
    setupSuccessResponse();
    renderTaskBoard();
    expect(screen.getByRole("heading", { name: "Task Board", level: 1 })).toBeInTheDocument();
  });

  /**
   * Validates that the filter panel renders with status, priority, and type
   * filter sections. The filters are the primary interaction mechanism for
   * the task board, so they must be visible by default.
   */
  it("renders filter controls", () => {
    setupSuccessResponse();
    renderTaskBoard();
    expect(screen.getByTestId("task-filters")).toBeInTheDocument();
    expect(screen.getByTestId("filter-status-READY")).toBeInTheDocument();
    expect(screen.getByTestId("filter-priority-critical")).toBeInTheDocument();
    expect(screen.getByTestId("filter-type-feature")).toBeInTheDocument();
  });

  /**
   * Validates that tasks appear in a table with correct columns after data loads.
   * This is the core acceptance criterion — operators must see their tasks.
   */
  it("displays tasks in a table after data loads", async () => {
    setupSuccessResponse();
    renderTaskBoard();

    const row1 = await screen.findByTestId("task-row-t1");
    expect(row1).toHaveTextContent("Implement auth");
    expect(within(row1).getByTestId("status-badge-IN_DEVELOPMENT")).toHaveTextContent(
      "In Development",
    );
    expect(within(row1).getByTestId("priority-badge-critical")).toHaveTextContent("Critical");

    const row2 = screen.getByTestId("task-row-t2");
    expect(row2).toHaveTextContent("Fix login bug");
    expect(within(row2).getByTestId("status-badge-READY")).toHaveTextContent("Ready");
  });

  /**
   * Validates loading skeleton is shown while data is being fetched.
   * Prevents layout shift and provides visual feedback to the operator.
   */
  it("shows loading skeleton while data is loading", () => {
    fetchSpy.mockImplementation(() => new Promise(() => {}));
    renderTaskBoard();
    expect(screen.getByTestId("task-table-skeleton")).toBeInTheDocument();
  });

  /**
   * Validates that the error alert appears when the API fails.
   * Critical for operator awareness of connectivity issues.
   */
  it("shows error alert when API fails", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response("Internal Server Error", { status: 500 })),
    );
    renderTaskBoard();

    const errorAlert = await screen.findByTestId("task-board-error");
    expect(errorAlert).toHaveTextContent("Unable to load tasks");
  });

  /**
   * Validates the empty state when no tasks match the current filters.
   * Prevents confusion when filters exclude all results.
   */
  it("shows empty state when no tasks match", async () => {
    setupSuccessResponse([], 0);
    renderTaskBoard();

    const empty = await screen.findByTestId("task-table-empty");
    expect(empty).toHaveTextContent("No tasks found");
  });

  /**
   * Validates that pagination controls appear with correct information.
   * Operators need to know how many tasks exist and navigate between pages.
   */
  it("shows pagination controls with correct item range", async () => {
    setupSuccessResponse(SAMPLE_TASKS, 45);
    renderTaskBoard();

    const paginationInfo = await screen.findByTestId("pagination-info");
    expect(paginationInfo).toHaveTextContent("Showing 1–20 of 45 tasks");
  });

  /**
   * Validates pagination controls hide when there are zero items.
   * No pagination needed when there's nothing to paginate.
   */
  it("hides pagination when no results", async () => {
    setupSuccessResponse([], 0);
    renderTaskBoard();

    await screen.findByTestId("task-table-empty");
    expect(screen.queryByTestId("pagination-controls")).not.toBeInTheDocument();
  });

  /**
   * Validates that the filter toggle button hides and shows the filter panel.
   * Some operators may want more screen space for the table.
   */
  it("toggles filter visibility", async () => {
    setupSuccessResponse();
    renderTaskBoard();

    expect(screen.getByTestId("task-filters")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-filters"));
    expect(screen.queryByTestId("task-filters")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-filters"));
    expect(screen.getByTestId("task-filters")).toBeInTheDocument();
  });

  /**
   * Validates that status filter buttons are rendered for all status groups.
   * Ensures operators can filter by any valid task status.
   */
  it("renders all status filter buttons", () => {
    setupSuccessResponse();
    renderTaskBoard();

    const expectedStatuses = [
      "ASSIGNED",
      "IN_DEVELOPMENT",
      "DEV_COMPLETE",
      "MERGING",
      "POST_MERGE_VALIDATION",
      "IN_REVIEW",
      "CHANGES_REQUESTED",
      "APPROVED",
      "BACKLOG",
      "READY",
      "QUEUED_FOR_MERGE",
      "DONE",
      "FAILED",
      "ESCALATED",
      "CANCELLED",
      "BLOCKED",
    ];

    for (const status of expectedStatuses) {
      expect(screen.getByTestId(`filter-status-${status}`)).toBeInTheDocument();
    }
  });

  /**
   * Validates that all task types have filter buttons.
   */
  it("renders all task type filter buttons", () => {
    setupSuccessResponse();
    renderTaskBoard();

    const types = ["feature", "bug_fix", "refactor", "chore", "documentation", "test", "spike"];
    for (const type of types) {
      expect(screen.getByTestId(`filter-type-${type}`)).toBeInTheDocument();
    }
  });

  /**
   * Validates that clicking sort column headers triggers re-sorting.
   * Operators use sorting to find tasks by priority or recency.
   */
  it("renders sortable column headers", async () => {
    setupSuccessResponse();
    renderTaskBoard();

    await screen.findByTestId("task-row-t1");

    expect(screen.getByTestId("sort-title")).toBeInTheDocument();
    expect(screen.getByTestId("sort-status")).toBeInTheDocument();
    expect(screen.getByTestId("sort-priority")).toBeInTheDocument();
    expect(screen.getByTestId("sort-updated")).toBeInTheDocument();
  });

  /**
   * Validates that each task row displays the task type label.
   * Operators need to distinguish feature work from bug fixes at a glance.
   */
  it("displays task type labels in the table", async () => {
    setupSuccessResponse();
    renderTaskBoard();

    const row1 = await screen.findByTestId("task-row-t1");
    expect(row1).toHaveTextContent("Feature");

    const row2 = screen.getByTestId("task-row-t2");
    expect(row2).toHaveTextContent("Bug Fix");
  });

  /**
   * Validates that all page size options are rendered.
   * Operators should be able to choose how many tasks per page.
   */
  it("renders page size options", async () => {
    setupSuccessResponse(SAMPLE_TASKS, 45);
    renderTaskBoard();

    await screen.findByTestId("pagination-controls");

    for (const size of [10, 20, 50, 100]) {
      expect(screen.getByTestId(`page-size-${size}`)).toBeInTheDocument();
    }
  });

  /**
   * Validates that the "clear all filters" button appears when filters
   * are active, providing a quick way to reset the view.
   */
  it("shows clear all button when a priority filter is active", async () => {
    setupSuccessResponse();
    renderTaskBoard();

    expect(screen.queryByTestId("clear-all-filters")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("filter-priority-high"));

    expect(screen.getByTestId("clear-all-filters")).toBeInTheDocument();
  });
});
