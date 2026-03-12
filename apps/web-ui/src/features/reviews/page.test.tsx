// @vitest-environment jsdom
/**
 * Tests for the Review Center page (T097).
 *
 * Validates the review center view:
 * - Renders tasks in review states (IN_REVIEW and CHANGES_REQUESTED)
 * - Shows changes-requested warning banner when applicable
 * - Displays loading skeleton while data is in-flight
 * - Displays error alert when the API fails
 * - Handles empty state gracefully
 * - Filter controls toggle status filtering
 * - Task links navigate to task detail
 * - Expanding a task row loads review cycle history
 * - Review count is displayed correctly
 *
 * The review center is the operator's primary view for monitoring
 * review quality and bottlenecks, so regressions here impact
 * review visibility.
 *
 * @see T097 — Build review center view
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../lib/websocket/index.js";
import ReviewsPage from "./page.js";

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

function paginatedResponse<T>(items: T[], total?: number) {
  return {
    data: items,
    meta: { page: 1, limit: 100, total: total ?? items.length, totalPages: 1 },
  };
}

/** Shared task fixtures for review center tests. */
function makeInReviewTasks() {
  return [
    {
      id: "task-review-001",
      repositoryId: "repo-1",
      title: "Implement authentication flow",
      description: "Add OAuth2 authentication",
      taskType: "feature",
      priority: "high",
      status: "IN_REVIEW",
      source: "manual",
      externalRef: null,
      severity: null,
      acceptanceCriteria: null,
      definitionOfDone: null,
      estimatedSize: "m",
      riskLevel: "medium",
      requiredCapabilities: null,
      suggestedFileScope: null,
      version: 1,
      createdAt: "2026-03-10T10:00:00Z",
      updatedAt: "2026-03-10T12:00:00Z",
    },
    {
      id: "task-review-002",
      repositoryId: "repo-1",
      title: "Add rate limiting middleware",
      description: "Rate limit API endpoints",
      taskType: "feature",
      priority: "medium",
      status: "IN_REVIEW",
      source: "manual",
      externalRef: null,
      severity: null,
      acceptanceCriteria: null,
      definitionOfDone: null,
      estimatedSize: "s",
      riskLevel: "low",
      requiredCapabilities: null,
      suggestedFileScope: null,
      version: 1,
      createdAt: "2026-03-10T09:00:00Z",
      updatedAt: "2026-03-10T11:00:00Z",
    },
  ];
}

function makeChangesRequestedTasks() {
  return [
    {
      id: "task-changes-001",
      repositoryId: "repo-1",
      title: "Fix database connection pooling",
      description: "Connection pool exhaustion under load",
      taskType: "bug_fix",
      priority: "critical",
      status: "CHANGES_REQUESTED",
      source: "manual",
      externalRef: null,
      severity: null,
      acceptanceCriteria: null,
      definitionOfDone: null,
      estimatedSize: "l",
      riskLevel: "high",
      requiredCapabilities: null,
      suggestedFileScope: null,
      version: 2,
      createdAt: "2026-03-09T08:00:00Z",
      updatedAt: "2026-03-10T15:00:00Z",
    },
  ];
}

function makeReviewHistory(taskId: string) {
  return {
    taskId,
    cycles: [
      {
        cycleId: "cycle-aaa-111",
        taskId,
        status: "IN_PROGRESS",
        specialistCount: 2,
        leadDecision: null,
        createdAt: "2026-03-10T12:00:00Z",
        updatedAt: "2026-03-10T13:00:00Z",
      },
    ],
  };
}

function setupSuccessResponses(
  inReview = makeInReviewTasks(),
  changesRequested = makeChangesRequestedTasks(),
) {
  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/api/tasks") && url.includes("status=IN_REVIEW")) {
      return Promise.resolve(fakeResponse(paginatedResponse(inReview)));
    }
    if (url.includes("/api/tasks") && url.includes("status=CHANGES_REQUESTED")) {
      return Promise.resolve(fakeResponse(paginatedResponse(changesRequested)));
    }
    if (url.match(/\/api\/tasks\/[^/]+\/reviews$/)) {
      const taskId = url.match(/\/api\/tasks\/([^/]+)\/reviews$/)?.[1] ?? "";
      return Promise.resolve(fakeResponse(makeReviewHistory(taskId)));
    }
    return Promise.resolve(fakeResponse(paginatedResponse([], 0)));
  });
}

function renderReviewsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={false}>
        <MemoryRouter initialEntries={["/reviews"]}>
          <ReviewsPage />
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

