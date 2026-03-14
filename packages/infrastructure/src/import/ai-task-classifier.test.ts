/**
 * Tests for the AI-powered task classifier.
 *
 * These tests validate classification logic using mocked HTTP responses
 * and token resolution — no real API calls are made.
 *
 * Why these tests matter:
 * - The classifier is the bridge between raw markdown content and accurate
 *   taskType/status values. Incorrect classification means tasks are filed
 *   wrong or lose their completion status on import.
 * - The deterministic fallback must work reliably when AI is unavailable
 *   (offline, no token, API errors) to avoid blocking imports entirely.
 * - Response parsing must handle LLM quirks (markdown fences, extra text).
 */

import { describe, it, expect, vi } from "vitest";

import { classifyImportedTasks, parseClassificationResponse } from "./ai-task-classifier.js";

import type { TaskClassificationInput, AiClassifierDeps } from "./ai-task-classifier.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const sampleTasks: TaskClassificationInput[] = [
  {
    title: "Add user authentication",
    description: "Implement JWT-based login and token refresh.",
    rawType: "feature",
    rawStatus: "done",
  },
  {
    title: "Fix broken login redirect",
    description: "Users are redirected to 404 after login.",
    rawType: "bug",
    rawStatus: "in progress",
  },
  {
    title: "Update dependencies",
    rawType: "chore",
    rawStatus: "not started",
  },
];

function mockFetch(
  responseBody: unknown,
  status = 200,
  headers?: Record<string, string>,
): typeof fetch {
  const headersMap = new Map(Object.entries(headers ?? {}));
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
    headers: { get: (name: string) => headersMap.get(name.toLowerCase()) ?? null },
  }) as unknown as typeof fetch;
}

/** No-op sleep to keep tests instant. */
const instantSleep = vi.fn().mockResolvedValue(undefined) as unknown as (
  ms: number,
) => Promise<void>;

function makeDeps(overrides: Partial<AiClassifierDeps> = {}): Partial<AiClassifierDeps> {
  return {
    getToken: overrides.getToken ?? (async () => "fake-token"),
    sleep: overrides.sleep ?? instantSleep,
    retryOptions: overrides.retryOptions ?? { interBatchDelayMs: 0 },
    onRetry: overrides.onRetry,
    fetchFn:
      overrides.fetchFn ??
      mockFetch({
        choices: [
          {
            message: {
              content: JSON.stringify([
                { taskType: "feature", status: "DONE" },
                { taskType: "bug_fix", status: "BACKLOG" },
                { taskType: "chore", status: "BACKLOG" },
              ]),
            },
          },
        ],
      }),
  };
}

// ─── parseClassificationResponse ─────────────────────────────────────────────

describe("parseClassificationResponse", () => {
  it("parses a clean JSON array", () => {
    const input =
      '[{"taskType":"feature","status":"DONE"},{"taskType":"chore","status":"BACKLOG"}]';
    const result = parseClassificationResponse(input, 2);
    expect(result).toEqual([
      { taskType: "feature", status: "DONE" },
      { taskType: "chore", status: "BACKLOG" },
    ]);
  });

  it("strips markdown code fences", () => {
    const input = '```json\n[{"taskType":"bug_fix","status":"DONE"}]\n```';
    const result = parseClassificationResponse(input, 1);
    expect(result).toEqual([{ taskType: "bug_fix", status: "DONE" }]);
  });

  it("extracts JSON array from surrounding text", () => {
    const input = 'Here are the results:\n[{"taskType":"refactor","status":"BACKLOG"}]\nDone!';
    const result = parseClassificationResponse(input, 1);
    expect(result).toEqual([{ taskType: "refactor", status: "BACKLOG" }]);
  });

  it("normalizes common LLM variants", () => {
    const input =
      '[{"taskType":"bugfix","status":"DONE"},{"taskType":"docs","status":"CANCELLED"}]';
    const result = parseClassificationResponse(input, 2);
    expect(result).toEqual([
      { taskType: "bug_fix", status: "DONE" },
      { taskType: "documentation", status: "CANCELLED" },
    ]);
  });

  it("falls back to chore/BACKLOG for unrecognized values", () => {
    const input = '[{"taskType":"unknown_type","status":"weird_status"}]';
    const result = parseClassificationResponse(input, 1);
    expect(result).toEqual([{ taskType: "chore", status: "BACKLOG" }]);
  });

  it("throws when no JSON array is found", () => {
    expect(() => parseClassificationResponse("no json here", 1)).toThrow("No JSON array found");
  });
});

