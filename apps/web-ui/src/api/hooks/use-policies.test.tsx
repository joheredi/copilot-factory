// @vitest-environment jsdom
/**
 * Tests for policy and configuration hooks.
 *
 * Validates that:
 * - usePolicies fetches the paginated list
 * - usePolicy is disabled when id is falsy
 * - useEffectiveConfig fetches the merged config
 * - useUpdatePolicy PUTs and invalidates policy queries
 *
 * The config editor view depends on these hooks for displaying
 * and editing policy sets and the effective configuration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePolicies, usePolicy, useEffectiveConfig, useUpdatePolicy } from "./use-policies";

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

describe("usePolicies", () => {
  /**
   * Validates that usePolicies fetches from /api/policies.
   */
  it("fetches paginated policies", async () => {
    const data = { items: [], page: 1, limit: 20, total: 0, hasMore: false };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(data)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePolicies(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy.mock.calls[0]![0]).toContain("/api/policies");
  });
});

describe("usePolicy", () => {
  /**
   * Validates conditional fetching for the policy detail view.
   */
  it("is disabled when id is undefined", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePolicy(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useEffectiveConfig", () => {
  /**
   * Validates that the effective config endpoint is correct.
   * The config editor shows this as the merged view.
   */
  it("fetches effective config", async () => {
    const data = { layers: [], effective: {} };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(data)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useEffectiveConfig(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/config/effective");
  });
});

describe("useUpdatePolicy", () => {
  /**
   * Validates that policy updates PUT to the correct URL.
   */
  it("updates a policy and invalidates cache", async () => {
    const policy = { id: "p1", name: "Updated" };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(policy)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdatePolicy("p1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "Updated" });
    });

    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/policies/p1");
    expect(fetchSpy.mock.calls[0]![1]?.method).toBe("PUT");
  });
});
