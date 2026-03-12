// @vitest-environment jsdom
/**
 * Tests for repository hooks.
 *
 * Validates that:
 * - useRepositories fetches from the nested project endpoint
 * - useRepository is disabled when id is falsy
 * - useCreateRepository POSTs to the correct endpoint
 *
 * Repository management is a sub-view of project details and
 * the config editor uses it for repo scope settings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRepositories, useRepository, useCreateRepository } from "./use-repositories";

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

describe("useRepositories", () => {
  /**
   * Validates the nested endpoint: /projects/:id/repositories.
   */
  it("fetches repositories for a project", async () => {
    const data = { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(data)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRepositories("proj1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy.mock.calls[0]![0]).toContain("/api/projects/proj1/repositories");
  });

  it("is disabled when projectId is undefined", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRepositories(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useRepository", () => {
  it("is disabled when id is undefined", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRepository(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches a single repository", async () => {
    const repo = { id: "r1", name: "my-repo" };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(repo)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRepository("r1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/repositories/r1");
  });
});

describe("useCreateRepository", () => {
  /**
   * Validates that repository creation uses the nested project endpoint.
   */
  it("creates a repository under a project", async () => {
    const repo = { id: "new", name: "new-repo" };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(repo, 201)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateRepository("proj1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        name: "new-repo",
        remoteUrl: "https://github.com/test/repo",
        defaultBranch: "main",
        localCheckoutStrategy: "worktree",
      });
    });

    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/projects/proj1/repositories");
    expect(fetchSpy.mock.calls[0]![1]?.method).toBe("POST");
  });
});
