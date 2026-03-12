// @vitest-environment jsdom
/**
 * Tests for review, artifact, and merge hooks.
 *
 * Validates that:
 * - useReviewHistory fetches reviews for a task
 * - useReviewCyclePackets is disabled when ids are missing
 * - useTaskArtifacts fetches the artifact tree
 * - useMergeDetail fetches merge queue info
 *
 * The review center and task detail views depend on these hooks
 * for displaying the review lifecycle and artifact history.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useReviewHistory,
  useReviewCyclePackets,
  useTaskArtifacts,
  useMergeDetail,
} from "./use-reviews";

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

describe("useReviewHistory", () => {
  /**
   * Validates that review history is fetched for a specific task.
   */
  it("fetches review history", async () => {
    const data = { taskId: "t1", cycles: [] };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(data)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useReviewHistory("t1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/tasks/t1/reviews");
  });

  it("is disabled when taskId is undefined", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useReviewHistory(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useReviewCyclePackets", () => {
  /**
   * Validates the nested cycle packets endpoint.
   */
  it("fetches packets for a review cycle", async () => {
    const data = { cycleId: "c1", packets: [], leadDecision: null };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(data)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useReviewCyclePackets("t1", "c1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/tasks/t1/reviews/c1/packets");
  });

  /**
   * Validates both IDs must be present to enable the query.
   */
  it("is disabled when either id is undefined", () => {
    const { wrapper } = createWrapper();
    const { result: r1 } = renderHook(() => useReviewCyclePackets(undefined, "c1"), { wrapper });
    expect(r1.current.fetchStatus).toBe("idle");

    const { result: r2 } = renderHook(() => useReviewCyclePackets("t1", undefined), { wrapper });
    expect(r2.current.fetchStatus).toBe("idle");
  });
});

describe("useTaskArtifacts", () => {
  it("fetches artifact tree", async () => {
    const data = { taskId: "t1", artifacts: [] };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(data)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTaskArtifacts("t1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/tasks/t1/artifacts");
  });
});

describe("useMergeDetail", () => {
  it("fetches merge detail", async () => {
    const data = { taskId: "t1", mergeQueueItem: null, validationRuns: [] };
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(data)));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useMergeDetail("t1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/tasks/t1/merge");
  });

  it("is disabled when taskId is undefined", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useMergeDetail(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
