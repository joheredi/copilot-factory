// @vitest-environment jsdom
/**
 * Tests for the useDashboardData aggregation hook.
 *
 * Validates that the hook correctly:
 * - Fires parallel queries for each task status category
 * - Sums counts by category (active, queued, completed, attention)
 * - Aggregates pool data (total, enabled, max concurrency)
 * - Returns recent audit events
 * - Reports loading/error states correctly
 *
 * This hook is the data backbone of the dashboard. If it breaks,
 * all dashboard metrics become wrong or stale.
 *
 * @see T093 — Build dashboard view with system health summary
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDashboardData } from "./use-dashboard-data.js";

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
  return { items, page: 1, limit: items.length || 1, total, hasMore: false };
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
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

describe("useDashboardData", () => {
  /**
   * Validates that the hook fires queries for all 16 task statuses,
   * plus pools and audit. Each status query uses limit=1 to minimise
   * payload size — only the total count matters.
   */
  it("fires parallel queries for task counts, pools, and audit", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(paginatedResponse([], 0))));

    const { wrapper } = createWrapper();
    renderHook(() => useDashboardData(), { wrapper });

    // Wait for all queries to settle
    await waitFor(() => {
      // 15 task status queries + 1 pool + 1 audit = 17
      expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(17);
    });

    // Verify task queries use limit=1
    const taskCalls = fetchSpy.mock.calls.filter(
      ([url]) => typeof url === "string" && url.includes("/api/tasks") && url.includes("limit=1"),
    );
    expect(taskCalls.length).toBe(15);
  });

  /**
   * Validates that counts are correctly grouped into the four
   * operator-facing categories: active, queued, completed, attention.
   */
  it("correctly categorises task counts", async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/tasks") && url.includes("limit=1")) {
        if (url.includes("status=IN_DEVELOPMENT"))
          return Promise.resolve(fakeResponse(paginatedResponse([], 7)));
        if (url.includes("status=ASSIGNED"))
          return Promise.resolve(fakeResponse(paginatedResponse([], 3)));
        if (url.includes("status=READY"))
          return Promise.resolve(fakeResponse(paginatedResponse([], 12)));
        if (url.includes("status=DONE"))
          return Promise.resolve(fakeResponse(paginatedResponse([], 100)));
        if (url.includes("status=FAILED"))
          return Promise.resolve(fakeResponse(paginatedResponse([], 4)));
        if (url.includes("status=ESCALATED"))
          return Promise.resolve(fakeResponse(paginatedResponse([], 1)));
        return Promise.resolve(fakeResponse(paginatedResponse([], 0)));
      }

      if (url.includes("/api/pools")) {
        return Promise.resolve(fakeResponse(paginatedResponse([], 0)));
      }

      if (url.includes("/api/audit")) {
        return Promise.resolve(fakeResponse(paginatedResponse([], 0)));
      }

      return Promise.resolve(fakeResponse(paginatedResponse([], 0)));
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDashboardData(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Active = ASSIGNED(3) + IN_DEVELOPMENT(7) = 10
    expect(result.current.taskCounts.active).toBe(10);
    // Queued = READY(12)
    expect(result.current.taskCounts.queued).toBe(12);
    // Completed = DONE(100)
    expect(result.current.taskCounts.completed).toBe(100);
    // Attention = FAILED(4) + ESCALATED(1)
    expect(result.current.taskCounts.attention).toBe(5);
    // Total
    expect(result.current.taskCounts.total).toBe(127);
  });

  /**
   * Validates that pool summary correctly aggregates enabled/disabled
   * pools and sums their max concurrency.
   */
  it("aggregates pool summary correctly", async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/pools")) {
        return Promise.resolve(
          fakeResponse(
            paginatedResponse(
              [
                { id: "p1", maxConcurrency: 5, enabled: true },
                { id: "p2", maxConcurrency: 3, enabled: true },
                { id: "p3", maxConcurrency: 2, enabled: false },
              ],
              3,
            ),
          ),
        );
      }

      return Promise.resolve(fakeResponse(paginatedResponse([], 0)));
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDashboardData(), { wrapper });

    await waitFor(() => {
      expect(result.current.poolSummary.totalPools).toBe(3);
    });

    expect(result.current.poolSummary.enabledPools).toBe(2);
    expect(result.current.poolSummary.totalMaxConcurrency).toBe(10);
  });

  /**
   * Validates that recent audit events are passed through correctly.
   */
  it("returns recent activity events", async () => {
    const events = [
      {
        id: "e1",
        entityType: "task",
        entityId: "t1",
        eventType: "task.created",
        actorType: "system",
        actorId: "api",
        metadata: {},
        timestamp: "2026-03-12T08:00:00Z",
      },
    ];

    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/audit")) {
        return Promise.resolve(fakeResponse(paginatedResponse(events, 1)));
      }
      return Promise.resolve(fakeResponse(paginatedResponse([], 0)));
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDashboardData(), { wrapper });

    await waitFor(() => {
      expect(result.current.recentActivity.length).toBe(1);
    });

    expect(result.current.recentActivity[0]!.id).toBe("e1");
  });

  /**
   * Validates that isError is true when any query fails.
   * Dashboard must visually indicate API connectivity problems.
   */
  it("reports error when a query fails", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(new Response("Error", { status: 500 })));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDashboardData(), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
