// @vitest-environment jsdom
/**
 * Tests for the CreateRepositoryDialog component.
 *
 * Validates that the dialog correctly renders form fields, enforces
 * client-side validation (name required, remoteUrl required + URL format),
 * applies correct defaults (defaultBranch: "main", localCheckoutStrategy:
 * "worktree"), submits via the useCreateRepository mutation, displays
 * API errors, and resets form state on close.
 *
 * Uses the same fetch-spy + QueryClientProvider pattern as CreateProjectDialog
 * and CreateTaskDialog tests.
 *
 * @see T126 — Add Create Repository dialog to Project detail
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../../lib/websocket/index.js";
import { CreateRepositoryDialog } from "./CreateRepositoryDialog.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal Response object for the fetch spy. */
function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Returns a created repository payload matching the API shape. */
function makeCreatedRepository(overrides: Record<string, unknown> = {}) {
  return {
    id: "repo-new-1",
    projectId: "proj-1",
    name: "my-repo",
    remoteUrl: "https://github.com/org/my-repo.git",
    defaultBranch: "main",
    localCheckoutStrategy: "worktree",
    credentialProfileId: null,
    status: "active",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_PROJECT_ID = "proj-1";
const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const onOpenChange = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  onOpenChange.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Sets up the fetch mock to respond to the repositories POST endpoint.
 * By default returns a successful 201 response. Override to test error cases.
 */
function setupFetchRoutes(overrides?: { createResponse?: Response }) {
  fetchSpy.mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/repositories") && init?.method === "POST") {
      return overrides?.createResponse
        ? Promise.resolve(overrides.createResponse)
        : Promise.resolve(fakeResponse(makeCreatedRepository(), 201));
    }

    return Promise.resolve(fakeResponse({}, 404));
  });
}

/** Renders the dialog inside the required provider tree. */
function renderDialog(open = true, projectId = TEST_PROJECT_ID) {
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
          <CreateRepositoryDialog open={open} onOpenChange={onOpenChange} projectId={projectId} />
        </MemoryRouter>
      </WebSocketProvider>
    </QueryClientProvider>,
  );
}

