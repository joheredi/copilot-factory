// @vitest-environment jsdom
/**
 * Tests for the CreateProjectDialog component.
 *
 * Validates that the dialog correctly renders form fields, enforces
 * client-side validation (name and owner required), submits via the
 * useCreateProject mutation, displays API errors, and resets form
 * state on close. Uses the same fetch-spy + QueryClientProvider
 * pattern as CreateTaskDialog tests.
 *
 * @see T125 — Add Create Project dialog
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../../lib/websocket/index.js";
import { CreateProjectDialog } from "./CreateProjectDialog.js";

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

/** Returns a created project payload matching the API shape. */
function makeCreatedProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-new-1",
    name: "My Project",
    description: null,
    owner: "alice",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

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
 * Sets up the fetch mock to respond to the /projects POST endpoint.
 * By default returns a successful 201 response. Override to test error cases.
 */
function setupFetchRoutes(overrides?: { createResponse?: Response }) {
  fetchSpy.mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/projects") && init?.method === "POST") {
      return overrides?.createResponse
        ? Promise.resolve(overrides.createResponse)
        : Promise.resolve(fakeResponse(makeCreatedProject(), 201));
    }

    return Promise.resolve(fakeResponse({}, 404));
  });
}

/** Renders the dialog inside the required provider tree. */
function renderDialog(open = true) {
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
          <CreateProjectDialog open={open} onOpenChange={onOpenChange} />
        </MemoryRouter>
      </WebSocketProvider>
    </QueryClientProvider>,
  );
}

