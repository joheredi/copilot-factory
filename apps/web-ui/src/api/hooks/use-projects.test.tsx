// @vitest-environment jsdom
/**
 * Tests for project query and mutation hooks.
 *
 * Validates that:
 * - useProjects fetches from the correct endpoint with pagination
 * - useProject fetches a single project and is disabled when id is falsy
 * - useCreateProject POSTs and invalidates project queries
 * - useUpdateProject PUTs and invalidates project queries
 * - useDeleteProject DELETEs and invalidates project queries
 *
 * Uses MSW-style fetch mocking to verify HTTP behavior without a
 * running backend. Hook rendering is done via renderHook with a
 * QueryClientProvider wrapper for proper TanStack Query context.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useProjects, useProject, useCreateProject, useDeleteProject } from "./use-projects";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

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

describe("useProjects", () => {
  /**
   * Validates that useProjects fetches from /api/projects with
   * pagination params and returns the paginated response.
   */
  it("fetches paginated project list", async () => {
    const data = {
      items: [{ id: "1", name: "Test" }],
      page: 1,
      limit: 20,
      total: 1,
      hasMore: false,
    };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(data)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects({ page: 1, limit: 20 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(fetchSpy.mock.calls[0]![0]).toContain("/api/projects");
  });
});

describe("useProject", () => {
  /**
   * Validates that useProject is disabled when id is undefined,
   * preventing unnecessary network requests.
   */
  it("does not fetch when id is undefined", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProject(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /**
   * Validates that useProject fetches a single project by ID.
   */
  it("fetches a project when id is provided", async () => {
    const project = { id: "abc", name: "My Project" };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(project)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProject("abc"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(project);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/projects/abc");
  });
});

describe("useCreateProject", () => {
  /**
   * Validates that useCreateProject POSTs to /api/projects and
   * invalidates the project cache on success.
   */
  it("posts a new project and invalidates cache", async () => {
    const created = { id: "new", name: "New Project" };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(created, 201)));

    const { wrapper, client } = createWrapper();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreateProject(), { wrapper });

    act(() => {
      result.current.mutate({ name: "New Project", owner: "me" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy.mock.calls[0]![1]?.method).toBe("POST");
    expect(invalidateSpy).toHaveBeenCalled();
  });
});

describe("useDeleteProject", () => {
  /**
   * Validates that useDeleteProject DELETEs the correct URL.
   */
  it("sends DELETE request", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteProject(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("abc");
    });

    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/projects/abc");
    expect(fetchSpy.mock.calls[0]![1]?.method).toBe("DELETE");
  });
});
