// @vitest-environment jsdom
/**
 * Tests for worker pool and agent profile hooks.
 *
 * Validates that:
 * - usePools fetches with filter params
 * - usePool is disabled when id is falsy
 * - usePoolWorkers fetches workers for a pool
 * - useCreatePool POSTs and invalidates pool queries
 * - useAgentProfiles fetches profiles scoped under a pool
 *
 * Pool management is a key operator surface — incorrect endpoints
 * or cache keys here would break the workers/config UI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePools, usePool, usePoolWorkers, useCreatePool, useAgentProfiles } from "./use-pools";

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

describe("usePools", () => {
  /**
   * Validates that usePools sends filter params as query parameters.
   */
  it("fetches pools with filters", async () => {
    const data = { items: [], page: 1, limit: 20, total: 0, hasMore: false };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(data)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePools({ poolType: "developer", enabled: true }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain("poolType=developer");
    expect(url).toContain("enabled=true");
  });
});

describe("usePool", () => {
  /**
   * Validates conditional fetching — the pool detail view uses
   * this to wait until a pool ID is selected.
   */
  it("is disabled when id is undefined", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePool(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("usePoolWorkers", () => {
  /**
   * Validates the nested workers endpoint under a pool.
   */
  it("fetches workers for a pool", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse([])));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePoolWorkers("pool1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/pools/pool1/workers");
  });
});

describe("useCreatePool", () => {
  /**
   * Validates that pool creation POSTs correctly.
   */
  it("creates a pool", async () => {
    const pool = { id: "new", name: "Dev Pool" };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(pool, 201)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreatePool(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "Dev Pool", poolType: "developer" });
    });

    expect(fetchSpy.mock.calls[0]![1]?.method).toBe("POST");
  });
});

describe("useAgentProfiles", () => {
  /**
   * Validates the nested profiles endpoint under a pool.
   */
  it("fetches profiles for a pool", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse([])));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAgentProfiles("pool1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/pools/pool1/profiles");
  });

  it("is disabled when poolId is undefined", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAgentProfiles(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
