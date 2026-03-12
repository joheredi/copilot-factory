// @vitest-environment jsdom
/**
 * Tests for the Merge Queue page.
 *
 * Validates the merge queue view:
 * - Renders queue items in a table with correct positions and metadata
 * - Shows active merge progress indicator for items being processed
 * - Shows queue pause warning when failed items exist
 * - Displays loading skeleton while data is in-flight
 * - Displays error alert when the API fails
 * - Handles empty state gracefully
 * - Filter controls toggle status filtering
 * - Task links navigate to task detail
 *
 * This page is the operator's primary view for monitoring the merge
 * pipeline, so regressions here impact merge visibility.
 *
 * @see T098 — Build merge queue view
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../lib/websocket/index.js";
import MergeQueuePage from "./page.js";

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
    meta: {
      page: 1,
      limit: 100,
      total: total ?? items.length,
      totalPages: 1,
    },
  };
}

/** Shared merge queue item fixtures used across tests. */
function makeItems() {
  return [
    {
      mergeQueueItemId: "mqi-1",
      taskId: "task-aaa-111",
      repositoryId: "repo-1",
      status: "MERGING",
      position: 1,
      approvedCommitSha: "abc123",
      enqueuedAt: "2026-03-10T10:00:00Z",
      startedAt: "2026-03-10T10:05:00Z",
      completedAt: null,
      taskTitle: "Implement auth module",
      taskStatus: "MERGE_QUEUED",
    },
    {
      mergeQueueItemId: "mqi-2",
      taskId: "task-bbb-222",
      repositoryId: "repo-1",
      status: "ENQUEUED",
      position: 2,
      approvedCommitSha: null,
      enqueuedAt: "2026-03-10T11:00:00Z",
      startedAt: null,
      completedAt: null,
      taskTitle: "Add user dashboard",
      taskStatus: "MERGE_QUEUED",
    },
    {
      mergeQueueItemId: "mqi-3",
      taskId: "task-ccc-333",
      repositoryId: "repo-1",
      status: "FAILED",
      position: 3,
      approvedCommitSha: "def456",
      enqueuedAt: "2026-03-10T09:00:00Z",
      startedAt: "2026-03-10T09:05:00Z",
      completedAt: "2026-03-10T09:10:00Z",
      taskTitle: "Fix database migration",
      taskStatus: "MERGE_QUEUED",
    },
  ];
}

function setupSuccessResponses(items = makeItems()) {
  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/merge-queue")) {
      return Promise.resolve(fakeResponse(paginatedResponse(items, items.length)));
    }
    return Promise.resolve(fakeResponse(paginatedResponse([], 0)));
  });
}

function renderMergeQueuePage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={false}>
        <MemoryRouter initialEntries={["/merge-queue"]}>
          <MergeQueuePage />
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

