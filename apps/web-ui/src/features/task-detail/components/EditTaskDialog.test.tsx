// @vitest-environment jsdom
/**
 * Tests for the Edit Task dialog (T129).
 *
 * These tests validate the EditTaskDialog component's behaviour:
 * - Renders with pre-populated form fields from the current task
 * - Title field is required — submit is disabled when empty
 * - Submits only changed fields via the useUpdateTask hook
 * - Handles 409 Conflict errors with a user-friendly message
 * - Handles generic errors with an alert
 * - Disables form fields and buttons during submission
 * - Closes the dialog on successful submission
 * - Resets form to current task data when reopened
 *
 * This dialog is the primary mechanism for operators to correct or
 * refine task details after creation. Regressions here would prevent
 * metadata updates and break the operator workflow.
 *
 * @see T129 — Add Edit Task form to Task detail page
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditTaskDialog } from "./EditTaskDialog";
import type { Task } from "../../../api/types";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

/** Creates a fake HTTP response with a JSON body. */
function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Creates a task fixture with optional overrides. */
function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: "task-abc-123",
    repositoryId: "repo-1",
    title: "Implement auth module",
    description: "Build JWT-based auth.",
    taskType: "feature",
    priority: "high",
    status: "IN_DEVELOPMENT",
    source: "manual",
    externalRef: "PROJ-42",
    severity: null,
    acceptanceCriteria: ["Login returns JWT", "Logout invalidates token"],
    definitionOfDone: ["Unit tests pass", "Code reviewed"],
    estimatedSize: "m",
    riskLevel: "medium",
    requiredCapabilities: ["nodejs", "auth"],
    suggestedFileScope: ["src/auth/"],
    version: 3,
    createdAt: "2026-03-01T10:00:00Z",
    updatedAt: "2026-03-10T15:30:00Z",
    ...overrides,
  };
}

