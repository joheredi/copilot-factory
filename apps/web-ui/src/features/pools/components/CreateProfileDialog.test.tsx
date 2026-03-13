// @vitest-environment jsdom
/**
 * Tests for the CreateProfileDialog component.
 *
 * Validates that the dialog correctly renders all policy ID form fields,
 * submits via the useCreateAgentProfile mutation, omits empty optional
 * fields from the API payload, displays API errors, and resets form state
 * on close. Uses the same fetch-spy + QueryClientProvider pattern
 * established by CreatePoolDialog tests.
 *
 * @see T128 — Add Create Agent Profile dialog to Pool detail
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../../lib/websocket/index.js";
import { CreateProfileDialog } from "./CreateProfileDialog.js";

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

/** Returns a created profile payload matching the API shape. */
function makeCreatedProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-new-1",
    poolId: "pool-123",
    promptTemplateId: null,
    toolPolicyId: null,
    commandPolicyId: null,
    fileScopePolicyId: null,
    validationPolicyId: null,
    reviewPolicyId: null,
    budgetPolicyId: null,
    retryPolicyId: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const POOL_ID = "pool-123";
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
 * Sets up the fetch mock to respond to the profile creation endpoint.
 * By default returns a successful 201 response. Override to test error cases.
 */
function setupFetchRoutes(overrides?: { createResponse?: Response }) {
  fetchSpy.mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes(`/pools/${POOL_ID}/profiles`) && init?.method === "POST") {
      return overrides?.createResponse
        ? Promise.resolve(overrides.createResponse)
        : Promise.resolve(fakeResponse(makeCreatedProfile(), 201));
    }

    // Mock prompt templates list endpoint (returns empty for tests)
    if (url.includes("/prompt-templates")) {
      return Promise.resolve(fakeResponse([]));
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
          <CreateProfileDialog poolId={POOL_ID} open={open} onOpenChange={onOpenChange} />
        </MemoryRouter>
      </WebSocketProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreateProfileDialog", () => {
  /**
   * Verifies that the dialog renders all expected form fields when opened.
   * All 8 policy/template ID fields should be present, along with the
   * title, submit, and cancel buttons. This is the baseline rendering test.
   */
  it("renders all form fields when open", () => {
    setupFetchRoutes();
    renderDialog();

    expect(screen.getByTestId("create-profile-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("create-profile-dialog-title")).toHaveTextContent(
      "Create Agent Profile",
    );
    expect(screen.getByTestId("create-profile-promptTemplateId")).toBeInTheDocument();
    expect(screen.getByTestId("create-profile-toolPolicyId")).toBeInTheDocument();
    expect(screen.getByTestId("create-profile-commandPolicyId")).toBeInTheDocument();
    expect(screen.getByTestId("create-profile-fileScopePolicyId")).toBeInTheDocument();
    expect(screen.getByTestId("create-profile-validationPolicyId")).toBeInTheDocument();
    expect(screen.getByTestId("create-profile-reviewPolicyId")).toBeInTheDocument();
    expect(screen.getByTestId("create-profile-budgetPolicyId")).toBeInTheDocument();
    expect(screen.getByTestId("create-profile-retryPolicyId")).toBeInTheDocument();
    expect(screen.getByTestId("create-profile-submit")).toBeInTheDocument();
    expect(screen.getByTestId("create-profile-cancel")).toBeInTheDocument();
  });

  /**
   * Verifies that the submit button is always enabled since all fields are
   * optional — even an empty profile is a valid creation request. This
   * differs from CreatePoolDialog which requires name and poolType.
   */
  it("has submit button enabled with empty form (all fields optional)", () => {
    setupFetchRoutes();
    renderDialog();

    expect(screen.getByTestId("create-profile-submit")).not.toBeDisabled();
  });

  /**
   * Verifies that submitting with no fields filled creates an empty profile.
   * The API payload should be an empty object (no policy IDs attached).
   */
  it("submits empty profile when no fields are filled", async () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.click(screen.getByTestId("create-profile-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body).toEqual({});
  });

  /**
   * Verifies that filled policy ID fields are included in the submission
   * payload. Only non-empty fields should appear in the API request body.
   */
  it("includes filled policy IDs in submission payload", async () => {
    setupFetchRoutes();
    renderDialog();

    // Note: promptTemplateId is now a Select dropdown (not a text input),
    // so we only test the text input policy fields here.
    fireEvent.change(screen.getByTestId("create-profile-toolPolicyId"), {
      target: { value: "tp-002" },
    });
    fireEvent.change(screen.getByTestId("create-profile-budgetPolicyId"), {
      target: { value: "bp-003" },
    });

    fireEvent.click(screen.getByTestId("create-profile-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body).toEqual({
      toolPolicyId: "tp-002",
      budgetPolicyId: "bp-003",
    });
  });

  /**
   * Verifies that all 8 policy IDs are sent when all fields are filled.
   * This exercises the full form state and ensures every field maps
   * correctly to the API payload.
   */
  it("submits all policy IDs when all fields are filled", async () => {
    setupFetchRoutes();
    renderDialog();

    // Text-input policy fields (promptTemplateId is a Select, tested separately)
    const fieldValues: Record<string, string> = {
      toolPolicyId: "tp-002",
      commandPolicyId: "cp-003",
      fileScopePolicyId: "fs-004",
      validationPolicyId: "vp-005",
      reviewPolicyId: "rp-006",
      budgetPolicyId: "bp-007",
      retryPolicyId: "rt-008",
    };

    for (const [key, value] of Object.entries(fieldValues)) {
      fireEvent.change(screen.getByTestId(`create-profile-${key}`), {
        target: { value },
      });
    }

    fireEvent.click(screen.getByTestId("create-profile-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body).toEqual(fieldValues);
  });

  /**
   * Verifies that whitespace-only field values are treated as empty and
   * omitted from the payload. Prevents sending blank IDs to the API.
   */
  it("omits whitespace-only fields from submission payload", async () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.change(screen.getByTestId("create-profile-promptTemplateId"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByTestId("create-profile-toolPolicyId"), {
      target: { value: "tp-valid" },
    });

    fireEvent.click(screen.getByTestId("create-profile-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body).toEqual({ toolPolicyId: "tp-valid" });
    expect(body).not.toHaveProperty("promptTemplateId");
  });

  /**
   * Verifies that API errors are displayed in the dialog and do not close it.
   * Important for UX — users need to see what went wrong and can retry.
   */
  it("displays API error and keeps dialog open on failure", async () => {
    setupFetchRoutes({
      createResponse: fakeResponse({ message: "Invalid policy ID" }, 400),
    });
    renderDialog();

    fireEvent.change(screen.getByTestId("create-profile-toolPolicyId"), {
      target: { value: "bad-id" },
    });

    fireEvent.click(screen.getByTestId("create-profile-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("create-profile-error")).toBeInTheDocument();
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

    fireEvent.click(screen.getByTestId("create-profile-cancel"));

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
    fireEvent.change(screen.getByTestId("create-profile-toolPolicyId"), {
      target: { value: "tp-stale" },
    });

    // Close the dialog
    fireEvent.click(screen.getByTestId("create-profile-cancel"));

    // Unmount and re-render to simulate reopening
    unmount();
    renderDialog();

    // Field should be reset
    expect(screen.getByTestId("create-profile-toolPolicyId")).toHaveValue("");
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

    fireEvent.click(screen.getByTestId("create-profile-submit"));

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByTestId("create-profile-error")).toBeInTheDocument();
    });

    // Type in a text input field to clear error
    fireEvent.change(screen.getByTestId("create-profile-toolPolicyId"), {
      target: { value: "tp-retry" },
    });

    expect(screen.queryByTestId("create-profile-error")).not.toBeInTheDocument();
  });

  /**
   * Verifies that the dialog does not render content when closed (open=false).
   * This ensures the dialog is not part of the DOM when not needed.
   */
  it("does not render when open is false", () => {
    setupFetchRoutes();
    renderDialog(false);

    expect(screen.queryByTestId("create-profile-dialog")).not.toBeInTheDocument();
  });

  /**
   * Verifies that the POST is sent to the correct pool-scoped URL.
   * The profile must be created under the specific pool's endpoint.
   */
  it("sends POST to correct pool-scoped endpoint", async () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.click(screen.getByTestId("create-profile-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const postCall = fetchSpy.mock.calls.find(([, init]) => {
      return init && typeof init === "object" && init.method === "POST";
    });
    expect(postCall).toBeDefined();
    const url = typeof postCall![0] === "string" ? postCall![0] : postCall![0].toString();
    expect(url).toContain(`/pools/${POOL_ID}/profiles`);
  });
});
