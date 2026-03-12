// @vitest-environment jsdom
/**
 * Tests for the dashboard page and its sub-components.
 *
 * These tests validate the dashboard's core behaviour:
 * - Renders summary cards with correct counts from API data
 * - Shows loading skeletons while queries are in-flight
 * - Displays error alert when API requests fail
 * - Shows recent activity feed with formatted events
 * - Handles empty state gracefully
 *
 * The dashboard is the operator's primary entry point so regressions
 * here directly impact system observability.
 *
 * @see T093 — Build dashboard view with system health summary
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../lib/websocket/index.js";
import DashboardPage from "./page.js";

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

function paginatedResponse<T>(items: T[], total: number) {
  return { data: items, meta: { page: 1, limit: items.length || 1, total, totalPages: 1 } };
}

/**
 * Renders the dashboard page wrapped in all required providers.
 * Uses autoConnect=false for WebSocket to avoid real connections.
 */
function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={false}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <DashboardPage />
        </MemoryRouter>
      </WebSocketProvider>
    </QueryClientProvider>,
  );
}

/**
 * Configures fetch to respond with realistic dashboard data:
 * - Task counts for each status
 * - Pool data
 * - Audit events
 */
function setupSuccessResponses() {
  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    // Task count queries (limit=1 with status filter)
    if (url.includes("/api/tasks") && url.includes("limit=1")) {
      if (url.includes("status=IN_DEVELOPMENT")) {
        return Promise.resolve(fakeResponse(paginatedResponse([], 5)));
      }
      if (url.includes("status=ASSIGNED")) {
        return Promise.resolve(fakeResponse(paginatedResponse([], 3)));
      }
      if (url.includes("status=IN_REVIEW")) {
        return Promise.resolve(fakeResponse(paginatedResponse([], 2)));
      }
      if (url.includes("status=READY")) {
        return Promise.resolve(fakeResponse(paginatedResponse([], 8)));
      }
      if (url.includes("status=DONE")) {
        return Promise.resolve(fakeResponse(paginatedResponse([], 42)));
      }
      if (url.includes("status=ESCALATED")) {
        return Promise.resolve(fakeResponse(paginatedResponse([], 1)));
      }
      if (url.includes("status=FAILED")) {
        return Promise.resolve(fakeResponse(paginatedResponse([], 2)));
      }
      // All other statuses return 0
      return Promise.resolve(fakeResponse(paginatedResponse([], 0)));
    }

    // Pool list
    if (url.includes("/api/pools")) {
      return Promise.resolve(
        fakeResponse(
          paginatedResponse(
            [
              {
                id: "pool-1",
                name: "Dev Pool",
                poolType: "developer",
                maxConcurrency: 5,
                enabled: true,
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
              {
                id: "pool-2",
                name: "Review Pool",
                poolType: "reviewer",
                maxConcurrency: 3,
                enabled: true,
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
              {
                id: "pool-3",
                name: "Disabled Pool",
                poolType: "developer",
                maxConcurrency: 2,
                enabled: false,
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
            ],
            3,
          ),
        ),
      );
    }

    // Audit events
    if (url.includes("/api/audit")) {
      return Promise.resolve(
        fakeResponse(
          paginatedResponse(
            [
              {
                id: "evt-1",
                entityType: "task",
                entityId: "abc12345-1234-1234-1234-123456789abc",
                eventType: "task.state_changed",
                actorType: "system",
                actorId: "scheduler",
                metadata: {},
                timestamp: new Date().toISOString(),
              },
              {
                id: "evt-2",
                entityType: "worker",
                entityId: "worker-1",
                eventType: "worker.heartbeat",
                actorType: "worker",
                actorId: "worker-1",
                metadata: {},
                timestamp: new Date(Date.now() - 120_000).toISOString(),
              },
            ],
            2,
          ),
        ),
      );
    }

    // Default fallback
    return Promise.resolve(fakeResponse(paginatedResponse([], 0)));
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
// Tests
// ---------------------------------------------------------------------------

describe("DashboardPage", () => {
  /**
   * Validates that the page header is rendered immediately.
   * This is a basic smoke test to confirm the component mounts.
   */
  it("renders the dashboard heading", () => {
    setupSuccessResponses();
    renderDashboard();
    expect(screen.getByRole("heading", { name: "Dashboard", level: 1 })).toBeInTheDocument();
  });

  /**
   * Validates that task summary cards display the correct aggregated
   * counts from parallel API queries. This is the core dashboard
   * acceptance criterion — operators must see accurate task breakdowns.
   */
  it("shows task counts by category after data loads", async () => {
    setupSuccessResponses();
    renderDashboard();

    // Active = ASSIGNED(3) + IN_DEVELOPMENT(5) + IN_REVIEW(2) + others(0) = 10
    const activeCard = await screen.findByTestId("count-active");
    expect(activeCard).toHaveTextContent("10");

    // Queued = READY(8) + BACKLOG(0) + QUEUED_FOR_MERGE(0) = 8
    const queuedCard = screen.getByTestId("count-queued");
    expect(queuedCard).toHaveTextContent("8");

    // Completed = DONE(42) = 42
    const completedCard = screen.getByTestId("count-completed");
    expect(completedCard).toHaveTextContent("42");

    // Attention = ESCALATED(1) + FAILED(2) + others(0) = 3
    const attentionCard = screen.getByTestId("count-attention");
    expect(attentionCard).toHaveTextContent("3");
  });

  /**
   * Validates the total task count sums all categories.
   */
  it("shows total task count", async () => {
    setupSuccessResponses();
    renderDashboard();

    const totalCount = await screen.findByTestId("total-tasks-count");
    // 10 + 8 + 42 + 3 = 63
    expect(totalCount).toHaveTextContent("63");
  });

  /**
   * Validates that pool summary card shows correct metrics.
   * Operators rely on this to assess processing capacity.
   */
  it("shows worker pool summary", async () => {
    setupSuccessResponses();
    renderDashboard();

    const totalPools = await screen.findByTestId("stat-total-pools");
    expect(totalPools).toHaveTextContent("3");

    const enabledPools = screen.getByTestId("stat-enabled-pools");
    expect(enabledPools).toHaveTextContent("2");

    const maxConcurrency = screen.getByTestId("stat-max-concurrency");
    expect(maxConcurrency).toHaveTextContent("10");
  });

  /**
   * Validates that audit events appear in the activity feed with
   * formatted event types and entity context.
   */
  it("shows recent activity events", async () => {
    setupSuccessResponses();
    renderDashboard();

    const activityList = await screen.findByTestId("activity-list");
    expect(activityList).toBeInTheDocument();

    // Two events should be rendered
    const item1 = within(activityList).getByTestId("activity-item-evt-1");
    expect(item1).toHaveTextContent("State Changed");
    expect(item1).toHaveTextContent("task");

    const item2 = within(activityList).getByTestId("activity-item-evt-2");
    expect(item2).toHaveTextContent("Heartbeat");
  });

  /**
   * Validates the empty state when no audit events exist.
   * This ensures the feed degrades gracefully on a fresh system.
   */
  it("shows empty state when no activity", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(paginatedResponse([], 0))));
    renderDashboard();

    const emptyMsg = await screen.findByTestId("activity-empty");
    expect(emptyMsg).toHaveTextContent("No recent activity");
  });

  /**
   * Validates that loading skeletons are shown before data arrives.
   * This prevents layout shift and tells the operator data is loading.
   */
  it("shows loading skeletons while data is loading", () => {
    // Never resolve fetch — keeps queries in loading state
    fetchSpy.mockImplementation(() => new Promise(() => {}));
    renderDashboard();

    expect(screen.getByTestId("skeleton-active")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton-queued")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton-completed")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton-attention")).toBeInTheDocument();
    expect(screen.getByTestId("activity-skeleton")).toBeInTheDocument();
  });

  /**
   * Validates the error alert is shown when API calls fail.
   * This is critical for operator awareness of connectivity issues.
   */
  it("shows error alert when API fails", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response("Internal Server Error", { status: 500 })),
    );
    renderDashboard();

    const errorAlert = await screen.findByTestId("dashboard-error");
    expect(errorAlert).toHaveTextContent("Unable to load dashboard data");
  });
});
