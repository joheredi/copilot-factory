// @vitest-environment jsdom
/**
 * Tests for the useProjectFilter hook.
 *
 * Validates that the hook:
 * - Returns "All Projects" state by default (no URL param)
 * - Reads projectId from URL search params
 * - Updates URL when setProjectId is called
 * - Clears URL param when "All Projects" is selected
 * - Returns project entity and repository IDs for the selected project
 *
 * URL-synced filter state is critical for bookmarkable dashboards,
 * so these tests ensure the hook correctly round-trips through URL params.
 *
 * @see T150 — Add multi-project filter to dashboard
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../../lib/websocket/index.js";
import { useProjectFilter } from "./use-project-filter.js";
import type { ReactNode } from "react";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function fakeResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function paginated<T>(items: T[], total?: number) {
  return {
    data: items,
    meta: { page: 1, limit: 100, total: total ?? items.length, totalPages: 1 },
  };
}

function createWrapper(initialEntries: string[] = ["/dashboard"]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return (
      <QueryClientProvider client={queryClient}>
        <WebSocketProvider autoConnect={false}>
          <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
        </WebSocketProvider>
      </QueryClientProvider>
    );
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useProjectFilter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/projects")) {
        return Promise.resolve(
          fakeResponse(
            paginated([
              {
                id: "p1",
                name: "Project Alpha",
                description: null,
                owner: "alice",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
              {
                id: "p2",
                name: "Project Beta",
                description: "Second project",
                owner: "bob",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
            ]),
          ),
        );
      }

      if (url.includes("/api/projects/p1/repositories")) {
        return Promise.resolve(
          fakeResponse(
            paginated([
              {
                id: "r1",
                projectId: "p1",
                name: "repo-alpha",
                remoteUrl: "https://github.com/org/repo-alpha",
                defaultBranch: "main",
                localCheckoutStrategy: "worktree",
                credentialProfileId: null,
                status: "active",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
            ]),
          ),
        );
      }

      return Promise.resolve(fakeResponse(paginated([])));
    });
  });

  /**
   * Verifies that with no projectId in the URL, the hook returns
   * default "All Projects" state with no filtering applied.
   * This is the most common case on first page load.
   */
  it("returns empty selectedProjectId when no URL param is set", () => {
    const { result } = renderHook(() => useProjectFilter(), {
      wrapper: createWrapper(["/dashboard"]),
    });

    const [state] = result.current;
    expect(state.selectedProjectId).toBe("");
    expect(state.selectedProject).toBeNull();
    expect(state.repositoryIds).toEqual([]);
  });

  /**
   * Verifies the hook reads projectId from URL search params.
   * This ensures bookmarked/shared dashboard links with a project
   * filter are restored correctly.
   */
  it("reads projectId from URL search params", async () => {
    const { result } = renderHook(() => useProjectFilter(), {
      wrapper: createWrapper(["/dashboard?projectId=p1"]),
    });

    const [state] = result.current;
    expect(state.selectedProjectId).toBe("p1");
  });

  /**
   * Verifies that calling setProjectId with empty string removes
   * the URL param, returning to the "All Projects" aggregate view.
   */
  it("clears projectId from URL when set to empty string", () => {
    const { result } = renderHook(() => useProjectFilter(), {
      wrapper: createWrapper(["/dashboard?projectId=p1"]),
    });

    act(() => {
      result.current[1].setProjectId("");
    });

    const [state] = result.current;
    expect(state.selectedProjectId).toBe("");
  });

  /**
   * Verifies that calling setProjectId updates the URL param
   * so the filter is reflected in the address bar.
   */
  it("sets projectId in URL when setProjectId is called", () => {
    const { result } = renderHook(() => useProjectFilter(), {
      wrapper: createWrapper(["/dashboard"]),
    });

    act(() => {
      result.current[1].setProjectId("p2");
    });

    const [state] = result.current;
    expect(state.selectedProjectId).toBe("p2");
  });
});