/** Fills the required form fields (name + remoteUrl). */
function fillRequiredFields(name = "my-repo", remoteUrl = "https://github.com/org/my-repo.git") {
  fireEvent.change(screen.getByTestId("create-repository-name"), {
    target: { value: name },
  });
  fireEvent.change(screen.getByTestId("create-repository-remote-url"), {
    target: { value: remoteUrl },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreateRepositoryDialog", () => {
  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /**
   * Verifies that the dialog renders all expected form fields when opened.
   * This is the baseline rendering test — if this fails, no other tests
   * will pass.
   */
  it("renders all form fields when open", () => {
    setupFetchRoutes();
    renderDialog();

    expect(screen.getByTestId("create-repository-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("create-repository-dialog-title")).toHaveTextContent(
      "Add Repository",
    );
    expect(screen.getByTestId("create-repository-name")).toBeInTheDocument();
    expect(screen.getByTestId("create-repository-remote-url")).toBeInTheDocument();
    expect(screen.getByTestId("create-repository-default-branch")).toBeInTheDocument();
    expect(screen.getByTestId("create-repository-checkout-strategy")).toBeInTheDocument();
    expect(screen.getByTestId("create-repository-submit")).toBeInTheDocument();
    expect(screen.getByTestId("create-repository-cancel")).toBeInTheDocument();
  });

  /**
   * Verifies that the dialog does not render its content when closed.
   * Radix Dialog unmounts content when open is false.
   */
  it("does not render dialog content when closed", () => {
    setupFetchRoutes();
    renderDialog(false);

    expect(screen.queryByTestId("create-repository-dialog")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Default values
  // -------------------------------------------------------------------------

  /**
   * Verifies that defaultBranch is pre-populated with "main".
   * Per the task spec, this field should default to "main" so operators
   * don't have to type it for the common case.
   */
  it("defaults defaultBranch to 'main'", () => {
    setupFetchRoutes();
    renderDialog();

    expect(screen.getByTestId("create-repository-default-branch")).toHaveValue("main");
  });

  /**
   * Verifies that localCheckoutStrategy defaults to "worktree".
   * Per the acceptance criteria, worktree is the default strategy.
   */
  it("defaults localCheckoutStrategy to 'worktree'", () => {
    setupFetchRoutes();
    renderDialog();

    const trigger = screen.getByTestId("create-repository-checkout-strategy");
    expect(trigger).toHaveTextContent("Worktree");
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Verifies that the submit button is disabled when no fields are filled.
   * Prevents accidental submission of empty forms.
   */
  it("disables submit button when required fields are empty", () => {
    setupFetchRoutes();
    renderDialog();

    expect(screen.getByTestId("create-repository-submit")).toBeDisabled();
  });

  /**
   * Verifies that filling only the name (without remoteUrl) keeps submit
   * disabled. Both name and a valid remoteUrl are required.
   */
  it("keeps submit disabled when only name is filled", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.change(screen.getByTestId("create-repository-name"), {
      target: { value: "my-repo" },
    });

    expect(screen.getByTestId("create-repository-submit")).toBeDisabled();
  });

  /**
   * Verifies that filling only the remoteUrl (without name) keeps submit
   * disabled. Both name and remoteUrl are required.
   */
  it("keeps submit disabled when only remoteUrl is filled", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.change(screen.getByTestId("create-repository-remote-url"), {
      target: { value: "https://github.com/org/repo.git" },
    });

    expect(screen.getByTestId("create-repository-submit")).toBeDisabled();
  });

  /**
   * Verifies that an invalid URL in remoteUrl keeps submit disabled and
   * shows a validation hint. Catches malformed URLs before submission.
   */
  it("keeps submit disabled when remoteUrl is not a valid URL", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.change(screen.getByTestId("create-repository-name"), {
      target: { value: "my-repo" },
    });
    fireEvent.change(screen.getByTestId("create-repository-remote-url"), {
      target: { value: "not-a-url" },
    });

    expect(screen.getByTestId("create-repository-submit")).toBeDisabled();
    expect(screen.getByTestId("create-repository-url-error")).toHaveTextContent(
      "Please enter a valid URL",
    );
  });

  /**
   * Verifies that filling both required fields with valid values enables
   * the submit button. This is the happy path prerequisite for submission.
   */
  it("enables submit when all required fields are valid", () => {
    setupFetchRoutes();
    renderDialog();

    fillRequiredFields();

    expect(screen.getByTestId("create-repository-submit")).not.toBeDisabled();
  });

  /**
   * Verifies that whitespace-only name is treated as empty for validation.
   * Prevents creating repositories with blank names.
   */
  it("treats whitespace-only name as invalid", () => {
    setupFetchRoutes();
    renderDialog();

    fillRequiredFields("   ", "https://github.com/org/repo.git");

    expect(screen.getByTestId("create-repository-submit")).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------

  /**
   * Verifies the full submission workflow with default values: fills required
   * fields, clicks submit, checks API payload includes defaults for
   * defaultBranch and localCheckoutStrategy, and confirms dialog closes.
   */
  it("submits form with defaults and closes dialog on success", async () => {
    setupFetchRoutes();
    renderDialog();

    fillRequiredFields("test-repo", "https://github.com/org/test-repo.git");
    fireEvent.click(screen.getByTestId("create-repository-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    // Verify the POST was sent to the correct project-scoped endpoint
    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    expect(postCall).toBeDefined();

    const url = typeof postCall![0] === "string" ? postCall![0] : postCall![0].toString();
    expect(url).toContain(`/projects/${TEST_PROJECT_ID}/repositories`);

    const body = JSON.parse(postCall![1]!.body as string);
    expect(body).toEqual({
      name: "test-repo",
      remoteUrl: "https://github.com/org/test-repo.git",
      defaultBranch: "main",
      localCheckoutStrategy: "worktree",
    });
  });

  /**
   * Verifies that a custom defaultBranch value is submitted instead of
   * the default "main". Operators may use "master" or other conventions.
   */
  it("submits custom defaultBranch when changed", async () => {
    setupFetchRoutes();
    renderDialog();

    fillRequiredFields("repo", "https://github.com/org/repo.git");
    fireEvent.change(screen.getByTestId("create-repository-default-branch"), {
      target: { value: "develop" },
    });
    fireEvent.click(screen.getByTestId("create-repository-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body.defaultBranch).toBe("develop");
  });

  /**
   * Verifies that when defaultBranch is cleared by the user, the
   * submission falls back to "main". This ensures the API always
   * receives a valid branch name.
   */
  it("falls back to 'main' when defaultBranch is cleared", async () => {
    setupFetchRoutes();
    renderDialog();

    fillRequiredFields("repo", "https://github.com/org/repo.git");
    fireEvent.change(screen.getByTestId("create-repository-default-branch"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("create-repository-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body.defaultBranch).toBe("main");
  });

  /**
   * Verifies that input values are trimmed in the submission payload,
   * preventing leading/trailing whitespace in stored data.
   */
  it("trims whitespace from name and remoteUrl before submission", async () => {
    setupFetchRoutes();
    renderDialog();

    fillRequiredFields("  trimmed-repo  ", "  https://github.com/org/repo.git  ");
    fireEvent.click(screen.getByTestId("create-repository-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body.name).toBe("trimmed-repo");
    expect(body.remoteUrl).toBe("https://github.com/org/repo.git");
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  /**
   * Verifies that API errors (e.g. duplicate name, server errors) are
   * displayed to the user instead of silently failing. The dialog must
   * remain open so the user can correct the issue and retry.
   */
  it("displays error message when API call fails", async () => {
    const errorBody = {
      statusCode: 409,
      message: 'A repository with name "dup-repo" already exists',
    };
    setupFetchRoutes({
      createResponse: fakeResponse(errorBody, 409),
    });
    renderDialog();

    fillRequiredFields("dup-repo", "https://github.com/org/dup-repo.git");
    fireEvent.click(screen.getByTestId("create-repository-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("create-repository-error")).toBeInTheDocument();
    });

    // Dialog should remain open on error
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  /**
   * Verifies that clearing a previously displayed error message happens
   * when the user types into any field. Prevents stale error display.
   */
  it("clears error when user types after an error", async () => {
    const errorBody = { statusCode: 409, message: "Duplicate name" };
    setupFetchRoutes({
      createResponse: fakeResponse(errorBody, 409),
    });
    renderDialog();

    fillRequiredFields("dup", "https://github.com/org/dup.git");
    fireEvent.click(screen.getByTestId("create-repository-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("create-repository-error")).toBeInTheDocument();
    });

    // Typing into any field should clear the error
    fireEvent.change(screen.getByTestId("create-repository-name"), {
      target: { value: "new-name" },
    });

    expect(screen.queryByTestId("create-repository-error")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Cancel / close
  // -------------------------------------------------------------------------

  /**
   * Verifies that clicking Cancel calls onOpenChange(false) to close
   * the dialog without submitting.
   */
  it("calls onOpenChange(false) when cancel is clicked", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.click(screen.getByTestId("create-repository-cancel"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /**
   * Verifies that the URL validation hint disappears when the user
   * corrects the URL to a valid one. Provides real-time feedback.
   */
  it("removes URL validation hint when URL becomes valid", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.change(screen.getByTestId("create-repository-remote-url"), {
      target: { value: "not-a-url" },
    });

    expect(screen.getByTestId("create-repository-url-error")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("create-repository-remote-url"), {
      target: { value: "https://github.com/org/repo.git" },
    });

    expect(screen.queryByTestId("create-repository-url-error")).not.toBeInTheDocument();
  });
});
