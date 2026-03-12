// @vitest-environment jsdom
/**
 * Tests for the Configuration Editor page (ConfigPage).
 *
 * Validates the tabbed configuration editor:
 * - Renders page heading and tab navigation
 * - Policies tab: lists policy sets, shows editor on selection
 * - Pools tab: lists pools, shows form on selection
 * - Effective Config tab: shows resolved configuration
 * - JSON editor validates input and formats JSON
 * - Save confirmation dialog appears before persisting
 * - Error and loading states handled gracefully
 *
 * The configuration editor is the operator's primary interface for
 * tuning factory behavior, so regressions here impact system control.
 *
 * @see T099 — Build configuration editor view
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../lib/websocket/index.js";
import ConfigPage from "./page.js";

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

function paginatedResponse<T>(items: T[], total?: number) {
  return {
    data: items,
    meta: { page: 1, limit: items.length || 1, total: total ?? items.length, totalPages: 1 },
  };
}

/** Creates test policy set fixtures. */
function makePolicies() {
  return [
    {
      id: "policy-1",
      name: "Default Policy Set",
      version: 1,
      schedulingPolicyJson: { maxParallel: 5, strategy: "round-robin" },
      reviewPolicyJson: { requiredApprovals: 2 },
      mergePolicyJson: null,
      securityPolicyJson: null,
      validationPolicyJson: { runTests: true },
      budgetPolicyJson: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-15T00:00:00Z",
    },
    {
      id: "policy-2",
      name: "Strict Policy",
      version: 3,
      schedulingPolicyJson: null,
      reviewPolicyJson: { requiredApprovals: 4 },
      mergePolicyJson: { strategy: "rebase" },
      securityPolicyJson: { scanEnabled: true },
      validationPolicyJson: null,
      budgetPolicyJson: { maxTokens: 100000 },
      createdAt: "2026-02-01T00:00:00Z",
      updatedAt: "2026-02-10T00:00:00Z",
    },
  ];
}

/** Creates test worker pool fixtures. */
function makePools() {
  return [
    {
      id: "pool-dev",
      name: "Dev Pool",
      poolType: "developer" as const,
      provider: "copilot",
      runtime: "copilot-cli",
      model: "gpt-4",
      maxConcurrency: 5,
      defaultTimeoutSec: 600,
      defaultTokenBudget: 50000,
      costProfile: null,
      capabilities: ["typescript"],
      repoScopeRules: null,
      enabled: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-15T00:00:00Z",
    },
  ];
}

/** Creates a test effective config fixture. */
function makeEffectiveConfig() {
  return {
    layers: [
      { scheduling: { maxParallel: 5 } },
      { scheduling: { maxParallel: 10 }, review: { requiredApprovals: 2 } },
    ],
    effective: {
      scheduling: { maxParallel: 10 },
      review: { requiredApprovals: 2 },
    },
  };
}

function setupSuccessResponses() {
  const policies = makePolicies();
  const pools = makePools();
  const effectiveConfig = makeEffectiveConfig();

  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/api/policies/policy-")) {
      const id = url.split("/api/policies/")[1];
      const policy = policies.find((p) => p.id === id);
      if (policy) return Promise.resolve(fakeResponse(policy));
      return Promise.resolve(fakeResponse({ message: "Not found" }, 404));
    }
    if (url.includes("/api/policies")) {
      return Promise.resolve(fakeResponse(paginatedResponse(policies)));
    }
    if (url.includes("/api/config/effective")) {
      return Promise.resolve(fakeResponse(effectiveConfig));
    }
    if (url.includes("/api/pools/pool-")) {
      const id = url.split("/api/pools/")[1];
      const pool = pools.find((p) => p.id === id);
      if (pool) return Promise.resolve(fakeResponse(pool));
      return Promise.resolve(fakeResponse({ message: "Not found" }, 404));
    }
    if (url.includes("/api/pools")) {
      return Promise.resolve(fakeResponse(paginatedResponse(pools)));
    }
    return Promise.resolve(fakeResponse(paginatedResponse([], 0)));
  });
}

function setupErrorResponses() {
  fetchSpy.mockImplementation(() => {
    return Promise.resolve(fakeResponse({ message: "Server error" }, 500));
  });
}

function renderConfigPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={false}>
        <MemoryRouter initialEntries={["/config"]}>
          <ConfigPage />
        </MemoryRouter>
      </WebSocketProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Page structure tests
// ---------------------------------------------------------------------------

