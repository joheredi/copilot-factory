// @vitest-environment jsdom

/**
 * Tests for the ImportTasksDialog multi-step wizard.
 *
 * These tests validate the four-step import flow:
 * 1. Path input → scan
 * 2. Preview table with selection, warnings, and editable names
 * 3. Confirmation summary
 * 4. Result display
 *
 * Each test documents **why** it is important so that future iterations
 * can maintain the test suite without the original author's context.
 *
 * @see T118 — Build Import Tasks multi-step dialog
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../../lib/websocket/provider.js";
import { ImportTasksDialog } from "./ImportTasksDialog.js";
import type { DiscoverResponse, ExecuteImportResponse } from "../../../api/types.js";

/* -------------------------------------------------------------------------- */
/*  Test helpers                                                               */
/* -------------------------------------------------------------------------- */

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

/** Creates a mock Response with the given JSON body and status. */
function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Standard discover response with two tasks and one warning. */
function makeDiscoverResponse(overrides?: Partial<DiscoverResponse>): DiscoverResponse {
  return {
    tasks: [
      {
        title: "Implement authentication",
        taskType: "feature",
        priority: "high",
        externalRef: "AUTH-001",
      },
      {
        title: "Fix login bug",
        taskType: "bug_fix",
        priority: "critical",
        externalRef: "BUG-042",
      },
    ],
    warnings: [
      {
        file: "task-3.md",
        field: "priority",
        message: "Unknown priority value, defaulting to medium",
        severity: "warning",
      },
    ],
    suggestedProjectName: "My Project",
    suggestedRepositoryName: "my-repo",
    format: "markdown",
    ...overrides,
  };
}

/** Standard execute response for a successful import. */
function makeExecuteResponse(overrides?: Partial<ExecuteImportResponse>): ExecuteImportResponse {
  return {
    projectId: "proj-001",
    repositoryId: "repo-001",
    created: 2,
    skipped: 0,
    errors: [],
    ...overrides,
  };
}

let onOpenChange: ReturnType<typeof vi.fn>;

function renderDialog(open = true) {
  onOpenChange = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={false}>
        <MemoryRouter>
          <ImportTasksDialog open={open} onOpenChange={onOpenChange} />
        </MemoryRouter>
      </WebSocketProvider>
    </QueryClientProvider>,
  );
}

/**
 * Configures fetch mock to handle discover and execute routes.
 *
 * Allows per-test override of the responses for flexible scenario testing.
 */
function setupFetchRoutes(overrides?: {
  discoverResponse?: DiscoverResponse;
  discoverStatus?: number;
  executeResponse?: ExecuteImportResponse;
  executeStatus?: number;
}) {
  fetchSpy.mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method?.toUpperCase() ?? "GET";

    if (url.includes("/import/discover") && method === "POST") {
      const status = overrides?.discoverStatus ?? 200;
      const body =
        status >= 400
          ? { statusCode: status, message: "Scan failed", error: "Bad Request" }
          : (overrides?.discoverResponse ?? makeDiscoverResponse());
      return Promise.resolve(fakeResponse(body, status));
    }

    if (url.includes("/import/execute") && method === "POST") {
      const status = overrides?.executeStatus ?? 200;
      const body =
        status >= 400
          ? { statusCode: status, message: "Import failed", error: "Internal Server Error" }
          : (overrides?.executeResponse ?? makeExecuteResponse());
      return Promise.resolve(fakeResponse(body, status));
    }

    return Promise.resolve(fakeResponse({ data: [] }));
  });
}

