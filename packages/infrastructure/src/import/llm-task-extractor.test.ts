/**
 * Tests for the LLM-based task extractor module.
 *
 * Uses mock CopilotClient and CopilotSession implementations to test
 * extraction logic without requiring the actual Copilot CLI.
 */

import { describe, it, expect, vi } from "vitest";
import type {
  CopilotClientLike,
  CopilotSessionLike,
  CopilotClientFactory,
  MarkdownFileInput,
} from "./llm-task-extractor.js";
import { extractTasksWithLlm, parseLlmResponse } from "./llm-task-extractor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock session that returns predetermined responses. */
function createMockSession(responsesByPrompt: Map<string, string>): CopilotSessionLike {
  return {
    sendAndWait: vi.fn(async (options: { prompt: string }) => {
      for (const [keyword, response] of responsesByPrompt) {
        if (options.prompt.includes(keyword)) {
          return { data: { content: response } };
        }
      }
      return undefined;
    }),
    disconnect: vi.fn(async () => {}),
  };
}

/** Create a mock client that returns a predetermined session. */
function createMockClient(session: CopilotSessionLike): CopilotClientLike {
  return {
    start: vi.fn(async () => {}),
    createSession: vi.fn(async () => session),
    stop: vi.fn(async () => []),
  };
}

/** Create a factory that returns the given client. */
function createMockFactory(client: CopilotClientLike): CopilotClientFactory {
  return () => client;
}

/** A valid LLM response for a simple task. */
const VALID_TASK_RESPONSE = JSON.stringify({
  task: {
    title: "Implement user authentication",
    taskType: "feature",
    priority: "high",
    description: "Add JWT-based auth with login and logout endpoints.",
    acceptanceCriteria: ["Login endpoint returns JWT", "Logout invalidates token"],
    dependencies: ["T002"],
    externalRef: "T045",
    status: "BACKLOG",
  },
});

const SAMPLE_MARKDOWN = `# T045: Implement user authentication

| Field | Value |
| --- | --- |
| **Type** | Feature |
| **Priority** | High |
| **Dependencies** | [T002](./T002-setup.md) |

## Description
Add JWT-based auth with login and logout endpoints.

## Acceptance Criteria
- [ ] Login endpoint returns JWT
- [ ] Logout invalidates token
`;

// ---------------------------------------------------------------------------
// parseLlmResponse tests
// ---------------------------------------------------------------------------

describe("parseLlmResponse", () => {
  it("parses a valid JSON response", () => {
    const result = parseLlmResponse(VALID_TASK_RESPONSE, "T045-auth.md");
    expect(result.task).not.toBeNull();
    expect(result.task!.title).toBe("Implement user authentication");
    expect(result.task!.taskType).toBe("feature");
    expect(result.task!.priority).toBe("high");
    expect(result.task!.source).toBe("T045-auth.md");
    expect(result.warnings).toHaveLength(0);
  });

  it("parses JSON wrapped in markdown code fences", () => {
    const wrapped = "```json\n" + VALID_TASK_RESPONSE + "\n```";
    const result = parseLlmResponse(wrapped, "T045-auth.md");
    expect(result.task).not.toBeNull();
    expect(result.task!.title).toBe("Implement user authentication");
  });

  it("handles null task with reason", () => {
    const response = JSON.stringify({
      task: null,
      reason: "File does not contain task information",
    });
    const result = parseLlmResponse(response, "readme.md");
    expect(result.task).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain("File does not contain task information");
  });

  it("handles non-JSON response", () => {
    const result = parseLlmResponse("This is not JSON at all", "bad.md");
    expect(result.task).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain("did not contain a JSON object");
  });

  it("handles malformed JSON", () => {
    const result = parseLlmResponse('{"task": {broken}', "bad.md");
    expect(result.task).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain("Failed to parse");
  });

  it("handles response with invalid schema values", () => {
    const response = JSON.stringify({
      task: {
        title: "Valid title",
        taskType: "invalid_type",
      },
    });
    const result = parseLlmResponse(response, "bad-type.md");
    expect(result.task).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.message.includes("schema error"))).toBe(true);
  });

  it("handles response with missing required title", () => {
    const response = JSON.stringify({
      task: {
        taskType: "feature",
        description: "No title here",
      },
    });
    const result = parseLlmResponse(response, "no-title.md");
    expect(result.task).toBeNull();
    expect(result.warnings.some((w) => w.field === "title")).toBe(true);
  });

  it("injects source filename into parsed task", () => {
    const result = parseLlmResponse(VALID_TASK_RESPONSE, "custom-filename.md");
    expect(result.task).not.toBeNull();
    expect(result.task!.source).toBe("custom-filename.md");
  });

  it("handles response with extra text around JSON", () => {
    const response = "Here is the extracted task:\n" + VALID_TASK_RESPONSE + "\nDone!";
    const result = parseLlmResponse(response, "T045-auth.md");
    expect(result.task).not.toBeNull();
    expect(result.task!.title).toBe("Implement user authentication");
  });

  it("applies default values from Zod schema", () => {
    const response = JSON.stringify({
      task: {
        title: "Minimal task",
        taskType: "chore",
      },
    });
    const result = parseLlmResponse(response, "minimal.md");
    expect(result.task).not.toBeNull();
    expect(result.task!.priority).toBe("medium"); // Zod default
    expect(result.task!.status).toBe("BACKLOG"); // Zod default
  });
});

// ---------------------------------------------------------------------------
// extractTasksWithLlm tests
// ---------------------------------------------------------------------------