describe("ConfigPage", () => {
  /**
   * Validates the page heading renders, confirming the component
   * mounts without errors and the correct heading text is shown.
   */
  it("renders the page heading", () => {
    setupSuccessResponses();
    renderConfigPage();
    expect(screen.getByRole("heading", { name: "Configuration", level: 1 })).toBeInTheDocument();
  });

  /**
   * Validates that all three configuration tabs are present.
   * Operators need to navigate between Policies, Pools, and Effective Config.
   */
  it("renders all configuration tabs", () => {
    setupSuccessResponses();
    renderConfigPage();
    expect(screen.getByTestId("tab-policies")).toBeInTheDocument();
    expect(screen.getByTestId("tab-pools")).toBeInTheDocument();
    expect(screen.getByTestId("tab-effective")).toBeInTheDocument();
  });

  /**
   * Validates that the Policies tab is shown by default since it is
   * the most commonly used configuration view.
   */
  it("shows policies tab by default", async () => {
    setupSuccessResponses();
    renderConfigPage();
    // Wait for policy data to load
    expect(await screen.findByText("Default Policy Set")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Policies tab tests
// ---------------------------------------------------------------------------

describe("ConfigPage — Policies tab", () => {
  /**
   * Validates that all policy sets from the API are rendered in the list.
   * This is core acceptance — operators must see all available policies.
   */
  it("lists all policy sets", async () => {
    setupSuccessResponses();
    renderConfigPage();

    expect(await screen.findByText("Default Policy Set")).toBeInTheDocument();
    expect(screen.getByText("Strict Policy")).toBeInTheDocument();
  });

  /**
   * Validates that clicking a policy set shows the editor panel.
   * Without this, operators cannot modify policies.
   */
  it("shows editor when a policy is selected", async () => {
    setupSuccessResponses();
    renderConfigPage();

    const policyCard = await screen.findByTestId("policy-card-policy-1");
    fireEvent.click(policyCard);

    expect(await screen.findByTestId("policy-name-input")).toBeInTheDocument();
  });

  /**
   * Validates that the policy name input displays the selected policy's
   * name, confirming data binding works correctly.
   */
  it("populates editor with selected policy data", async () => {
    setupSuccessResponses();
    renderConfigPage();

    const policyCard = await screen.findByTestId("policy-card-policy-1");
    fireEvent.click(policyCard);

    const nameInput = await screen.findByTestId("policy-name-input");
    expect(nameInput).toHaveValue("Default Policy Set");
  });

  /**
   * Validates that the save button is disabled when no changes have been
   * made, preventing accidental no-op saves.
   */
  it("disables save button when no changes are made", async () => {
    setupSuccessResponses();
    renderConfigPage();

    const policyCard = await screen.findByTestId("policy-card-policy-1");
    fireEvent.click(policyCard);

    const saveBtn = await screen.findByTestId("policy-save-btn");
    expect(saveBtn).toBeDisabled();
  });

  /**
   * Validates that modifying the name enables the save button.
   * This confirms dirty-state tracking works for form changes.
   */
  it("enables save button after a change", async () => {
    setupSuccessResponses();
    renderConfigPage();

    const policyCard = await screen.findByTestId("policy-card-policy-1");
    fireEvent.click(policyCard);

    const nameInput = await screen.findByTestId("policy-name-input");
    fireEvent.change(nameInput, { target: { value: "Updated Policy" } });

    const saveBtn = screen.getByTestId("policy-save-btn");
    expect(saveBtn).not.toBeDisabled();
  });

  /**
   * Validates that the reset button reverts changes to original values.
   * Operators need an easy way to undo accidental edits.
   */
  it("resets changes when reset button is clicked", async () => {
    setupSuccessResponses();
    renderConfigPage();

    const policyCard = await screen.findByTestId("policy-card-policy-1");
    fireEvent.click(policyCard);

    const nameInput = await screen.findByTestId("policy-name-input");
    fireEvent.change(nameInput, { target: { value: "Changed Name" } });
    expect(nameInput).toHaveValue("Changed Name");

    const resetBtn = screen.getByTestId("policy-reset-btn");
    fireEvent.click(resetBtn);

    expect(nameInput).toHaveValue("Default Policy Set");
  });

  /**
   * Validates that clicking save opens the confirmation dialog.
   * This is a key safety feature to prevent accidental config changes.
   */
  it("shows confirmation dialog when save is clicked", async () => {
    setupSuccessResponses();
    renderConfigPage();

    const policyCard = await screen.findByTestId("policy-card-policy-1");
    fireEvent.click(policyCard);

    const nameInput = await screen.findByTestId("policy-name-input");
    fireEvent.change(nameInput, { target: { value: "Updated Policy" } });

    const saveBtn = screen.getByTestId("policy-save-btn");
    fireEvent.click(saveBtn);

    expect(await screen.findByTestId("save-confirmation-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("save-confirm-btn")).toBeInTheDocument();
  });

  /**
   * Validates that loading skeletons appear while policy data is being
   * fetched, providing visual feedback to the operator.
   */
  it("shows loading state while fetching policies", () => {
    fetchSpy.mockImplementation(() => new Promise(() => {})); // never resolves
    renderConfigPage();
    expect(screen.getByTestId("policies-tab-loading")).toBeInTheDocument();
  });

  /**
   * Validates that an error alert is shown when the API fails.
   * Operators need to know when the system is not responding.
   */
  it("shows error state when API fails", async () => {
    setupErrorResponses();
    renderConfigPage();
    expect(await screen.findByTestId("policies-tab-error")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pools tab tests
// ---------------------------------------------------------------------------

describe("ConfigPage — Pools tab", () => {
  /**
   * Validates that switching to the pools tab renders pool data.
   * Operators need to configure pools for worker capacity management.
   */
  it("shows pool list when pools tab is clicked", async () => {
    setupSuccessResponses();
    const user = userEvent.setup();
    renderConfigPage();

    const poolsTab = screen.getByTestId("tab-pools");
    await user.click(poolsTab);

    expect(await screen.findByText("Dev Pool")).toBeInTheDocument();
  });

  /**
   * Validates that clicking a pool shows the configuration form.
   * Without this, pool settings cannot be modified.
   */
  it("shows pool form when a pool is selected", async () => {
    setupSuccessResponses();
    const user = userEvent.setup();
    renderConfigPage();

    await user.click(screen.getByTestId("tab-pools"));
    const poolCard = await screen.findByTestId("pool-config-card-pool-dev");
    await user.click(poolCard);

    expect(await screen.findByTestId("pool-name-input")).toBeInTheDocument();
    expect(screen.getByTestId("pool-concurrency-input")).toBeInTheDocument();
    expect(screen.getByTestId("pool-provider-input")).toBeInTheDocument();
  });

  /**
   * Validates that pool form fields are populated with the pool's data.
   * This confirms the form state correctly syncs with API data.
   */
  it("populates pool form with selected pool data", async () => {
    setupSuccessResponses();
    const user = userEvent.setup();
    renderConfigPage();

    await user.click(screen.getByTestId("tab-pools"));
    const poolCard = await screen.findByTestId("pool-config-card-pool-dev");
    await user.click(poolCard);

    const nameInput = await screen.findByTestId("pool-name-input");
    expect(nameInput).toHaveValue("Dev Pool");

    const concurrencyInput = screen.getByTestId("pool-concurrency-input");
    expect(concurrencyInput).toHaveValue(5);
  });

  /**
   * Validates the enabled/disabled toggle displays correct state.
   * Operators use this to quickly enable/disable pools.
   */
  it("shows correct enabled state in toggle", async () => {
    setupSuccessResponses();
    const user = userEvent.setup();
    renderConfigPage();

    await user.click(screen.getByTestId("tab-pools"));
    const poolCard = await screen.findByTestId("pool-config-card-pool-dev");
    await user.click(poolCard);

    const toggle = await screen.findByTestId("pool-enabled-toggle");
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});

// ---------------------------------------------------------------------------
// Effective Config tab tests
// ---------------------------------------------------------------------------

describe("ConfigPage — Effective Config tab", () => {
  /**
   * Validates that the effective config tab renders resolved config.
   * This is the operator's way to verify what config is actually in use.
   */
  it("shows effective configuration when tab is clicked", async () => {
    setupSuccessResponses();
    const user = userEvent.setup();
    renderConfigPage();

    await user.click(screen.getByTestId("tab-effective"));

    expect(await screen.findByText("Effective Configuration")).toBeInTheDocument();
    expect(screen.getByTestId("effective-config-json")).toBeInTheDocument();
  });

  /**
   * Validates that configuration layers are displayed with their
   * priority labels, helping operators understand the override chain.
   */
  it("shows configuration layers with labels", async () => {
    setupSuccessResponses();
    const user = userEvent.setup();
    renderConfigPage();

    await user.click(screen.getByTestId("tab-effective"));

    expect(await screen.findByText("Configuration Layers")).toBeInTheDocument();
    expect(screen.getByText("2 layers")).toBeInTheDocument();
  });

  /**
   * Validates that error state is shown when effective config API fails.
   * Operators need feedback when diagnostics are unavailable.
   */
  it("shows error when effective config fails to load", async () => {
    setupErrorResponses();
    const user = userEvent.setup();
    renderConfigPage();

    await user.click(screen.getByTestId("tab-effective"));

    expect(await screen.findByTestId("effective-config-error")).toBeInTheDocument();
  });
});
