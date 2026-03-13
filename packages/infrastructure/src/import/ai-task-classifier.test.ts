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

function mockFetch(responseBody: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  }) as unknown as typeof fetch;
}

function makeDeps(overrides: Partial<AiClassifierDeps> = {}): Partial<AiClassifierDeps> {
  return {
    getToken: overrides.getToken ?? (async () => "fake-token"),
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
