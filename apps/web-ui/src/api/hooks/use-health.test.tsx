// @vitest-environment jsdom
/**
 * Tests for health check hook.
 *
 * Validates that useHealth fetches from /api/health.
 * The dashboard uses this to display a connectivity indicator.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useHealth } from "./use-health";

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

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useHealth", () => {
  /**
   * Validates that the health hook fetches from the correct endpoint.
   */
  it("fetches from /api/health", async () => {
    const data = {
      status: "ok",
      service: "factory-control-plane",
      timestamp: "2025-01-01T00:00:00Z",
    };
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useHealth(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/health");
  });
});
