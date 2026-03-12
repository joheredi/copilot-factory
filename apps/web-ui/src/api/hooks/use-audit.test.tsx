// @vitest-environment jsdom
/**
 * Tests for audit log hooks.
 *
 * Validates that the useAuditLog hook fetches from the correct
 * endpoint with filter parameters. The audit explorer view
 * depends on this for its main data source.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAuditLog } from "./use-audit";

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

function fakeResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
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

describe("useAuditLog", () => {
  /**
   * Validates that useAuditLog sends filter params to /api/audit.
   * The audit explorer applies entity type, actor, and time range filters.
   */
  it("fetches audit log with filters", async () => {
    const data = { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(data)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useAuditLog({ entityType: "task", entityId: "t1", page: 1 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain("/api/audit");
    expect(url).toContain("entityType=task");
    expect(url).toContain("entityId=t1");
  });

  /**
   * Validates that useAuditLog works without any filters (fetches all).
   */
  it("fetches without filters", async () => {
    const data = { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(data)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAuditLog(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/audit");
  });
});