describe("MergeQueuePage", () => {
  /**
   * Validates that the page heading renders correctly.
   * The heading is the operator's first cue that they're on the right page.
   */
  it("should render the page heading", async () => {
    setupSuccessResponses();
    renderMergeQueuePage();

    expect(await screen.findByText("Merge Queue")).toBeInTheDocument();
  });

  /**
   * Validates that queue item task titles render in the table.
   * This confirms the JOIN with tasks table is working and data flows
   * from the API through to the UI.
   */
  it("should render queue item task titles", async () => {
    setupSuccessResponses();
    renderMergeQueuePage();

    expect(await screen.findByText("Implement auth module")).toBeInTheDocument();
    expect(screen.getByText("Add user dashboard")).toBeInTheDocument();
    expect(screen.getByText("Fix database migration")).toBeInTheDocument();
  });

  /**
   * Validates that the item count is displayed correctly.
   */
  it("should show total item count", async () => {
    setupSuccessResponses();
    renderMergeQueuePage();

    await screen.findByText("Implement auth module");
    expect(screen.getByTestId("queue-count")).toHaveTextContent("3 items in queue");
  });

  /**
   * Validates that status badges render for each merge queue item.
   */
  it("should render status badges", async () => {
    setupSuccessResponses();
    renderMergeQueuePage();

    expect(await screen.findByTestId("merge-status-merging")).toBeInTheDocument();
    expect(screen.getByTestId("merge-status-enqueued")).toBeInTheDocument();
    expect(screen.getByTestId("merge-status-failed")).toBeInTheDocument();
  });

  /**
   * Validates that the active merge progress indicator appears
   * when an item is in an active processing state (MERGING).
   */
  it("should show active merge indicator", async () => {
    setupSuccessResponses();
    renderMergeQueuePage();

    const indicator = await screen.findByTestId("active-merge-indicator");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveTextContent("Implement auth module");
  });

  /**
   * Validates that the queue pause warning appears when a failed
   * item exists. This is critical for operators to notice pipeline issues.
   */
  it("should show queue pause warning when items have failed", async () => {
    setupSuccessResponses();
    renderMergeQueuePage();

    const warning = await screen.findByTestId("queue-pause-warning");
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveTextContent("Queue processing may be paused");
  });

  /**
   * Validates that the queue pause warning does NOT appear when there
   * are no failed items (all healthy).
   */
  it("should not show queue pause warning when no failures", async () => {
    const healthyItems = makeItems().filter((i) => i.status !== "FAILED");
    setupSuccessResponses(healthyItems);
    renderMergeQueuePage();

    await screen.findByText("Implement auth module");
    expect(screen.queryByTestId("queue-pause-warning")).not.toBeInTheDocument();
  });

  /**
   * Validates that task titles link to the task detail page,
   * enabling click-through navigation from the merge queue.
   */
  it("should link task titles to task detail", async () => {
    setupSuccessResponses();
    renderMergeQueuePage();

    const link = await screen.findByTestId("task-link-task-aaa-111");
    expect(link).toHaveAttribute("href", "/tasks/task-aaa-111");
  });

  /**
   * Validates that a loading skeleton is displayed while data is being fetched.
   */
  it("should show loading skeleton", () => {
    fetchSpy.mockReturnValue(new Promise(() => {}));
    renderMergeQueuePage();

    expect(screen.getByTestId("merge-queue-loading")).toBeInTheDocument();
  });

  /**
   * Validates that an error alert is displayed when the API returns an error.
   */
  it("should show error alert on API failure", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(fakeResponse({ error: "Internal Server Error" }, 500)),
    );
    renderMergeQueuePage();

    expect(await screen.findByTestId("merge-queue-error")).toBeInTheDocument();
  });

  /**
   * Validates that the empty state is displayed when no items exist.
   */
  it("should show empty state when no items", async () => {
    setupSuccessResponses([]);
    renderMergeQueuePage();

    expect(await screen.findByTestId("merge-queue-empty")).toBeInTheDocument();
    expect(screen.getByText("No items in the merge queue")).toBeInTheDocument();
  });

  /**
   * Validates that the filter bar can be toggled and contains status buttons.
   */
  it("should toggle filter bar visibility", async () => {
    setupSuccessResponses();
    renderMergeQueuePage();

    await screen.findByText("Implement auth module");

    expect(screen.queryByTestId("filter-bar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-filters"));
    expect(screen.getByTestId("filter-bar")).toBeInTheDocument();
    expect(screen.getByTestId("filter-status-enqueued")).toBeInTheDocument();
    expect(screen.getByTestId("filter-status-merging")).toBeInTheDocument();
  });

  /**
   * Validates singular item count text when there's exactly one item.
   */
  it("should show singular count for one item", async () => {
    setupSuccessResponses([makeItems()[0]]);
    renderMergeQueuePage();

    await screen.findByText("Implement auth module");
    expect(screen.getByTestId("queue-count")).toHaveTextContent("1 item in queue");
  });
});
