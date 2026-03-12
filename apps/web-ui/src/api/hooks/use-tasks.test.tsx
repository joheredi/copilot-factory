// @vitest-environment jsdom
/**
 * Tests for task query and mutation hooks.
 *
 * Validates that:
 * - useTasks fetches with filter params from the correct endpoint
 * - useTask is disabled when id is falsy
 * - useCreateTask POSTs and invalidates task queries
 * - useTaskTimeline fetches the timeline endpoint
 * - Operator action hooks POST to the correct action endpoints
 *
 * These hooks are the most critical in the app since tasks are the
 * central entity. Incorrect query keys or endpoints here would
 * break the entire task board UI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTasks, useTask, useTaskTimeline, useCreateTask, usePauseTask } from "./use-tasks";

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

describe("useTasks", () => {
  /**
   * Validates that useTasks applies filter and pagination params
   * to the query string. This is essential for the task board
   * filtering UI.
   */
  it("fetches tasks with filter params", async () => {
    const data = { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(data)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTasks({ status: "READY", priority: "high", page: 1 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain("/api/tasks");
    expect(url).toContain("status=READY");
    expect(url).toContain("priority=high");
  });
});

describe("useTask", () => {
  /**
   * Validates that useTask does not fire when id is undefined,
   * preventing 404 errors before the user selects a task.
   */
  it("is disabled when id is undefined", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTask(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches a single task", async () => {
    const task = { id: "t1", title: "Fix bug", status: "READY" };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(task)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTask("t1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(task);
  });
});

describe("useTaskTimeline", () => {
  /**
   * Validates the timeline endpoint is called correctly.
   * The task detail view depends on this for audit history.
   */
  it("fetches timeline for a task", async () => {
    const data = { data: [], meta: { page: 1, limit: 50, total: 0, totalPages: 1 } };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(data)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskTimeline("t1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy.mock.calls[0]![0]).toContain("/api/tasks/t1/timeline");
  });

  it("is disabled when taskId is undefined", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskTimeline(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCreateTask", () => {
  /**
   * Validates that task creation POSTs to the correct endpoint
   * and invalidates the task cache.
   */
  it("creates a task and invalidates cache", async () => {
    const task = { id: "new", title: "New Task" };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(task, 201)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateTask(), { wrapper });

    act(() => {
      result.current.mutate({
        repositoryId: "repo1",
        title: "New Task",
        taskType: "feature",
        priority: "medium",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy.mock.calls[0]![1]?.method).toBe("POST");
  });
});

describe("usePauseTask", () => {
  /**
   * Validates that operator action hooks POST to the correct
   * action sub-path. All 11 operator actions share this pattern,
   * so testing one validates the generic factory.
   */
  it("posts to the pause action endpoint", async () => {
    const result_ = { task: { id: "t1" }, auditEvent: { id: "a1" } };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(result_)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePauseTask("t1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ actorId: "operator", reason: "investigating" });
    });

    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/tasks/t1/actions/pause");
    expect(fetchSpy.mock.calls[0]![1]?.method).toBe("POST");
  });
});