/** Fills the required form fields (name + owner). */
function fillRequiredFields(name = "My Project", owner = "alice") {
  fireEvent.change(screen.getByTestId("create-project-name"), {
    target: { value: name },
  });
  fireEvent.change(screen.getByTestId("create-project-owner"), {
    target: { value: owner },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreateProjectDialog", () => {
  /**
   * Verifies that the dialog renders all expected form fields when opened.
   * This is the baseline rendering test — if this fails, no other tests
   * will pass.
   */
  it("renders all form fields when open", () => {
    setupFetchRoutes();
    renderDialog();

    expect(screen.getByTestId("create-project-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("create-project-dialog-title")).toHaveTextContent("Create Project");
    expect(screen.getByTestId("create-project-name")).toBeInTheDocument();
    expect(screen.getByTestId("create-project-owner")).toBeInTheDocument();
    expect(screen.getByTestId("create-project-description")).toBeInTheDocument();
    expect(screen.getByTestId("create-project-submit")).toBeInTheDocument();
    expect(screen.getByTestId("create-project-cancel")).toBeInTheDocument();
  });

  /**
   * Verifies that the submit button is disabled when no fields are filled.
   * Prevents accidental submission of empty forms.
   */
  it("disables submit button when required fields are empty", () => {
    setupFetchRoutes();
    renderDialog();

    expect(screen.getByTestId("create-project-submit")).toBeDisabled();
  });

  /**
   * Verifies that filling only the name (without owner) keeps submit disabled.
   * Both name and owner are required per the API contract.
   */
  it("keeps submit disabled when only name is filled", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.change(screen.getByTestId("create-project-name"), {
      target: { value: "My Project" },
    });

    expect(screen.getByTestId("create-project-submit")).toBeDisabled();
  });

  /**
   * Verifies that filling only the owner (without name) keeps submit disabled.
   * Both name and owner are required per the API contract.
   */
  it("keeps submit disabled when only owner is filled", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.change(screen.getByTestId("create-project-owner"), {
      target: { value: "alice" },
    });

    expect(screen.getByTestId("create-project-submit")).toBeDisabled();
  });

  /**
   * Verifies that filling both required fields enables the submit button.
   * This is the happy path prerequisite for submission tests.
   */
  it("enables submit when all required fields are filled", () => {
    setupFetchRoutes();
    renderDialog();

    fillRequiredFields();

    expect(screen.getByTestId("create-project-submit")).not.toBeDisabled();
  });

  /**
   * Verifies full form submission workflow: fills fields, clicks submit,
   * checks API payload, and confirms dialog closes on success.
   */
  it("submits form and closes dialog on success", async () => {
    setupFetchRoutes();
    renderDialog();

    fillRequiredFields("Test Project", "bob");
    fireEvent.click(screen.getByTestId("create-project-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    // Verify the POST was sent with the correct payload
    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body).toEqual({ name: "Test Project", owner: "bob" });
  });

  /**
   * Verifies that the optional description field is included in the
   * payload when provided by the user.
   */
  it("includes description in submission when filled", async () => {
    setupFetchRoutes();
    renderDialog();

    fillRequiredFields("My Proj", "alice");
    fireEvent.change(screen.getByTestId("create-project-description"), {
      target: { value: "A great project" },
    });
    fireEvent.click(screen.getByTestId("create-project-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body).toEqual({
      name: "My Proj",
      owner: "alice",
      description: "A great project",
    });
  });

  /**
   * Verifies that empty description is omitted from the payload
   * rather than sent as an empty string.
   */
  it("omits description when textarea is empty", async () => {
    setupFetchRoutes();
    renderDialog();

    fillRequiredFields();
    fireEvent.click(screen.getByTestId("create-project-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body).not.toHaveProperty("description");
  });

  /**
   * Verifies that API errors (e.g. duplicate name, server errors) are
   * displayed to the user instead of silently failing.
   */
  it("displays error message when API call fails", async () => {
    const errorBody = { statusCode: 409, message: 'A project with name "Dup" already exists' };
    setupFetchRoutes({
      createResponse: fakeResponse(errorBody, 409),
    });
    renderDialog();

    fillRequiredFields("Dup", "alice");
    fireEvent.click(screen.getByTestId("create-project-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("create-project-error")).toBeInTheDocument();
    });

    // Dialog should remain open on error
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  /**
   * Verifies that clicking Cancel calls onOpenChange(false) to close
   * the dialog without submitting.
   */
  it("calls onOpenChange(false) when cancel is clicked", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.click(screen.getByTestId("create-project-cancel"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /**
   * Verifies that whitespace-only input is treated as empty for
   * validation purposes. Prevents creating projects with blank names.
   */
  it("treats whitespace-only name as invalid", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.change(screen.getByTestId("create-project-name"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByTestId("create-project-owner"), {
      target: { value: "alice" },
    });

    expect(screen.getByTestId("create-project-submit")).toBeDisabled();
  });

  /**
   * Verifies that whitespace-only owner is treated as empty for
   * validation purposes. Prevents creating projects with blank owners.
   */
  it("treats whitespace-only owner as invalid", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.change(screen.getByTestId("create-project-name"), {
      target: { value: "My Project" },
    });
    fireEvent.change(screen.getByTestId("create-project-owner"), {
      target: { value: "   " },
    });

    expect(screen.getByTestId("create-project-submit")).toBeDisabled();
  });

  /**
   * Verifies that input values are trimmed in the submission payload,
   * preventing leading/trailing whitespace in stored data.
   */
  it("trims whitespace from name and owner before submission", async () => {
    setupFetchRoutes();
    renderDialog();

    fillRequiredFields("  Trimmed Name  ", "  trimmed-owner  ");
    fireEvent.click(screen.getByTestId("create-project-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body.name).toBe("Trimmed Name");
    expect(body.owner).toBe("trimmed-owner");
  });

  /**
   * Verifies that the dialog does not render its content when closed.
   * Radix Dialog unmounts content when open is false.
   */
  it("does not render dialog content when closed", () => {
    setupFetchRoutes();
    renderDialog(false);

    expect(screen.queryByTestId("create-project-dialog")).not.toBeInTheDocument();
  });

  /**
   * Verifies that clearing a previously filled error message happens
   * when the user types into any field. Prevents stale error display.
   */
  it("clears error when user types after an error", async () => {
    const errorBody = { statusCode: 409, message: "Duplicate name" };
    setupFetchRoutes({
      createResponse: fakeResponse(errorBody, 409),
    });
    renderDialog();

    fillRequiredFields("Dup", "alice");
    fireEvent.click(screen.getByTestId("create-project-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("create-project-error")).toBeInTheDocument();
    });

    // Typing into any field should clear the error
    fireEvent.change(screen.getByTestId("create-project-name"), {
      target: { value: "New Name" },
    });

    expect(screen.queryByTestId("create-project-error")).not.toBeInTheDocument();
  });
});