describe("ReviewsPage", () => {
  /**
   * Validates that the page heading renders correctly.
   * The heading is the operator's first cue they're on the review center.
   */
  it("should render the page heading", async () => {
    setupSuccessResponses();
    renderReviewsPage();

    expect(await screen.findByText("Review Center")).toBeInTheDocument();
  });

  /**
   * Validates that tasks in review states render with their titles.
   * This confirms both IN_REVIEW and CHANGES_REQUESTED queries work
   * and their results merge correctly in the table.
   */
  it("should render tasks in review states", async () => {
    setupSuccessResponses();
    renderReviewsPage();

    expect(await screen.findByText("Implement authentication flow")).toBeInTheDocument();
    expect(screen.getByText("Add rate limiting middleware")).toBeInTheDocument();
    expect(screen.getByText("Fix database connection pooling")).toBeInTheDocument();
  });

  /**
   * Validates that the total review count includes tasks from both
   * IN_REVIEW and CHANGES_REQUESTED queries.
   */
  it("should show total task count in review", async () => {
    setupSuccessResponses();
    renderReviewsPage();

    await screen.findByText("Implement authentication flow");
    expect(screen.getByTestId("review-count")).toHaveTextContent("3 tasks in review");
  });

  /**
   * Validates that changes-requested warning banner appears when
   * tasks have been sent back for rework. This is critical for
   * operators to identify review bottlenecks.
   */
  it("should show changes-requested warning banner", async () => {
    setupSuccessResponses();
    renderReviewsPage();

    const warning = await screen.findByTestId("changes-requested-warning");
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveTextContent("1 task with changes requested");
  });

  /**
   * Validates that the warning banner does NOT appear when there
   * are no tasks with changes requested.
   */
  it("should not show warning when no changes requested", async () => {
    setupSuccessResponses(makeInReviewTasks(), []);
    renderReviewsPage();

    await screen.findByText("Implement authentication flow");
    expect(screen.queryByTestId("changes-requested-warning")).not.toBeInTheDocument();
  });

  /**
   * Validates task status badges render for both IN_REVIEW and
   * CHANGES_REQUESTED states using the shared TaskStatusBadge.
   */
  it("should render task status badges", async () => {
    setupSuccessResponses();
    renderReviewsPage();

    await screen.findByText("Implement authentication flow");
    const inReviewBadges = screen.getAllByTestId("status-badge-IN_REVIEW");
    expect(inReviewBadges.length).toBe(2);
    expect(screen.getByTestId("status-badge-CHANGES_REQUESTED")).toBeInTheDocument();
  });

  /**
   * Validates that task titles link to the task detail page,
   * enabling click-through navigation from the review center.
   */
  it("should link task titles to task detail", async () => {
    setupSuccessResponses();
    renderReviewsPage();

    const link = await screen.findByTestId("task-link-task-review-001");
    expect(link).toHaveAttribute("href", "/tasks/task-review-001");
  });

  /**
   * Validates that a loading skeleton is displayed while data is being fetched.
   */
  it("should show loading skeleton", () => {
    fetchSpy.mockReturnValue(new Promise(() => {}));
    renderReviewsPage();

    expect(screen.getByTestId("review-center-loading")).toBeInTheDocument();
  });

  /**
   * Validates that an error alert is displayed when the API returns an error.
   */
  it("should show error alert on API failure", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(fakeResponse({ error: "Internal Server Error" }, 500)),
    );
    renderReviewsPage();

    expect(await screen.findByTestId("review-center-error")).toBeInTheDocument();
  });

  /**
   * Validates that the empty state is displayed when no tasks are in review.
   */
  it("should show empty state when no tasks in review", async () => {
    setupSuccessResponses([], []);
    renderReviewsPage();

    expect(await screen.findByTestId("review-center-empty")).toBeInTheDocument();
    expect(screen.getByText("No tasks in review")).toBeInTheDocument();
  });

  /**
   * Validates that the filter bar can be toggled and contains
   * both review status options (IN_REVIEW and CHANGES_REQUESTED).
   */
  it("should toggle filter bar visibility", async () => {
    setupSuccessResponses();
    renderReviewsPage();

    await screen.findByText("Implement authentication flow");

    expect(screen.queryByTestId("filter-bar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-filters"));
    expect(screen.getByTestId("filter-bar")).toBeInTheDocument();
    expect(screen.getByTestId("filter-status-in-review")).toBeInTheDocument();
    expect(screen.getByTestId("filter-status-changes-requested")).toBeInTheDocument();
  });

  /**
   * Validates that clicking a status filter narrows the displayed tasks.
   * When CHANGES_REQUESTED is selected, only tasks with that status appear.
   */
  it("should filter tasks by status when filter is selected", async () => {
    setupSuccessResponses();
    renderReviewsPage();

    await screen.findByText("Implement authentication flow");

    fireEvent.click(screen.getByTestId("toggle-filters"));
    fireEvent.click(screen.getByTestId("filter-status-changes-requested"));

    expect(screen.getByText("Fix database connection pooling")).toBeInTheDocument();
    expect(screen.queryByText("Implement authentication flow")).not.toBeInTheDocument();
    expect(screen.getByTestId("review-count")).toHaveTextContent("1 task in review");
  });

  /**
   * Validates singular task count when there's exactly one task in review.
   */
  it("should show singular count for one task", async () => {
    setupSuccessResponses([makeInReviewTasks()[0]], []);
    renderReviewsPage();

    await screen.findByText("Implement authentication flow");
    expect(screen.getByTestId("review-count")).toHaveTextContent("1 task in review");
  });

  /**
   * Validates that clicking a task row expands to show review cycle history.
   * This is the core interaction for inspecting review quality.
   */
  it("should expand task row to show review cycles", async () => {
    setupSuccessResponses();
    renderReviewsPage();

    const taskRow = await screen.findByTestId("review-task-task-review-001");
    fireEvent.click(taskRow);

    await waitFor(() => {
      expect(screen.getByTestId("toggle-cycle-cycle-aaa-111")).toBeInTheDocument();
    });
  });

  /**
   * Validates that the review cycle row displays the specialist count.
   */
  it("should show specialist count in review cycle", async () => {
    setupSuccessResponses();
    renderReviewsPage();

    const taskRow = await screen.findByTestId("review-task-task-review-001");
    fireEvent.click(taskRow);

    await waitFor(() => {
      expect(screen.getByText("2 reviewers")).toBeInTheDocument();
    });
  });
});
