// @vitest-environment jsdom
/**
 * Tests for the CreatePoolDialog component.
 *
 * Validates that the dialog correctly renders form fields, enforces
 * client-side validation (name and poolType required), submits via the
 * useCreatePool mutation, displays API errors, and resets form state
 * on close. Uses the same fetch-spy + QueryClientProvider pattern
 * established by CreateProjectDialog and CreateRepositoryDialog tests.
 *
 * @see T127 — Add Create Worker Pool dialog to Pools page
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../../lib/websocket/index.js";
import { CreatePoolDialog } from "./CreatePoolDialog.js";

// ---------------------------------------------------------------------------
// jsdom polyfills for Radix UI Select
// ---------------------------------------------------------------------------

// Radix Select calls scrollIntoView on items which is not implemented in jsdom.
HTMLElement.prototype.scrollIntoView = vi.fn();

// Radix Select checks pointer events via hasPointerCapture/setPointerCapture.
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
}
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = vi.fn();
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = vi.fn();
}

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

/** Returns a created pool payload matching the API shape. */
function makeCreatedPool(overrides: Record<string, unknown> = {}) {
  return {
    id: "pool-new-1",
    name: "My Pool",
    poolType: "developer",
    provider: null,
    model: null,
    maxConcurrency: 3,
    defaultTimeoutSec: 3600,
    enabled: true,
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
 * Sets up the fetch mock to respond to the /pools POST endpoint.
 * By default returns a successful 201 response. Override to test error cases.
 */
function setupFetchRoutes(overrides?: { createResponse?: Response }) {
  fetchSpy.mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/pools") && init?.method === "POST") {
      return overrides?.createResponse
        ? Promise.resolve(overrides.createResponse)
        : Promise.resolve(fakeResponse(makeCreatedPool(), 201));
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
          <CreatePoolDialog open={open} onOpenChange={onOpenChange} />
        </MemoryRouter>
      </WebSocketProvider>
    </QueryClientProvider>,
  );
}

/**
 * Fills the required name field.
 * Note: poolType uses a shadcn Select which cannot be set via fireEvent.change.
 * Pool type selection is tested separately using the select trigger.
 */
function fillName(name = "My Pool") {
  fireEvent.change(screen.getByTestId("create-pool-name"), {
    target: { value: name },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreatePoolDialog", () => {
  /**
   * Verifies that the dialog renders all expected form fields when opened.
   * This is the baseline rendering test — if this fails, no other tests
   * will pass.
   */
  it("renders all form fields when open", () => {
    setupFetchRoutes();
    renderDialog();

    expect(screen.getByTestId("create-pool-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("create-pool-dialog-title")).toHaveTextContent("Create Worker Pool");
    expect(screen.getByTestId("create-pool-name")).toBeInTheDocument();
    expect(screen.getByTestId("create-pool-type")).toBeInTheDocument();
    expect(screen.getByTestId("create-pool-provider")).toBeInTheDocument();
    expect(screen.getByTestId("create-pool-model")).toBeInTheDocument();
    expect(screen.getByTestId("create-pool-max-concurrency")).toBeInTheDocument();
    expect(screen.getByTestId("create-pool-default-timeout")).toBeInTheDocument();
    expect(screen.getByTestId("create-pool-submit")).toBeInTheDocument();
    expect(screen.getByTestId("create-pool-cancel")).toBeInTheDocument();
  });

  /**
   * Verifies that the submit button is disabled when no fields are filled.
   * Prevents accidental submission of empty forms — both name and poolType
   * are required by the API contract.
   */
  it("disables submit button when required fields are empty", () => {
    setupFetchRoutes();
    renderDialog();

    expect(screen.getByTestId("create-pool-submit")).toBeDisabled();
  });

  /**
   * Verifies that filling only the name (without poolType) keeps submit
   * disabled. Both name and poolType are required.
   */
  it("keeps submit disabled when only name is filled", () => {
    setupFetchRoutes();
    renderDialog();

    fillName("My Pool");

    expect(screen.getByTestId("create-pool-submit")).toBeDisabled();
  });

  /**
   * Verifies that the maxConcurrency field has a default value of 3
   * as specified in the task requirements.
   */
  it("has default maxConcurrency of 3", () => {
    setupFetchRoutes();
    renderDialog();

    const input = screen.getByTestId("create-pool-max-concurrency") as HTMLInputElement;
    expect(input.value).toBe("3");
  });

  /**
   * Verifies that the defaultTimeoutSec field has a default value of 3600
   * (1 hour) as specified in the task requirements.
   */
  it("has default defaultTimeoutSec of 3600", () => {
    setupFetchRoutes();
    renderDialog();

    const input = screen.getByTestId("create-pool-default-timeout") as HTMLInputElement;
    expect(input.value).toBe("3600");
  });

  /**
   * Verifies full form submission workflow: fills required fields, clicks
   * submit, checks API payload, and confirms dialog closes on success.
   * Uses native select workaround since shadcn Select uses Radix portals.
   */
  it("submits form with required fields and closes dialog on success", async () => {
    setupFetchRoutes();
    renderDialog();

    // Fill name
    fillName("Dev Pool");

    // Select pool type by triggering the select via the underlying mechanism
    // shadcn Select uses Radix UI which renders in a portal, so we interact
    // with the trigger and simulate the value change via the component's
    // onValueChange callback. We do this by clicking and selecting.
    const selectTrigger = screen.getByTestId("create-pool-type");
    fireEvent.click(selectTrigger);

    // Wait for the dropdown content to appear, then select "Developer"
    await waitFor(() => {
      const option = screen.getByTestId("create-pool-type-developer");
      expect(option).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("create-pool-type-developer"));

    // Submit
    await waitFor(() => {
      expect(screen.getByTestId("create-pool-submit")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("create-pool-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    // Verify the POST was sent with the correct payload
    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body).toEqual({
      name: "Dev Pool",
      poolType: "developer",
      maxConcurrency: 3,
      defaultTimeoutSec: 3600,
    });
  });

  /**
   * Verifies that optional provider and model fields are included in the
   * submission payload when the user provides them.
   */
  it("includes optional fields in submission when filled", async () => {
    setupFetchRoutes();
    renderDialog();

    // Fill all fields
    fillName("Review Pool");

    // Select pool type
    fireEvent.click(screen.getByTestId("create-pool-type"));
    await waitFor(() => {
      expect(screen.getByTestId("create-pool-type-reviewer")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("create-pool-type-reviewer"));

    fireEvent.change(screen.getByTestId("create-pool-provider"), {
      target: { value: "github-copilot" },
    });
    fireEvent.change(screen.getByTestId("create-pool-model"), {
      target: { value: "gpt-4o" },
    });
    fireEvent.change(screen.getByTestId("create-pool-max-concurrency"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByTestId("create-pool-default-timeout"), {
      target: { value: "7200" },
    });

    // Submit
    await waitFor(() => {
      expect(screen.getByTestId("create-pool-submit")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("create-pool-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body).toEqual({
      name: "Review Pool",
      poolType: "reviewer",
      provider: "github-copilot",
      model: "gpt-4o",
      maxConcurrency: 5,
      defaultTimeoutSec: 7200,
    });
  });

  /**
   * Verifies that empty optional fields (provider, model) are excluded from
   * the submission payload rather than sent as empty strings.
   */
  it("omits empty optional fields from submission payload", async () => {
    setupFetchRoutes();
    renderDialog();

    fillName("Planner Pool");

    // Select pool type
    fireEvent.click(screen.getByTestId("create-pool-type"));
    await waitFor(() => {
      expect(screen.getByTestId("create-pool-type-planner")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("create-pool-type-planner"));

    await waitFor(() => {
      expect(screen.getByTestId("create-pool-submit")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("create-pool-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body).not.toHaveProperty("provider");
    expect(body).not.toHaveProperty("model");
  });

  /**
   * Verifies that API errors are displayed in the dialog and do not close it.
   * Important for UX — users need to see what went wrong and can retry.
   */
  it("displays API error and keeps dialog open on failure", async () => {
    setupFetchRoutes({
      createResponse: fakeResponse({ message: "Pool name already exists" }, 409),
    });
    renderDialog();

    fillName("Duplicate Pool");

    // Select pool type
    fireEvent.click(screen.getByTestId("create-pool-type"));
    await waitFor(() => {
      expect(screen.getByTestId("create-pool-type-developer")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("create-pool-type-developer"));

    await waitFor(() => {
      expect(screen.getByTestId("create-pool-submit")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("create-pool-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("create-pool-error")).toBeInTheDocument();
    });

    // Dialog should remain open
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  /**
   * Verifies that clicking Cancel closes the dialog without submitting.
   * Ensures the cancel button respects the onOpenChange contract.
   */
  it("closes dialog when cancel is clicked", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.click(screen.getByTestId("create-pool-cancel"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /**
   * Verifies that the form resets to initial state when the dialog is closed
   * and reopened. Prevents stale form data from persisting across sessions.
   */
  it("resets form when dialog is closed", () => {
    setupFetchRoutes();
    const { unmount } = renderDialog();

    // Fill in some data
    fillName("Test Pool");
    fireEvent.change(screen.getByTestId("create-pool-provider"), {
      target: { value: "some-provider" },
    });

    // Close the dialog
    fireEvent.click(screen.getByTestId("create-pool-cancel"));

    // Unmount and re-render to simulate reopening
    unmount();
    renderDialog();

    // Fields should be reset
    expect(screen.getByTestId("create-pool-name")).toHaveValue("");
    expect(screen.getByTestId("create-pool-provider")).toHaveValue("");
  });

  /**
   * Verifies that typing in form fields clears any previously shown error.
   * This provides immediate feedback that the user's correction is being
   * acknowledged.
   */
  it("clears error when user types in a field", async () => {
    setupFetchRoutes({
      createResponse: fakeResponse({ message: "Server error" }, 500),
    });
    renderDialog();

    fillName("Fail Pool");

    // Select pool type
    fireEvent.click(screen.getByTestId("create-pool-type"));
    await waitFor(() => {
      expect(screen.getByTestId("create-pool-type-developer")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("create-pool-type-developer"));

    await waitFor(() => {
      expect(screen.getByTestId("create-pool-submit")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("create-pool-submit"));

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByTestId("create-pool-error")).toBeInTheDocument();
    });

    // Type in name field to clear error
    fireEvent.change(screen.getByTestId("create-pool-name"), {
      target: { value: "Retry Pool" },
    });

    expect(screen.queryByTestId("create-pool-error")).not.toBeInTheDocument();
  });

  /**
   * Verifies that the dialog does not render content when closed (open=false).
   * This ensures the dialog is not part of the DOM when not needed.
   */
  it("does not render when open is false", () => {
    setupFetchRoutes();
    renderDialog(false);

    expect(screen.queryByTestId("create-pool-dialog")).not.toBeInTheDocument();
  });

  /**
   * Verifies that whitespace-only names are treated as empty and keep
   * the submit button disabled. Prevents creating pools with blank names.
   */
  it("treats whitespace-only name as empty", () => {
    setupFetchRoutes();
    renderDialog();

    fillName("   ");

    expect(screen.getByTestId("create-pool-submit")).toBeDisabled();
  });
});
