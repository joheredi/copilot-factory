// @vitest-environment jsdom
/**
 * Tests for task import mutation hooks.
 *
 * Validates that:
 * - useDiscoverTasks POSTs to `/import/discover` with the correct body
 * - useExecuteImport POSTs to `/import/execute` with the correct body
 * - useExecuteImport invalidates task and project caches on success
 * - Both hooks surface error states from failed API calls
 *
 * These hooks power the import dialog (T118). Incorrect endpoints or
 * missing cache invalidation would cause the import flow to silently
 * fail or leave stale data in the task board after importing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDiscoverTasks, useExecuteImport } from "./use-import";

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
  cleanup();
});

// ---------------------------------------------------------------------------
// useDiscoverTasks
// ---------------------------------------------------------------------------

describe("useDiscoverTasks", () => {
  /**
   * Validates that the discover mutation POSTs to the correct endpoint
   * with the path and optional pattern. This is the first step of the
   * import flow — sending the wrong endpoint would break discovery entirely.
   */
  it("POSTs to /import/discover with path and pattern", async () => {
    const response = {
      tasks: [{ title: "Task 1", taskType: "feature" }],
      warnings: [],
      suggestedProjectName: "my-project",
      suggestedRepositoryName: "my-project",
      format: "markdown",
    };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(response)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDiscoverTasks(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ path: "/home/user/project", pattern: "*.md" });
    });

    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toBe("/api/import/discover");
    expect(fetchSpy.mock.calls[0]![1]?.method).toBe("POST");

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body).toEqual({ path: "/home/user/project", pattern: "*.md" });
  });

  /**
   * Validates that the discover mutation returns the parsed response
   * with the correct shape including tasks, warnings, and suggestions.
   */
  it("returns typed discover response", async () => {
    const response = {
      tasks: [
        { title: "Implement auth", taskType: "feature", priority: "high" },
        { title: "Fix login bug", taskType: "bug_fix" },
      ],
      warnings: [{ file: "tasks.md", message: "Missing priority", severity: "warning" }],
      suggestedProjectName: "backend",
      suggestedRepositoryName: "backend",
      format: "markdown",
    };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(response)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDiscoverTasks(), { wrapper });

    act(() => {
      result.current.mutate({ path: "/tmp/project" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(response);
    expect(result.current.data?.tasks).toHaveLength(2);
    expect(result.current.data?.warnings).toHaveLength(1);
  });

  /**
   * Validates that the mutation exposes isPending state while the
   * request is in-flight. The import dialog uses this to show a
   * loading spinner during discovery scanning.
   */
  it("exposes isPending during request", async () => {
    let resolvePromise: (v: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolvePromise = resolve;
    });
    fetchSpy.mockImplementation(() => pending);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDiscoverTasks(), { wrapper });

    act(() => {
      result.current.mutate({ path: "/tmp/project" });
    });

    await waitFor(() => expect(result.current.isPending).toBe(true));

    await act(async () => {
      resolvePromise!(
        fakeResponse({
          tasks: [],
          warnings: [],
          suggestedProjectName: "",
          suggestedRepositoryName: "",
          format: "markdown",
        }),
      );
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  /**
   * Validates that API errors are surfaced through the error state.
   * The import dialog needs this to display error messages when
   * the path is invalid or the server is unreachable.
   */
  it("surfaces error on API failure", async () => {
    const errorBody = {
      statusCode: 400,
      error: "Bad Request",
      message: "Path does not exist",
      timestamp: "2026-01-01T00:00:00Z",
      path: "/import/discover",
    };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(errorBody, 400)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDiscoverTasks(), { wrapper });

    act(() => {
      result.current.mutate({ path: "/nonexistent" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// useExecuteImport
// ---------------------------------------------------------------------------

describe("useExecuteImport", () => {
  /**
   * Validates that the execute mutation POSTs to the correct endpoint
   * with the full import request body. This is the commit step that
   * actually creates tasks in the database.
   */
  it("POSTs to /import/execute with full request body", async () => {
    const response = {
      projectId: "proj-1",
      repositoryId: "repo-1",
      created: 3,
      skipped: 0,
      errors: [],
    };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(response)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useExecuteImport(), { wrapper });

    const input = {
      path: "/home/user/project",
      tasks: [
        { title: "Task 1", taskType: "feature" as const },
        { title: "Task 2", taskType: "bug_fix" as const },
        { title: "Task 3", taskType: "chore" as const },
      ],
      projectName: "My Project",
      repositoryName: "my-repo",
    };

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toBe("/api/import/execute");
    expect(fetchSpy.mock.calls[0]![1]?.method).toBe("POST");

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.projectName).toBe("My Project");
    expect(body.tasks).toHaveLength(3);
  });

  /**
   * Validates that the execute mutation returns the typed response
   * with project/repository IDs and creation counts. The dialog
   * uses this to show a success summary.
   */
  it("returns typed execute response", async () => {
    const response = {
      projectId: "proj-1",
      repositoryId: "repo-1",
      created: 5,
      skipped: 2,
      errors: ["Could not resolve dependency: AUTH-001"],
    };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(response)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useExecuteImport(), { wrapper });

    act(() => {
      result.current.mutate({
        path: "/tmp/project",
        tasks: [{ title: "T1", taskType: "feature" as const }],
        projectName: "Test",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.projectId).toBe("proj-1");
    expect(result.current.data?.created).toBe(5);
    expect(result.current.data?.skipped).toBe(2);
    expect(result.current.data?.errors).toHaveLength(1);
  });

  /**
   * Validates that the execute mutation invalidates both task and
   * project caches on success. This is critical — without invalidation,
   * the task board and project list would show stale data after an
   * import that creates a new project with tasks.
   */
  it("invalidates task and project caches on success", async () => {
    const response = {
      projectId: "proj-1",
      repositoryId: "repo-1",
      created: 1,
      skipped: 0,
      errors: [],
    };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(response)));

    const { client, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useExecuteImport(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        path: "/tmp/project",
        tasks: [{ title: "T1", taskType: "feature" as const }],
        projectName: "Test",
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tasks"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["projects"] });
  });

  /**
   * Validates that API errors are surfaced through the error state
   * on the execute mutation. The dialog needs this to show errors
   * if the import transaction fails (e.g., validation error, DB issue).
   */
  it("surfaces error on API failure", async () => {
    const errorBody = {
      statusCode: 422,
      error: "Unprocessable Entity",
      message: "No tasks provided",
      timestamp: "2026-01-01T00:00:00Z",
      path: "/import/execute",
    };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(errorBody, 422)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useExecuteImport(), { wrapper });

    act(() => {
      result.current.mutate({
        path: "/tmp/project",
        tasks: [],
        projectName: "Test",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });

  /**
   * Validates that the execute mutation exposes isPending state.
   * The import dialog shows a progress indicator during the
   * potentially slow import operation.
   */
  it("exposes isPending during request", async () => {
    let resolvePromise: (v: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolvePromise = resolve;
    });
    fetchSpy.mockImplementation(() => pending);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useExecuteImport(), { wrapper });

    act(() => {
      result.current.mutate({
        path: "/tmp/project",
        tasks: [{ title: "T1", taskType: "feature" as const }],
        projectName: "Test",
      });
    });

    await waitFor(() => expect(result.current.isPending).toBe(true));

    await act(async () => {
      resolvePromise!(
        fakeResponse({ projectId: "p1", repositoryId: "r1", created: 1, skipped: 0, errors: [] }),
      );
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});