// ─── classifyImportedTasks ───────────────────────────────────────────────────

describe("classifyImportedTasks", () => {
  it("returns AI classification results on success", async () => {
    const { results, warnings } = await classifyImportedTasks(sampleTasks, makeDeps());
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ taskType: "feature", status: "DONE" });
    expect(results[1]).toEqual({ taskType: "bug_fix", status: "BACKLOG" });
    expect(results[2]).toEqual({ taskType: "chore", status: "BACKLOG" });
    expect(warnings).toHaveLength(0);
  });

  it("returns empty results for empty input", async () => {
    const { results, warnings } = await classifyImportedTasks([], makeDeps());
    expect(results).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("falls back to deterministic classification when no token is available", async () => {
    const deps = makeDeps({ getToken: async () => null });
    const { results, warnings } = await classifyImportedTasks(sampleTasks, deps);

    expect(results).toHaveLength(3);
    // Deterministic fallback: rawType "feature" + rawStatus "done"
    expect(results[0]).toEqual({ taskType: "feature", status: "DONE" });
    // rawType "bug" → "bug_fix", rawStatus "in progress" → "BACKLOG"
    expect(results[1]).toEqual({ taskType: "bug_fix", status: "BACKLOG" });
    // rawType "chore" → "chore", rawStatus "not started" → "BACKLOG"
    expect(results[2]).toEqual({ taskType: "chore", status: "BACKLOG" });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("GitHub token not available");
  });

  it("falls back to deterministic classification on API error", async () => {
    const deps = makeDeps({
      fetchFn: mockFetch({ error: "rate limited" }, 429),
    });
    const { results, warnings } = await classifyImportedTasks(sampleTasks, deps);

    expect(results).toHaveLength(3);
    expect(results[0]!.taskType).toBe("feature");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("AI classification failed");
  });

  it("falls back on network timeout", async () => {
    const deps = makeDeps({
      fetchFn: vi.fn().mockRejectedValue(new Error("fetch timeout")) as unknown as typeof fetch,
    });
    const { results, warnings } = await classifyImportedTasks(sampleTasks, deps);

    expect(results).toHaveLength(3);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("AI classification failed");
  });

  it("pads with deterministic fallback when response has fewer items", async () => {
    const deps = makeDeps({
      fetchFn: mockFetch({
        choices: [{ message: { content: '[{"taskType":"feature","status":"DONE"}]' } }],
      }),
    });
    const { results, warnings } = await classifyImportedTasks(sampleTasks, deps);

    expect(results).toHaveLength(3);
    // First task: from AI
    expect(results[0]).toEqual({ taskType: "feature", status: "DONE" });
    // Remaining tasks: padded with deterministic fallback
    expect(results[1]!.taskType).toBe("bug_fix");
    expect(results[2]!.taskType).toBe("chore");
    expect(warnings).toHaveLength(0);
  });

  it("sends correct request to GitHub Models API", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '[{"taskType":"feature","status":"DONE"},{"taskType":"bug_fix","status":"BACKLOG"},{"taskType":"chore","status":"BACKLOG"}]',
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    await classifyImportedTasks(sampleTasks, {
      getToken: async () => "test-token-123",
      fetchFn: fetchSpy,
      sleep: instantSleep,
      retryOptions: { interBatchDelayMs: 0 },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://models.inference.ai.azure.com/chat/completions");
    expect(options.method).toBe("POST");

    const headers = options.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-token-123");

    const body = JSON.parse(options.body as string) as { model: string; temperature: number };
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.temperature).toBe(0);
  });
});

// ─── Retry and rate-limit behaviour ─────────────────────────────────────────