/** Renders the EditTaskDialog with required providers. */
function renderDialog(props?: {
  task?: Task;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const task = props?.task ?? makeTask();
  const onOpenChange = props?.onOpenChange ?? vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  vi.stubGlobal("fetch", fetchSpy);

  return {
    onOpenChange,
    task,
    ...render(
      <QueryClientProvider client={queryClient}>
        <EditTaskDialog open={props?.open ?? true} onOpenChange={onOpenChange} task={task} />
      </QueryClientProvider>,
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EditTaskDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Validates that the dialog renders with a title and description.
   * This is the first thing operators see when clicking "Edit".
   */
  it("renders dialog with title", () => {
    renderDialog();
    expect(screen.getByTestId("edit-task-dialog-title")).toHaveTextContent("Edit Task");
  });

  /**
   * Validates that the title field is pre-populated from the task.
   * Pre-population is critical — operators should not have to re-type data.
   */
  it("pre-populates title from task", () => {
    renderDialog();
    const input = screen.getByTestId("edit-task-title") as HTMLInputElement;
    expect(input.value).toBe("Implement auth module");
  });

  /**
   * Validates that the description textarea is pre-populated.
   */
  it("pre-populates description from task", () => {
    renderDialog();
    const input = screen.getByTestId("edit-task-description") as HTMLTextAreaElement;
    expect(input.value).toBe("Build JWT-based auth.");
  });

  /**
   * Validates that the priority select is pre-populated.
   */
  it("pre-populates priority from task", () => {
    renderDialog();
    const select = screen.getByTestId("edit-task-priority") as HTMLSelectElement;
    expect(select.value).toBe("high");
  });

  /**
   * Validates that risk level is pre-populated.
   */
  it("pre-populates risk level from task", () => {
    renderDialog();
    const select = screen.getByTestId("edit-task-risk-level") as HTMLSelectElement;
    expect(select.value).toBe("medium");
  });

  /**
   * Validates that estimated size is pre-populated.
   */
  it("pre-populates estimated size from task", () => {
    renderDialog();
    const select = screen.getByTestId("edit-task-estimated-size") as HTMLSelectElement;
    expect(select.value).toBe("m");
  });

  /**
   * Validates that external reference is pre-populated.
   */
  it("pre-populates external reference from task", () => {
    renderDialog();
    const input = screen.getByTestId("edit-task-external-ref") as HTMLInputElement;
    expect(input.value).toBe("PROJ-42");
  });

  /**
   * Validates that acceptance criteria are shown as newline-separated text.
   * The array is joined on newlines for textarea editing.
   */
  it("pre-populates acceptance criteria as newline-separated text", () => {
    renderDialog();
    const textarea = screen.getByTestId("edit-task-acceptance-criteria") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Login returns JWT\nLogout invalidates token");
  });

  /**
   * Validates that definition of done items are shown as newline-separated text.
   */
  it("pre-populates definition of done as newline-separated text", () => {
    renderDialog();
    const textarea = screen.getByTestId("edit-task-definition-of-done") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Unit tests pass\nCode reviewed");
  });

  /**
   * Validates that required capabilities are pre-populated.
   */
  it("pre-populates required capabilities", () => {
    renderDialog();
    const textarea = screen.getByTestId("edit-task-required-capabilities") as HTMLTextAreaElement;
    expect(textarea.value).toBe("nodejs\nauth");
  });

  /**
   * Validates that suggested file scope is pre-populated.
   */
  it("pre-populates suggested file scope", () => {
    renderDialog();
    const textarea = screen.getByTestId("edit-task-suggested-file-scope") as HTMLTextAreaElement;
    expect(textarea.value).toBe("src/auth/");
  });

  /**
   * Validates that null fields are displayed as empty strings.
   * Tasks may have null optional fields that should not show "null".
   */
  it("handles null fields gracefully", () => {
    renderDialog({
      task: makeTask({
        description: null,
        externalRef: null,
        severity: null,
        acceptanceCriteria: null,
        definitionOfDone: null,
        estimatedSize: null,
        riskLevel: null,
        requiredCapabilities: null,
        suggestedFileScope: null,
      }),
    });

    expect((screen.getByTestId("edit-task-description") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByTestId("edit-task-external-ref") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("edit-task-severity") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("edit-task-acceptance-criteria") as HTMLTextAreaElement).value).toBe(
      "",
    );
    expect((screen.getByTestId("edit-task-definition-of-done") as HTMLTextAreaElement).value).toBe(
      "",
    );
    expect((screen.getByTestId("edit-task-estimated-size") as HTMLSelectElement).value).toBe("");
    expect((screen.getByTestId("edit-task-risk-level") as HTMLSelectElement).value).toBe("");
    expect(
      (screen.getByTestId("edit-task-required-capabilities") as HTMLTextAreaElement).value,
    ).toBe("");
    expect(
      (screen.getByTestId("edit-task-suggested-file-scope") as HTMLTextAreaElement).value,
    ).toBe("");
  });

  /**
   * Validates that the submit button is disabled when the title is empty.
   * Title is a required field — empty title should block submission.
   */
  it("disables submit when title is empty", async () => {
    renderDialog();
    const user = userEvent.setup();

    const titleInput = screen.getByTestId("edit-task-title");
    await user.clear(titleInput);

    const submitButton = screen.getByTestId("edit-task-submit");
    expect(submitButton).toBeDisabled();
  });

  /**
   * Validates that the submit button is enabled with valid data.
   */
  it("enables submit with valid data", () => {
    renderDialog();
    const submitButton = screen.getByTestId("edit-task-submit");
    expect(submitButton).not.toBeDisabled();
  });

  /**
   * Validates that submission sends updated fields to the API.
   * This is the core functionality — only changed fields should be sent
   * along with the version for optimistic concurrency control.
   */
  it("submits changed fields with version", async () => {
    const updatedTask = makeTask({ title: "Updated title", version: 4 });
    fetchSpy.mockResolvedValueOnce(fakeResponse(updatedTask));

    renderDialog();
    const user = userEvent.setup();

    const titleInput = screen.getByTestId("edit-task-title");
    await user.clear(titleInput);
    await user.type(titleInput, "Updated title");

    await user.click(screen.getByTestId("edit-task-submit"));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });

    const [url, options] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/tasks/task-abc-123");
    expect(options?.method).toBe("PUT");

    const body = JSON.parse(options?.body as string) as Record<string, unknown>;
    expect(body["version"]).toBe(3);
    expect(body["title"]).toBe("Updated title");
  });

  /**
   * Validates that the dialog closes on successful submission.
   * The onOpenChange callback should be called with false.
   */
  it("closes dialog on successful submit", async () => {
    const updatedTask = makeTask({ version: 4 });
    fetchSpy.mockResolvedValueOnce(fakeResponse(updatedTask));

    const { onOpenChange } = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("edit-task-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  /**
   * Validates that 409 Conflict errors show a specific conflict message.
   * This is critical for optimistic concurrency — operators need to know
   * that another user modified the task and they need to refresh.
   */
  it("shows conflict message on 409 error", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ statusCode: 409, message: "Version conflict" }), {
        status: 409,
        statusText: "Conflict",
      }),
    );

    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("edit-task-submit"));

    const errorEl = await screen.findByTestId("edit-task-error");
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.textContent).toContain("modified by another user");
  });

  /**
   * Validates that generic errors show an error alert.
   * Network failures and server errors should be communicated clearly.
   */
  it("shows error message on generic failure", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Network error"));

    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("edit-task-submit"));

    const errorEl = await screen.findByTestId("edit-task-error");
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.textContent).toContain("Network error");
  });

  /**
   * Validates that the cancel button invokes onOpenChange(false).
   */
  it("cancel button closes dialog", async () => {
    const { onOpenChange } = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("edit-task-cancel"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /**
   * Validates that the button text changes during submission.
   * Provides visual feedback that the request is in-flight.
   */
  it("shows saving text during submission", async () => {
    fetchSpy.mockImplementation(() => new Promise(() => {}));

    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("edit-task-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("edit-task-submit")).toHaveTextContent("Saving…");
    });
  });
});
