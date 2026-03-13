// @vitest-environment jsdom
/**
 * Tests for the BatchCreateDialog component (T130).
 *
 * These tests validate:
 * - Dialog renders with JSON textarea and action buttons
 * - Validation catches malformed JSON (syntax errors)
 * - Validation catches missing required fields per task item
 * - Validation catches invalid enum values for taskType and priority
 * - Validation succeeds for well-formed input and shows task count
 * - Batch creation submits the validated payload and closes dialog
 * - API errors are displayed in the dialog for operator feedback
 * - Dialog can be cancelled without side effects
 * - Editing the textarea clears previous validation results
 * - Validate button is disabled when textarea is empty
 * - Optional field validation (source, estimatedSize, riskLevel, arrays)
 *
 * The Batch Create dialog enables operators to populate the backlog
 * with multiple tasks at once, which is critical for project onboarding
 * and sprint planning workflows.
 *
 * @see T130 — Add Batch Task Import UI to Tasks page
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../../lib/websocket/index.js";
import { BatchCreateDialog, validateJsonInput, validateTaskItem } from "./BatchCreateDialog.js";
import type { Task } from "../../../api/types.js";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A valid JSON array of tasks for testing successful flows. */
const VALID_TASKS_JSON = JSON.stringify(
  [
    {
      repositoryId: "repo-1",
      title: "First task",
      taskType: "feature",
      priority: "high",
    },
    {
      repositoryId: "repo-2",
      title: "Second task",
      taskType: "bug_fix",
      priority: "low",
      description: "Fix the bug",
    },
    {
      repositoryId: "repo-1",
      title: "Third task",
      taskType: "chore",
      priority: "medium",
    },
  ],
  null,
  2,
);

/** Creates minimal Task objects for the batch creation response. */
function makeBatchResponse(): Task[] {
  return [
    {
      id: "task-1",
      repositoryId: "repo-1",
      title: "First task",
      description: null,
      taskType: "feature",
      priority: "high",
      status: "BACKLOG",
      source: "manual",
      externalRef: null,
      severity: null,
      acceptanceCriteria: null,
      definitionOfDone: null,
      estimatedSize: null,
      riskLevel: null,
      requiredCapabilities: null,
      suggestedFileScope: null,
      version: 1,
      createdAt: "2026-03-01T00:00:00Z",
      updatedAt: "2026-03-01T00:00:00Z",
    },
    {
      id: "task-2",
      repositoryId: "repo-2",
      title: "Second task",
      description: "Fix the bug",
      taskType: "bug_fix",
      priority: "low",
      status: "BACKLOG",
      source: "manual",
      externalRef: null,
      severity: null,
      acceptanceCriteria: null,
      definitionOfDone: null,
      estimatedSize: null,
      riskLevel: null,
      requiredCapabilities: null,
      suggestedFileScope: null,
      version: 1,
      createdAt: "2026-03-01T00:00:00Z",
      updatedAt: "2026-03-01T00:00:00Z",
    },
    {
      id: "task-3",
      repositoryId: "repo-1",
      title: "Third task",
      description: null,
      taskType: "chore",
      priority: "medium",
      status: "BACKLOG",
      source: "manual",
      externalRef: null,
      severity: null,
      acceptanceCriteria: null,
      definitionOfDone: null,
      estimatedSize: null,
      riskLevel: null,
      requiredCapabilities: null,
      suggestedFileScope: null,
      version: 1,
      createdAt: "2026-03-01T00:00:00Z",
      updatedAt: "2026-03-01T00:00:00Z",
    },
  ];
}

/**
 * Sets up fetch mock to handle /tasks/batch endpoint.
 * Optionally accepts a custom response for error testing.
 */
function setupFetchRoutes(overrides?: { batchResponse?: Response }) {
  fetchSpy.mockImplementation((input) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/tasks/batch")) {
      return overrides?.batchResponse
        ? Promise.resolve(overrides.batchResponse)
        : Promise.resolve(fakeResponse(makeBatchResponse(), 201));
    }
    return Promise.resolve(fakeResponse({}, 404));
  });
}

/**
 * Renders the BatchCreateDialog wrapped in all required providers.
 * Returns the onOpenChange spy for assertion.
 */