describe("classifyImportedTasks — retry on rate limit", () => {
  /** Helper to build a 429 response with optional Retry-After header and body. */
  function make429Response(
    bodyText: string,
    retryAfterHeader?: string,
  ): {
    ok: false;
    status: 429;
    text: () => Promise<string>;
    headers: { get: (n: string) => string | null };
  } {
    const headers = new Map<string, string>();
    if (retryAfterHeader) headers.set("retry-after", retryAfterHeader);
    return {
      ok: false as const,
      status: 429,
      text: async () => bodyText,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    };
  }

  /** Helper to build a successful response. */
  function makeOkResponse(results: Array<{ taskType: string; status: string }>): {
    ok: true;
    status: 200;
    json: () => Promise<unknown>;
    headers: { get: () => null };
  } {
    return {
      ok: true as const,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(results) } }],
      }),
      headers: { get: () => null },
    };
  }

  it("retries on 429 and succeeds on second attempt", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(make429Response('{"error":"rate limited"}'))
      .mockResolvedValueOnce(
        makeOkResponse([
          { taskType: "feature", status: "DONE" },
          { taskType: "bug_fix", status: "BACKLOG" },
          { taskType: "chore", status: "BACKLOG" },
        ]),
      ) as unknown as typeof fetch;

    const sleepFn = vi.fn().mockResolvedValue(undefined) as unknown as (
      ms: number,
    ) => Promise<void>;

    const { results, warnings } = await classifyImportedTasks(sampleTasks, {
      ...makeDeps({ fetchFn }),
      sleep: sleepFn,
      retryOptions: { maxRetries: 3, initialDelayMs: 1000, interBatchDelayMs: 0 },
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ taskType: "feature", status: "DONE" });
    expect(warnings).toHaveLength(0);
    // Sleep was called for the retry backoff
    expect(sleepFn).toHaveBeenCalled();
  });

  it("parses Retry-After header to determine wait time", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(make429Response('{"error":"rate limited"}', "30"))
      .mockResolvedValueOnce(
        makeOkResponse([
          { taskType: "feature", status: "DONE" },
          { taskType: "bug_fix", status: "BACKLOG" },
          { taskType: "chore", status: "BACKLOG" },
        ]),
      ) as unknown as typeof fetch;

    const sleepFn = vi.fn().mockResolvedValue(undefined) as unknown as (
      ms: number,
    ) => Promise<void>;

    await classifyImportedTasks(sampleTasks, {
      ...makeDeps({ fetchFn }),
      sleep: sleepFn,
      retryOptions: { maxRetries: 3, initialDelayMs: 1000, interBatchDelayMs: 0 },
    });

    // Should have waited 30s (30000ms) from the Retry-After header
    expect(sleepFn).toHaveBeenCalledWith(30_000);
  });

  it("parses 'Please wait N seconds' from response body", async () => {
    const bodyText =
      '{"error":{"message":"Rate limit exceeded. Please wait 60 seconds before retrying."}}';
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(make429Response(bodyText))
      .mockResolvedValueOnce(
        makeOkResponse([
          { taskType: "feature", status: "DONE" },
          { taskType: "bug_fix", status: "BACKLOG" },
          { taskType: "chore", status: "BACKLOG" },
        ]),
      ) as unknown as typeof fetch;

    const sleepFn = vi.fn().mockResolvedValue(undefined) as unknown as (
      ms: number,
    ) => Promise<void>;

    await classifyImportedTasks(sampleTasks, {
      ...makeDeps({ fetchFn }),
      sleep: sleepFn,
      retryOptions: { maxRetries: 3, initialDelayMs: 1000, interBatchDelayMs: 0 },
    });

    // Should have waited 60s (60000ms) parsed from the body
    expect(sleepFn).toHaveBeenCalledWith(60_000);
  });

  it("falls back to deterministic after exhausting retries", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(make429Response('{"error":"rate limited"}')) as unknown as typeof fetch;

    const sleepFn = vi.fn().mockResolvedValue(undefined) as unknown as (
      ms: number,
    ) => Promise<void>;

    const { results, warnings } = await classifyImportedTasks(sampleTasks, {
      ...makeDeps({ fetchFn }),
      sleep: sleepFn,
      retryOptions: { maxRetries: 2, initialDelayMs: 100, interBatchDelayMs: 0 },
    });

    // 1 initial + 2 retries = 3 calls
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(3);
    // Deterministic fallback
    expect(results[0]).toEqual({ taskType: "feature", status: "DONE" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("AI classification failed");
  });

  it("does not retry on non-retryable errors (400)", async () => {
    const headersMap = new Map<string, string>();
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"bad request"}',
      headers: { get: (name: string) => headersMap.get(name.toLowerCase()) ?? null },
    }) as unknown as typeof fetch;

    const sleepFn = vi.fn().mockResolvedValue(undefined) as unknown as (
      ms: number,
    ) => Promise<void>;

    const { results, warnings } = await classifyImportedTasks(sampleTasks, {
      ...makeDeps({ fetchFn }),
      sleep: sleepFn,
      retryOptions: { maxRetries: 3, initialDelayMs: 100, interBatchDelayMs: 0 },
    });

    // Only 1 call — no retries for 400
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(3);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("AI classification failed");
    // Sleep should not have been called for retry (may be called for inter-batch)
  });

  it("calls onRetry callback with correct parameters", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(make429Response('{"error":"rate limited"}'))
      .mockResolvedValueOnce(make429Response('{"error":"rate limited"}'))
      .mockResolvedValueOnce(
        makeOkResponse([
          { taskType: "feature", status: "DONE" },
          { taskType: "bug_fix", status: "BACKLOG" },
          { taskType: "chore", status: "BACKLOG" },
        ]),
      ) as unknown as typeof fetch;

    const sleepFn = vi.fn().mockResolvedValue(undefined) as unknown as (
      ms: number,
    ) => Promise<void>;
    const onRetry = vi.fn();

    await classifyImportedTasks(sampleTasks, {
      ...makeDeps({ fetchFn }),
      sleep: sleepFn,
      onRetry,
      retryOptions: { maxRetries: 3, initialDelayMs: 1000, interBatchDelayMs: 0 },
    });

    expect(onRetry).toHaveBeenCalledTimes(2);
    // First retry: batch 1, attempt 1
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Number), 1, 3);
    // Second retry: batch 1, attempt 2
    expect(onRetry).toHaveBeenNthCalledWith(2, 1, expect.any(Number), 2, 3);
  });

  it("applies inter-batch delay between batches", async () => {
    // Generate 25 tasks to force 2 batches (batch size = 20)
    const manyTasks: TaskClassificationInput[] = Array.from({ length: 25 }, (_, i) => ({
      title: `Task ${i}`,
      rawType: "chore",
    }));

    const batch1Results = Array.from({ length: 20 }, () => ({
      taskType: "chore",
      status: "BACKLOG",
    }));
    const batch2Results = Array.from({ length: 5 }, () => ({
      taskType: "chore",
      status: "BACKLOG",
    }));

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(makeOkResponse(batch1Results))
      .mockResolvedValueOnce(makeOkResponse(batch2Results)) as unknown as typeof fetch;

    const sleepFn = vi.fn().mockResolvedValue(undefined) as unknown as (
      ms: number,
    ) => Promise<void>;

    await classifyImportedTasks(manyTasks, {
      ...makeDeps({ fetchFn }),
      sleep: sleepFn,
      retryOptions: { interBatchDelayMs: 750 },
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    // Inter-batch delay should be called once (between batch 1 and 2, not after batch 2)
    expect(sleepFn).toHaveBeenCalledWith(750);
  });

  it("retries on 503 service unavailable", async () => {
    const headersMap = new Map<string, string>();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "Service Unavailable",
        headers: { get: (name: string) => headersMap.get(name.toLowerCase()) ?? null },
      })
      .mockResolvedValueOnce(
        makeOkResponse([
          { taskType: "feature", status: "DONE" },
          { taskType: "bug_fix", status: "BACKLOG" },
          { taskType: "chore", status: "BACKLOG" },
        ]),
      ) as unknown as typeof fetch;

    const sleepFn = vi.fn().mockResolvedValue(undefined) as unknown as (
      ms: number,
    ) => Promise<void>;

    const { results, warnings } = await classifyImportedTasks(sampleTasks, {
      ...makeDeps({ fetchFn }),
      sleep: sleepFn,
      retryOptions: { maxRetries: 3, initialDelayMs: 100, interBatchDelayMs: 0 },
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ taskType: "feature", status: "DONE" });
    expect(warnings).toHaveLength(0);
  });

  it("uses exponential backoff when no Retry-After hint is available", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(make429Response('{"error":"rate limited"}'))
      .mockResolvedValueOnce(make429Response('{"error":"rate limited"}'))
      .mockResolvedValueOnce(
        makeOkResponse([
          { taskType: "feature", status: "DONE" },
          { taskType: "bug_fix", status: "BACKLOG" },
          { taskType: "chore", status: "BACKLOG" },
        ]),
      ) as unknown as typeof fetch;

    const sleepFn = vi.fn().mockResolvedValue(undefined) as unknown as (
      ms: number,
    ) => Promise<void>;

    await classifyImportedTasks(sampleTasks, {
      ...makeDeps({ fetchFn }),
      sleep: sleepFn,
      retryOptions: { maxRetries: 3, initialDelayMs: 1000, interBatchDelayMs: 0 },
    });

    // Attempt 0 backoff: 1000 * 2^0 = 1000
    expect(sleepFn).toHaveBeenNthCalledWith(1, 1000);
    // Attempt 1 backoff: 1000 * 2^1 = 2000
    expect(sleepFn).toHaveBeenNthCalledWith(2, 2000);
  });
});