describe("extractTasksWithLlm", () => {
  it("extracts tasks from files using mock client", async () => {
    const responses = new Map([["T045-auth.md", VALID_TASK_RESPONSE]]);
    const session = createMockSession(responses);
    const client = createMockClient(session);
    const factory = createMockFactory(client);

    const files: MarkdownFileInput[] = [{ filename: "T045-auth.md", content: SAMPLE_MARKDOWN }];

    const result = await extractTasksWithLlm(files, factory);

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.title).toBe("Implement user authentication");
    expect(result.failedFiles).toHaveLength(0);
    expect(client.start).toHaveBeenCalledOnce();
    expect(client.stop).toHaveBeenCalledOnce();
  });

  it("returns empty result for empty file list", async () => {
    const session = createMockSession(new Map());
    const client = createMockClient(session);
    const factory = createMockFactory(client);

    const result = await extractTasksWithLlm([], factory);

    expect(result.tasks).toHaveLength(0);
    expect(result.failedFiles).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(client.start).not.toHaveBeenCalled();
  });

  it("handles client start failure gracefully", async () => {
    const client: CopilotClientLike = {
      start: vi.fn(async () => {
        throw new Error("No Copilot CLI found");
      }),
      createSession: vi.fn(),
      stop: vi.fn(async () => []),
    };
    const factory = createMockFactory(client);

    const files: MarkdownFileInput[] = [{ filename: "T001.md", content: "# Task 1" }];

    const result = await extractTasksWithLlm(files, factory);

    expect(result.tasks).toHaveLength(0);
    expect(result.failedFiles).toEqual(["T001.md"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain("Copilot SDK unavailable");
  });

  it("handles session creation failure gracefully", async () => {
    const client: CopilotClientLike = {
      start: vi.fn(async () => {}),
      createSession: vi.fn(async () => {
        throw new Error("Session creation failed");
      }),
      stop: vi.fn(async () => []),
    };
    const factory = createMockFactory(client);

    const files: MarkdownFileInput[] = [{ filename: "T001.md", content: "# Task 1" }];

    const result = await extractTasksWithLlm(files, factory);

    expect(result.tasks).toHaveLength(0);
    expect(result.failedFiles).toEqual(["T001.md"]);
    expect(
      result.warnings.some((w) => w.message.includes("Failed to create Copilot session")),
    ).toBe(true);
  });

  it("handles empty LLM response for a file", async () => {
    const session: CopilotSessionLike = {
      sendAndWait: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => {}),
    };
    const client = createMockClient(session);
    const factory = createMockFactory(client);

    const files: MarkdownFileInput[] = [{ filename: "T001.md", content: "# Task 1" }];

    const result = await extractTasksWithLlm(files, factory);

    expect(result.tasks).toHaveLength(0);
    expect(result.failedFiles).toEqual(["T001.md"]);
    expect(result.warnings.some((w) => w.message.includes("empty response"))).toBe(true);
  });

  it("handles per-file extraction errors without failing the batch", async () => {
    const callCount = { n: 0 };
    const session: CopilotSessionLike = {
      sendAndWait: vi.fn(async (options: { prompt: string }) => {
        callCount.n++;
        if (options.prompt.includes("T001.md")) {
          throw new Error("Network timeout");
        }
        return { data: { content: VALID_TASK_RESPONSE } };
      }),
      disconnect: vi.fn(async () => {}),
    };
    const client = createMockClient(session);
    const factory = createMockFactory(client);

    const files: MarkdownFileInput[] = [
      { filename: "T001.md", content: "# Task that fails" },
      { filename: "T002.md", content: "# Task that succeeds" },
    ];

    const result = await extractTasksWithLlm(files, factory);

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.title).toBe("Implement user authentication");
    expect(result.failedFiles).toEqual(["T001.md"]);
    expect(result.warnings.some((w) => w.message.includes("Network timeout"))).toBe(true);
  });

  it("handles multiple files successfully", async () => {
    const task2Response = JSON.stringify({
      task: {
        title: "Add logging",
        taskType: "chore",
        description: "Add structured logging to all services.",
        externalRef: "T046",
      },
    });

    const responses = new Map([
      ["T045-auth.md", VALID_TASK_RESPONSE],
      ["T046-logging.md", task2Response],
    ]);
    const session = createMockSession(responses);
    const client = createMockClient(session);
    const factory = createMockFactory(client);

    const files: MarkdownFileInput[] = [
      { filename: "T045-auth.md", content: "# Auth task" },
      { filename: "T046-logging.md", content: "# Logging task" },
    ];

    const result = await extractTasksWithLlm(files, factory);

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]!.title).toBe("Implement user authentication");
    expect(result.tasks[1]!.title).toBe("Add logging");
    expect(result.failedFiles).toHaveLength(0);
  });

  it("cleans up session and client even on failure", async () => {
    const session: CopilotSessionLike = {
      sendAndWait: vi.fn(async () => {
        throw new Error("Unexpected error");
      }),
      disconnect: vi.fn(async () => {}),
    };
    const client = createMockClient(session);
    const factory = createMockFactory(client);

    const files: MarkdownFileInput[] = [{ filename: "T001.md", content: "# Task 1" }];

    await extractTasksWithLlm(files, factory);

    expect(session.disconnect).toHaveBeenCalledOnce();
    expect(client.stop).toHaveBeenCalledOnce();
  });

  it("handles malformed LLM response gracefully", async () => {
    const responses = new Map([["T001.md", "This is not valid JSON at all"]]);
    const session = createMockSession(responses);
    const client = createMockClient(session);
    const factory = createMockFactory(client);

    const files: MarkdownFileInput[] = [{ filename: "T001.md", content: "# Bad task" }];

    const result = await extractTasksWithLlm(files, factory);

    expect(result.tasks).toHaveLength(0);
    expect(result.failedFiles).toEqual(["T001.md"]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