function renderDialog(open = true) {
  const onOpenChange = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={false}>
        <MemoryRouter>
          <BatchCreateDialog open={open} onOpenChange={onOpenChange} />
        </MemoryRouter>
      </WebSocketProvider>
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Unit tests for validation functions
// ---------------------------------------------------------------------------

describe("validateTaskItem", () => {
  /**
   * Validates that a well-formed task object produces no errors.
   * This is the happy-path baseline for the validation function.
   */
  it("returns no errors for a valid task object", () => {
    const errors = validateTaskItem(
      {
        repositoryId: "repo-1",
        title: "Valid task",
        taskType: "feature",
        priority: "high",
      },
      0,
    );
    expect(errors).toEqual([]);
  });

  /**
   * Validates that non-object values are rejected.
   * Prevents runtime crashes from malformed input.
   */
  it("rejects non-object values", () => {
    expect(validateTaskItem("string", 0)).toContainEqual(
      expect.stringContaining("must be an object"),
    );
    expect(validateTaskItem(null, 0)).toContainEqual(expect.stringContaining("must be an object"));
    expect(validateTaskItem(42, 0)).toContainEqual(expect.stringContaining("must be an object"));
    expect(validateTaskItem([1, 2], 0)).toContainEqual(
      expect.stringContaining("must be an object"),
    );
  });

  /**
   * Validates that each required field triggers an error when missing.
   * All four required fields must be independently checked.
   */
  it("reports errors for each missing required field", () => {
    const errors = validateTaskItem({}, 0);
    expect(errors).toContainEqual(expect.stringContaining('"repositoryId"'));
    expect(errors).toContainEqual(expect.stringContaining('"title"'));
    expect(errors).toContainEqual(expect.stringContaining('"taskType"'));
    expect(errors).toContainEqual(expect.stringContaining('"priority"'));
  });

  /**
   * Validates that invalid enum values for taskType are rejected.
   * Prevents submission of tasks with typos in type names.
   */
  it("rejects invalid taskType values", () => {
    const errors = validateTaskItem(
      { repositoryId: "r", title: "t", taskType: "invalid", priority: "high" },
      0,
    );
    expect(errors).toContainEqual(expect.stringContaining('"taskType"'));
  });

  /**
   * Validates that invalid enum values for priority are rejected.
   */
  it("rejects invalid priority values", () => {
    const errors = validateTaskItem(
      { repositoryId: "r", title: "t", taskType: "feature", priority: "urgent" },
      0,
    );
    expect(errors).toContainEqual(expect.stringContaining('"priority"'));
  });

  /**
   * Validates that titles exceeding 500 characters are rejected.
   * Enforces the server-side max length at the client.
   */
  it("rejects titles longer than 500 characters", () => {
    const errors = validateTaskItem(
      { repositoryId: "r", title: "x".repeat(501), taskType: "feature", priority: "high" },
      0,
    );
    expect(errors).toContainEqual(expect.stringContaining("exceeds 500"));
  });

  /**
   * Validates that optional enum fields are checked when present.
   * Invalid optional values should still produce errors.
   */
  it("validates optional enum fields when present", () => {
    const errors = validateTaskItem(
      {
        repositoryId: "r",
        title: "t",
        taskType: "feature",
        priority: "high",
        source: "invalid_source",
        estimatedSize: "xxl",
        riskLevel: "extreme",
      },
      0,
    );
    expect(errors).toContainEqual(expect.stringContaining('"source"'));
    expect(errors).toContainEqual(expect.stringContaining('"estimatedSize"'));
    expect(errors).toContainEqual(expect.stringContaining('"riskLevel"'));
  });

  /**
   * Validates that valid optional fields don't produce errors.
   * Ensures optional field validation doesn't false-positive.
   */
  it("accepts valid optional fields", () => {
    const errors = validateTaskItem(
      {
        repositoryId: "r",
        title: "t",
        taskType: "feature",
        priority: "high",
        source: "manual",
        estimatedSize: "m",
        riskLevel: "low",
        description: "desc",
        acceptanceCriteria: ["criterion 1"],
      },
      0,
    );
    expect(errors).toEqual([]);
  });

  /**
   * Validates that array fields must contain only strings.
   * Prevents non-string values in acceptanceCriteria, etc.
   */
  it("rejects non-string values in array fields", () => {
    const errors = validateTaskItem(
      {
        repositoryId: "r",
        title: "t",
        taskType: "feature",
        priority: "high",
        acceptanceCriteria: [1, 2],
      },
      0,
    );
    expect(errors).toContainEqual(expect.stringContaining('"acceptanceCriteria"'));
  });

  /**
   * Validates that the error label uses 1-based indexing.
   * Ensures error messages are human-readable.
   */
  it("uses 1-based index in error labels", () => {
    const errors = validateTaskItem({}, 2);
    expect(errors[0]).toMatch(/^Task 3:/);
  });
});

describe("validateJsonInput", () => {
  /**
   * Validates that empty input is rejected with a clear message.
   * Operators should see guidance rather than a parse error.
   */
  it("rejects empty input", () => {
    const result = validateJsonInput("");
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("empty"));
  });

  /**
   * Validates that invalid JSON syntax is caught and reported.
   * The most common operator error is malformed JSON.
   */
  it("rejects invalid JSON syntax", () => {
    const result = validateJsonInput("{not valid json}");
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("Invalid JSON"));
  });

  /**
   * Validates that non-array JSON values are rejected.
   * The endpoint expects an array, not a single object.
   */
  it("rejects non-array JSON", () => {
    const result = validateJsonInput('{"title": "single task"}');
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("array"));
  });

  /**
   * Validates that an empty array is rejected.
   * Creating zero tasks is not useful and likely an error.
   */
  it("rejects empty arrays", () => {
    const result = validateJsonInput("[]");
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("empty"));
  });

  /**
   * Validates that a well-formed array of tasks passes validation.
   * This is the primary happy-path test for the validation pipeline.
   */
  it("accepts a valid array of tasks", () => {
    const result = validateJsonInput(VALID_TASKS_JSON);
    expect(result.valid).toBe(true);
    expect(result.tasks).toHaveLength(3);
    expect(result.errors).toEqual([]);
  });

  /**
   * Validates that per-item errors are collected across all items.
   * Multiple bad items should each report their own errors.
   */
  it("collects errors from multiple invalid items", () => {
    const input = JSON.stringify([{ title: "ok" }, { repositoryId: "r" }]);
    const result = validateJsonInput(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.startsWith("Task 1:"))).toBe(true);
    expect(result.errors.some((e) => e.startsWith("Task 2:"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Component tests
// ---------------------------------------------------------------------------

describe("BatchCreateDialog", () => {
  /**
   * Validates that the dialog renders with the expected UI elements.
   * This is the basic smoke test — if these elements are missing,
   * the operator cannot use the batch create feature.
   */
  it("renders dialog with textarea and buttons when open", () => {
    setupFetchRoutes();
    renderDialog();

    expect(screen.getByTestId("batch-create-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("batch-create-dialog-title")).toHaveTextContent("Create Batch");
    expect(screen.getByTestId("batch-json-input")).toBeInTheDocument();
    expect(screen.getByTestId("batch-validate-button")).toBeInTheDocument();
    expect(screen.getByTestId("batch-create-submit")).toBeInTheDocument();
    expect(screen.getByTestId("batch-create-cancel")).toBeInTheDocument();
  });

  /**
   * Validates that the Validate button is disabled when the textarea
   * is empty. Prevents meaningless validation attempts.
   */
  it("disables validate button when textarea is empty", () => {
    setupFetchRoutes();
    renderDialog();

    expect(screen.getByTestId("batch-validate-button")).toBeDisabled();
  });

  /**
   * Validates that the Create button is disabled before validation.
   * Tasks must pass validation before submission is allowed.
   */
  it("disables submit button before validation", () => {
    setupFetchRoutes();
    renderDialog();

    expect(screen.getByTestId("batch-create-submit")).toBeDisabled();
  });

  /**
   * Validates that malformed JSON shows validation errors in the UI.
   * Operators need clear feedback when their JSON has syntax errors.
   */
  it("shows validation errors for malformed JSON", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.change(screen.getByTestId("batch-json-input"), {
      target: { value: "{not valid" },
    });
    fireEvent.click(screen.getByTestId("batch-validate-button"));

    const errorEl = screen.getByTestId("batch-validation-errors");
    expect(errorEl).toBeInTheDocument();
    expect(errorEl).toHaveTextContent("Invalid JSON");
  });

  /**
   * Validates that missing required fields per task are reported.
   * Each item in the array is independently validated.
   */
  it("shows per-item validation errors for missing fields", () => {
    setupFetchRoutes();
    renderDialog();

    const input = JSON.stringify([{ title: "No repo or type" }]);
    fireEvent.change(screen.getByTestId("batch-json-input"), {
      target: { value: input },
    });
    fireEvent.click(screen.getByTestId("batch-validate-button"));

    const errorEl = screen.getByTestId("batch-validation-errors");
    expect(errorEl).toBeInTheDocument();
    expect(errorEl).toHaveTextContent("repositoryId");
    expect(errorEl).toHaveTextContent("taskType");
    expect(errorEl).toHaveTextContent("priority");
  });

  /**
   * Validates the happy path: valid JSON shows success message with
   * task count and enables the Create button.
   */
  it("shows success preview after valid JSON is validated", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.change(screen.getByTestId("batch-json-input"), {
      target: { value: VALID_TASKS_JSON },
    });
    fireEvent.click(screen.getByTestId("batch-validate-button"));

    const successEl = screen.getByTestId("batch-validation-success");
    expect(successEl).toBeInTheDocument();
    expect(successEl).toHaveTextContent("3 tasks ready to create");

    expect(screen.getByTestId("batch-create-submit")).not.toBeDisabled();
  });

  /**
   * Validates that singular "task" is used for a single-item batch.
   * Ensures grammatically correct feedback in the UI.
   */
  it("uses singular form for single task", () => {
    setupFetchRoutes();
    renderDialog();

    const singleTask = JSON.stringify([
      { repositoryId: "r", title: "One task", taskType: "feature", priority: "high" },
    ]);
    fireEvent.change(screen.getByTestId("batch-json-input"), {
      target: { value: singleTask },
    });
    fireEvent.click(screen.getByTestId("batch-validate-button"));

    expect(screen.getByTestId("batch-validation-success")).toHaveTextContent(
      "1 task ready to create",
    );
  });

  /**
   * Validates that editing the textarea clears previous validation.
   * Stale validation results should not persist after input changes.
   */
  it("clears validation when textarea is edited", () => {
    setupFetchRoutes();
    renderDialog();

    // First validate
    fireEvent.change(screen.getByTestId("batch-json-input"), {
      target: { value: VALID_TASKS_JSON },
    });
    fireEvent.click(screen.getByTestId("batch-validate-button"));
    expect(screen.getByTestId("batch-validation-success")).toBeInTheDocument();

    // Edit textarea — validation should clear
    fireEvent.change(screen.getByTestId("batch-json-input"), {
      target: { value: "[" },
    });
    expect(screen.queryByTestId("batch-validation-success")).not.toBeInTheDocument();
    expect(screen.getByTestId("batch-create-submit")).toBeDisabled();
  });

  /**
   * Validates that submitting the batch calls the API with the correct
   * payload and closes the dialog on success. This is the core
   * end-to-end flow for the batch create feature.
   */
  it("submits validated tasks and closes dialog on success", async () => {
    setupFetchRoutes();
    const { onOpenChange } = renderDialog();

    // Paste and validate
    fireEvent.change(screen.getByTestId("batch-json-input"), {
      target: { value: VALID_TASKS_JSON },
    });
    fireEvent.click(screen.getByTestId("batch-validate-button"));

    // Submit
    fireEvent.click(screen.getByTestId("batch-create-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    // Verify the API was called with POST to /tasks/batch
    const batchCall = fetchSpy.mock.calls.find(([url, init]) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      return urlStr.includes("/tasks/batch") && init?.method === "POST";
    });
    expect(batchCall).toBeDefined();

    const body = JSON.parse(batchCall![1]!.body as string);
    expect(body).toHaveLength(3);
    expect(body[0].title).toBe("First task");
    expect(body[1].title).toBe("Second task");
    expect(body[2].title).toBe("Third task");
  });

  /**
   * Validates that API errors are displayed in the dialog.
   * Operators need to see server-side error messages to diagnose
   * issues with their batch payload.
   */
  it("displays error when API call fails", async () => {
    setupFetchRoutes({
      batchResponse: new Response(
        JSON.stringify({
          statusCode: 400,
          error: "Bad Request",
          message: "Repository not found",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    });
    renderDialog();

    // Validate and submit
    fireEvent.change(screen.getByTestId("batch-json-input"), {
      target: { value: VALID_TASKS_JSON },
    });
    fireEvent.click(screen.getByTestId("batch-validate-button"));
    fireEvent.click(screen.getByTestId("batch-create-submit"));

    const errorEl = await screen.findByTestId("batch-create-error");
    expect(errorEl).toBeInTheDocument();
  });

  /**
   * Validates that clicking Cancel closes the dialog via onOpenChange.
   * The operator should always be able to dismiss without side effects.
   */
  it("calls onOpenChange(false) when cancel is clicked", () => {
    setupFetchRoutes();
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByTestId("batch-create-cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /**
   * Validates that non-array JSON input shows the correct error.
   * A common mistake is pasting a single object instead of an array.
   */
  it("shows error for non-array JSON input", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.change(screen.getByTestId("batch-json-input"), {
      target: { value: '{"title": "single object"}' },
    });
    fireEvent.click(screen.getByTestId("batch-validate-button"));

    const errorEl = screen.getByTestId("batch-validation-errors");
    expect(errorEl).toHaveTextContent("array");
  });

  /**
   * Validates that the Create button label includes the task count
   * after validation. Gives operators confidence about what will happen.
   */
  it("shows task count in submit button after validation", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.change(screen.getByTestId("batch-json-input"), {
      target: { value: VALID_TASKS_JSON },
    });
    fireEvent.click(screen.getByTestId("batch-validate-button"));

    expect(screen.getByTestId("batch-create-submit")).toHaveTextContent("Create 3 Tasks");
  });
});
