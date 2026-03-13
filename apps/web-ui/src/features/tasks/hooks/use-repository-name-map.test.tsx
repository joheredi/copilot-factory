// @vitest-environment jsdom
/**
 * Tests for the useRepositoryNameMap hook.
 *
 * Validates that the hook correctly builds a Map from repositoryId
 * to "ProjectName / RepoName" display labels by fetching all projects
 * and their repositories.
 *
 * This lookup map is essential for showing project context on each
 * task row in the task table without requiring the backend to join
 * task data with project/repository names.
 *
 * @see T150 — Add project name badges to task rows
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../../lib/websocket/index.js";
import { useRepositoryNameMap } from "./use-repository-name-map.js";
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

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={false}>
        <MemoryRouter>{children}</MemoryRouter>
      </WebSocketProvider>
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useRepositoryNameMap", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/projects") && !url.includes("/repositories")) {
        return Promise.resolve(
          fakeResponse(
            paginated([
              {
                id: "p1",
                name: "Alpha",
                description: null,
                owner: "owner",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
              {
                id: "p2",
                name: "Beta",
                description: null,
                owner: "owner",
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
                name: "repo-a",
                remoteUrl: "https://example.com/a",
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

      if (url.includes("/api/projects/p2/repositories")) {
        return Promise.resolve(
          fakeResponse(
            paginated([
              {
                id: "r2",
                projectId: "p2",
                name: "repo-b",
                remoteUrl: "https://example.com/b",
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
   * Verifies the hook initially returns an empty map before data loads.
   * The task table should handle empty maps gracefully by not showing
   * the project column.
   */
  it("returns empty map initially", () => {
    const { result } = renderHook(() => useRepositoryNameMap(), { wrapper: Wrapper });
    expect(result.current.size).toBe(0);
  });

  /**
   * Verifies the hook builds a complete map from repositoryId to
   * "ProjectName / RepoName" labels after data loads.
   * This is the primary use case — displaying project context on tasks.
   */
  it("builds repository name map after data loads", async () => {
    const { result } = renderHook(() => useRepositoryNameMap(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.size).toBe(2);
    });

    expect(result.current.get("r1")).toBe("Alpha / repo-a");
    expect(result.current.get("r2")).toBe("Beta / repo-b");
  });

  /**
   * Verifies that unknown repository IDs are not in the map.
   * The task table should fall back to "Unknown" for missing entries.
   */
  it("does not include unknown repository IDs", async () => {
    const { result } = renderHook(() => useRepositoryNameMap(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.size).toBe(2);
    });

    expect(result.current.get("unknown-repo")).toBeUndefined();
  });
});