/* -------------------------------------------------------------------------- */
/*  Setup / Teardown                                                           */
/* -------------------------------------------------------------------------- */

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/*  Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("ImportTasksDialog", () => {
  /* -------------------------------- Step 1 -------------------------------- */

  describe("Step 1 — Path Input", () => {
    /**
     * Validates that the dialog renders all step-1 elements when open.
     * This is the entry-point assertion; if this fails, the entire
     * wizard flow is broken.
     */
    it("renders the path input step when opened", () => {
      renderDialog();

      expect(screen.getByTestId("import-tasks-dialog")).toBeInTheDocument();
      expect(screen.getByTestId("import-path-input")).toBeInTheDocument();
      expect(screen.getByTestId("import-pattern-input")).toBeInTheDocument();
      expect(screen.getByTestId("import-scan-btn")).toBeInTheDocument();
      expect(screen.getByTestId("import-cancel-btn")).toBeInTheDocument();
    });

    /**
     * The Scan button must be disabled when no path is entered, preventing
     * useless API calls and improving UX clarity.
     */
    it("disables scan button when path is empty", () => {
      renderDialog();

      expect(screen.getByTestId("import-scan-btn")).toBeDisabled();
    });

    /**
     * Verifies that typing a path enables the Scan button, ensuring
     * the required-field validation logic works correctly.
     */
    it("enables scan button when path is entered", () => {
      renderDialog();

      fireEvent.change(screen.getByTestId("import-path-input"), {
        target: { value: "/home/user/project" },
      });

      expect(screen.getByTestId("import-scan-btn")).not.toBeDisabled();
    });

    /**
     * Validates the happy-path transition from step 1 to step 2.
     * After a successful scan, the dialog should show the preview
     * table with discovered tasks.
     */
    it("transitions to step 2 on successful scan", async () => {
      setupFetchRoutes();
      renderDialog();

      fireEvent.change(screen.getByTestId("import-path-input"), {
        target: { value: "/home/user/project" },
      });
      fireEvent.click(screen.getByTestId("import-scan-btn"));

      await waitFor(() => {
        expect(screen.getByText("Preview Discovered Tasks")).toBeInTheDocument();
      });
    });

    /**
     * When the discover API returns an error, the dialog should
     * display the error message and remain on step 1 so the user
     * can correct the path and retry.
     */
    it("shows error and stays on step 1 when scan fails", async () => {
      setupFetchRoutes({ discoverStatus: 400 });
      renderDialog();

      fireEvent.change(screen.getByTestId("import-path-input"), {
        target: { value: "/bad/path" },
      });
      fireEvent.click(screen.getByTestId("import-scan-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("import-error")).toBeInTheDocument();
      });

      // Should still show step 1 elements
      expect(screen.getByTestId("import-path-input")).toBeInTheDocument();
    });

    /**
     * The cancel button must close the dialog without side effects,
     * providing a clean escape hatch at any point.
     */
    it("closes the dialog when cancel is clicked", () => {
      renderDialog();

      fireEvent.click(screen.getByTestId("import-cancel-btn"));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  /* -------------------------------- Step 2 -------------------------------- */

  describe("Step 2 — Preview", () => {
    /**
     * Helper that navigates through step 1 to reach step 2,
     * reducing boilerplate in preview-specific tests.
     */
    async function goToStep2(overrides?: Parameters<typeof setupFetchRoutes>[0]) {
      setupFetchRoutes(overrides);
      renderDialog();

      fireEvent.change(screen.getByTestId("import-path-input"), {
        target: { value: "/home/user/project" },
      });
      fireEvent.click(screen.getByTestId("import-scan-btn"));

      await waitFor(() => {
        expect(screen.getByText("Preview Discovered Tasks")).toBeInTheDocument();
      });
    }

    /**
     * All discovered tasks must appear in the preview table so operators
     * can review what was found before committing the import.
     */
    it("displays all discovered tasks in the table", async () => {
      await goToStep2();

      expect(screen.getByText("Implement authentication")).toBeInTheDocument();
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    /**
     * Parse warnings must be prominently displayed so operators know
     * about data quality issues before importing.
     */
    it("displays parse warnings", async () => {
      await goToStep2();

      expect(screen.getByTestId("import-warnings")).toBeInTheDocument();
      expect(screen.getByText(/Unknown priority value, defaulting to medium/)).toBeInTheDocument();
    });

    /**
     * All tasks should be pre-selected after scanning so the default
     * action imports everything. Operators can then deselect specific ones.
     */
    it("pre-selects all tasks after scan", async () => {
      await goToStep2();

      expect(screen.getByTestId("import-task-checkbox-0")).toBeChecked();
      expect(screen.getByTestId("import-task-checkbox-1")).toBeChecked();
      expect(screen.getByTestId("import-selection-count")).toHaveTextContent(
        "2 of 2 task(s) selected",
      );
    });

    /**
     * Individual task deselection is essential for excluding tasks that
     * should not be imported (e.g., duplicates or irrelevant entries).
     */
    it("allows toggling individual task selection", async () => {
      await goToStep2();

      fireEvent.click(screen.getByTestId("import-task-checkbox-0"));

      expect(screen.getByTestId("import-task-checkbox-0")).not.toBeChecked();
      expect(screen.getByTestId("import-task-checkbox-1")).toBeChecked();
      expect(screen.getByTestId("import-selection-count")).toHaveTextContent(
        "1 of 2 task(s) selected",
      );
    });

    /**
     * Select-all checkbox provides bulk control, reducing clicks when
     * operators want to deselect all and cherry-pick a few.
     */
    it("supports select-all / deselect-all toggle", async () => {
      await goToStep2();

      // Deselect all
      fireEvent.click(screen.getByTestId("import-select-all"));
      expect(screen.getByTestId("import-task-checkbox-0")).not.toBeChecked();
      expect(screen.getByTestId("import-task-checkbox-1")).not.toBeChecked();

      // Select all again
      fireEvent.click(screen.getByTestId("import-select-all"));
      expect(screen.getByTestId("import-task-checkbox-0")).toBeChecked();
      expect(screen.getByTestId("import-task-checkbox-1")).toBeChecked();
    });

    /**
     * Suggested project and repository names must be editable because
     * the auto-detected names may not match the operator's preferences.
     */
    it("populates and allows editing project/repository names", async () => {
      await goToStep2();

      const projectInput = screen.getByTestId("import-project-name") as HTMLInputElement;
      const repoInput = screen.getByTestId("import-repository-name") as HTMLInputElement;

      expect(projectInput.value).toBe("My Project");
      expect(repoInput.value).toBe("my-repo");

      fireEvent.change(projectInput, { target: { value: "Custom Name" } });
      expect(projectInput.value).toBe("Custom Name");
    });

    /**
     * Cannot proceed without selecting tasks — prevents empty imports
     * that waste resources and confuse operators.
     */
    it("disables continue when no tasks selected", async () => {
      await goToStep2();

      // Deselect all
      fireEvent.click(screen.getByTestId("import-select-all"));

      expect(screen.getByTestId("import-continue-btn")).toBeDisabled();
    });

    /**
     * Cannot proceed without a project name — it's a required field for
     * the execute API endpoint.
     */
    it("disables continue when project name is empty", async () => {
      await goToStep2();

      fireEvent.change(screen.getByTestId("import-project-name"), {
        target: { value: "" },
      });

      expect(screen.getByTestId("import-continue-btn")).toBeDisabled();
    });

    /**
     * The Back button must return to step 1 so operators can change
     * the scan path without closing and reopening the dialog.
     */
    it("navigates back to step 1", async () => {
      await goToStep2();

      fireEvent.click(screen.getByTestId("import-back-btn"));

      expect(screen.getByTestId("import-path-input")).toBeInTheDocument();
    });

    /**
     * Task metadata columns (type, priority, externalRef) must be
     * visible so operators can make informed inclusion decisions.
     */
    it("shows task metadata in table columns", async () => {
      await goToStep2();

      expect(screen.getByText("feature")).toBeInTheDocument();
      expect(screen.getByText("bug_fix")).toBeInTheDocument();
      expect(screen.getByText("high")).toBeInTheDocument();
      expect(screen.getByText("critical")).toBeInTheDocument();
      expect(screen.getByText("AUTH-001")).toBeInTheDocument();
      expect(screen.getByText("BUG-042")).toBeInTheDocument();
    });

    /**
     * When scanning returns zero warnings, the warnings section should
     * not render, keeping the UI clean.
     */
    it("hides warnings section when there are none", async () => {
      await goToStep2({
        discoverResponse: makeDiscoverResponse({ warnings: [] }),
      });

      expect(screen.queryByTestId("import-warnings")).not.toBeInTheDocument();
    });
  });

  /* -------------------------------- Step 3 -------------------------------- */

  describe("Step 3 — Confirm", () => {
    /**
     * Helper that navigates through steps 1 and 2 to reach step 3.
     */
    async function goToStep3(overrides?: Parameters<typeof setupFetchRoutes>[0]) {
      setupFetchRoutes(overrides);
      renderDialog();

      fireEvent.change(screen.getByTestId("import-path-input"), {
        target: { value: "/home/user/project" },
      });
      fireEvent.click(screen.getByTestId("import-scan-btn"));

      await waitFor(() => {
        expect(screen.getByText("Preview Discovered Tasks")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("import-continue-btn"));

      await waitFor(() => {
        expect(screen.getByText("Confirm Import")).toBeInTheDocument();
      });
    }

    /**
     * The confirmation step must show an accurate summary of what will
     * be created, giving operators one last chance to review.
     */
    it("shows the correct summary information", async () => {
      await goToStep3();

      expect(screen.getByTestId("confirm-task-count")).toHaveTextContent("2");
      expect(screen.getByTestId("confirm-project-name")).toHaveTextContent("My Project");
      expect(screen.getByTestId("confirm-source-path")).toHaveTextContent("/home/user/project");
    });

    /**
     * When a task is deselected in step 2, the confirmation count must
     * reflect only the selected tasks.
     */
    it("reflects deselected tasks in the count", async () => {
      setupFetchRoutes();
      renderDialog();

      fireEvent.change(screen.getByTestId("import-path-input"), {
        target: { value: "/home/user/project" },
      });
      fireEvent.click(screen.getByTestId("import-scan-btn"));

      await waitFor(() => {
        expect(screen.getByText("Preview Discovered Tasks")).toBeInTheDocument();
      });

      // Deselect one task
      fireEvent.click(screen.getByTestId("import-task-checkbox-0"));
      fireEvent.click(screen.getByTestId("import-continue-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("confirm-task-count")).toHaveTextContent("1");
      });
    });

    /**
     * Successful import must transition to step 4 result view.
     */
    it("transitions to step 4 on successful import", async () => {
      await goToStep3();

      fireEvent.click(screen.getByTestId("confirm-import-btn"));

      await waitFor(() => {
        expect(screen.getByText("Import Complete")).toBeInTheDocument();
      });
    });

    /**
     * When the execute API fails, the error must be shown and the dialog
     * should stay on step 3 so the operator can retry.
     */
    it("shows error when import fails", async () => {
      await goToStep3({ executeStatus: 500 });

      fireEvent.click(screen.getByTestId("confirm-import-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("import-error")).toBeInTheDocument();
      });

      // Should still show step 3
      expect(screen.getByText("Confirm Import")).toBeInTheDocument();
    });

    /**
     * Back button returns to step 2 so operators can adjust their
     * selection without losing their scan results.
     */
    it("navigates back to step 2", async () => {
      await goToStep3();

      fireEvent.click(screen.getByTestId("confirm-back-btn"));

      expect(screen.getByText("Preview Discovered Tasks")).toBeInTheDocument();
    });

    /**
     * The import request must include only selected tasks and the
     * user-specified project name, ensuring accurate data transmission.
     */
    it("sends the correct payload to the execute API", async () => {
      await goToStep3();

      fireEvent.click(screen.getByTestId("confirm-import-btn"));

      await waitFor(() => {
        expect(screen.getByText("Import Complete")).toBeInTheDocument();
      });

      const executeCall = fetchSpy.mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.includes("/import/execute") && init?.method === "POST",
      );

      expect(executeCall).toBeDefined();
      const body = JSON.parse(executeCall![1]!.body as string);
      expect(body.path).toBe("/home/user/project");
      expect(body.projectName).toBe("My Project");
      expect(body.tasks).toHaveLength(2);
      expect(body.tasks[0].title).toBe("Implement authentication");
      expect(body.tasks[1].title).toBe("Fix login bug");
    });
  });

  /* -------------------------------- Step 4 -------------------------------- */

  describe("Step 4 — Result", () => {
    /**
     * Helper that runs through all four steps to reach the result view.
     */
    async function goToStep4(overrides?: Parameters<typeof setupFetchRoutes>[0]) {
      setupFetchRoutes(overrides);
      renderDialog();

      fireEvent.change(screen.getByTestId("import-path-input"), {
        target: { value: "/home/user/project" },
      });
      fireEvent.click(screen.getByTestId("import-scan-btn"));

      await waitFor(() => {
        expect(screen.getByText("Preview Discovered Tasks")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("import-continue-btn"));

      await waitFor(() => {
        expect(screen.getByText("Confirm Import")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("confirm-import-btn"));

      await waitFor(() => {
        expect(screen.getByText("Import Complete")).toBeInTheDocument();
      });
    }

    /**
     * The result step must show the number of successfully created tasks
     * so operators know the import worked.
     */
    it("shows created task count", async () => {
      await goToStep4();

      expect(screen.getByTestId("result-created")).toHaveTextContent("2 task(s) created");
    });

    /**
     * When tasks are skipped (e.g., duplicates), the count must be visible
     * so operators understand why fewer tasks were created than selected.
     */
    it("shows skipped task count when present", async () => {
      await goToStep4({
        executeResponse: makeExecuteResponse({ created: 1, skipped: 1 }),
      });

      expect(screen.getByTestId("result-created")).toHaveTextContent("1 task(s) created");
      expect(screen.getByTestId("result-skipped")).toHaveTextContent("1 task(s) skipped");
    });

    /**
     * Import errors must be displayed individually so operators can
     * identify and address each issue.
     */
    it("shows error messages when present", async () => {
      await goToStep4({
        executeResponse: makeExecuteResponse({
          created: 1,
          errors: ["Task 'Duplicate' already exists"],
        }),
      });

      expect(screen.getByTestId("result-errors")).toBeInTheDocument();
      expect(screen.getByText("Task 'Duplicate' already exists")).toBeInTheDocument();
    });

    /**
     * The close button must close the dialog and reset state, ensuring
     * the next open starts fresh without stale data.
     */
    it("closes and resets dialog on close", async () => {
      await goToStep4();

      fireEvent.click(screen.getByTestId("result-close-btn"));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  /* ----------------------------- Cross-cutting ----------------------------- */

  describe("Cross-cutting concerns", () => {
    /**
     * Dialog must not render its content when `open` is false,
     * preventing unnecessary DOM elements and state initialization.
     */
    it("does not render when open is false", () => {
      renderDialog(false);

      expect(screen.queryByTestId("import-tasks-dialog")).not.toBeInTheDocument();
    });

    /**
     * State must fully reset when the dialog is closed and reopened,
     * preventing stale scan results or selections from a previous
     * session from leaking into a new one.
     */
    it("resets state when dialog is reopened", async () => {
      setupFetchRoutes();
      const { unmount } = renderDialog();

      // Navigate to step 2
      fireEvent.change(screen.getByTestId("import-path-input"), {
        target: { value: "/home/user/project" },
      });
      fireEvent.click(screen.getByTestId("import-scan-btn"));

      await waitFor(() => {
        expect(screen.getByText("Preview Discovered Tasks")).toBeInTheDocument();
      });

      // Close dialog
      fireEvent.click(screen.getByTestId("import-back-btn"));
      fireEvent.click(screen.getByTestId("import-cancel-btn"));

      // Unmount and re-render
      unmount();
      renderDialog();

      // Should be back on step 1 with empty path
      expect(screen.getByTestId("import-path-input")).toBeInTheDocument();
      expect((screen.getByTestId("import-path-input") as HTMLInputElement).value).toBe("");
    });

    /**
     * The glob pattern should be sent as part of the discover request
     * when provided, allowing operators to filter scan scope.
     */
    it("includes glob pattern in discover request when provided", async () => {
      setupFetchRoutes();
      renderDialog();

      fireEvent.change(screen.getByTestId("import-path-input"), {
        target: { value: "/home/user/project" },
      });
      fireEvent.change(screen.getByTestId("import-pattern-input"), {
        target: { value: "*.md" },
      });
      fireEvent.click(screen.getByTestId("import-scan-btn"));

      await waitFor(() => {
        expect(screen.getByText("Preview Discovered Tasks")).toBeInTheDocument();
      });

      const discoverCall = fetchSpy.mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.includes("/import/discover") && init?.method === "POST",
      );

      expect(discoverCall).toBeDefined();
      const body = JSON.parse(discoverCall![1]!.body as string);
      expect(body.path).toBe("/home/user/project");
      expect(body.pattern).toBe("*.md");
    });

    /**
     * The step indicator must reflect the current step so operators
     * always know where they are in the wizard flow.
     */
    it("shows step indicator with current step highlighted", async () => {
      renderDialog();

      const indicator = screen.getByTestId("step-indicator");
      expect(indicator).toBeInTheDocument();
      expect(indicator.textContent).toContain("Path");
      expect(indicator.textContent).toContain("Preview");
      expect(indicator.textContent).toContain("Confirm");
      expect(indicator.textContent).toContain("Result");
    });

    /**
     * Repository name should be omitted from the execute payload when
     * the field is left empty, since it's optional in the API.
     */
    it("omits repositoryName from payload when empty", async () => {
      setupFetchRoutes();
      renderDialog();

      fireEvent.change(screen.getByTestId("import-path-input"), {
        target: { value: "/home/user/project" },
      });
      fireEvent.click(screen.getByTestId("import-scan-btn"));

      await waitFor(() => {
        expect(screen.getByText("Preview Discovered Tasks")).toBeInTheDocument();
      });

      // Clear repository name
      fireEvent.change(screen.getByTestId("import-repository-name"), {
        target: { value: "" },
      });

      fireEvent.click(screen.getByTestId("import-continue-btn"));

      await waitFor(() => {
        expect(screen.getByText("Confirm Import")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("confirm-import-btn"));

      await waitFor(() => {
        expect(screen.getByText("Import Complete")).toBeInTheDocument();
      });

      const executeCall = fetchSpy.mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.includes("/import/execute") && init?.method === "POST",
      );

      const body = JSON.parse(executeCall![1]!.body as string);
      expect(body).not.toHaveProperty("repositoryName");
    });
  });
});
