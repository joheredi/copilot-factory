// @vitest-environment jsdom
/**
 * Tests for the Worker Pools list page (PoolsPage).
 *
 * Validates the pool monitoring list view:
 * - Renders pool cards with correct names and metadata
 * - Shows loading skeletons while data is in-flight
 * - Displays error alert when the API fails
 * - Handles empty state gracefully
 * - Filter controls toggle pool type and enabled status
 *
 * This page is the operator's primary view for monitoring worker
 * capacity, so regressions here impact operational visibility.
 *
 * @see T096 — Build worker pool monitoring panel
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../lib/websocket/index.js";
import PoolsPage from "./PoolsPage.js";

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
    items,
    page: 1,
    limit: items.length || 1,
    total: total ?? items.length,
    hasMore: false,
  };
}

/** Shared pool fixtures used across tests. */
function makePools() {
  return [
    {
      id: "pool-dev-1",
      name: "Dev Pool Alpha",
      poolType: "developer" as const,
      provider: "copilot",
      runtime: "copilot-cli",
      model: "gpt-4",
      maxConcurrency: 5,
      defaultTimeoutSec: 600,
      defaultTokenBudget: 50000,
      costProfile: null,
      capabilities: ["typescript", "react"],
      repoScopeRules: null,
      enabled: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-15T00:00:00Z",
    },
    {
      id: "pool-rev-1",
      name: "Review Pool",
      poolType: "reviewer" as const,
      provider: "openai",
      runtime: null,
      model: "claude-3-opus",
      maxConcurrency: 3,
      defaultTimeoutSec: null,
      defaultTokenBudget: null,
      costProfile: "standard",
      capabilities: null,
      repoScopeRules: null,
      enabled: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-10T00:00:00Z",
    },
    {
      id: "pool-disabled",
      name: "Disabled Pool",
      poolType: "developer" as const,
      provider: null,
      runtime: null,
      model: null,
      maxConcurrency: 2,
      defaultTimeoutSec: null,
      defaultTokenBudget: null,
      costProfile: null,
      capabilities: null,
      repoScopeRules: null,
      enabled: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];
}

function setupSuccessResponses(pools = makePools()) {
  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/pools")) {
      return Promise.resolve(fakeResponse(paginatedResponse(pools, pools.length)));
    }
    return Promise.resolve(fakeResponse(paginatedResponse([], 0)));
  });
}

function renderPoolsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={false}>
        <MemoryRouter initialEntries={["/workers"]}>
          <PoolsPage />
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
// Tests
// ---------------------------------------------------------------------------

describe("PoolsPage", () => {
  /**
   * Basic smoke test — validates the page heading renders.
   * Confirms the component mounts without errors.
   */
  it("renders the page heading", () => {
    setupSuccessResponses();
    renderPoolsPage();
    expect(screen.getByRole("heading", { name: "Worker Pools", level: 1 })).toBeInTheDocument();
  });

  /**
   * Validates that all pool cards render with correct names after data loads.
   * This is the core acceptance criterion — operators must see all pools.
   */
  it("renders pool cards with pool names", async () => {
    setupSuccessResponses();
    renderPoolsPage();

    expect(await screen.findByText("Dev Pool Alpha")).toBeInTheDocument();
    expect(screen.getByText("Review Pool")).toBeInTheDocument();
    expect(screen.getByText("Disabled Pool")).toBeInTheDocument();
  });

  /**
   * Validates that the pool count is displayed accurately.
   * Operators use this to confirm they're seeing all pools.
   */
  it("shows pool count", async () => {
    setupSuccessResponses();
    renderPoolsPage();

    const countEl = await screen.findByTestId("pool-count");
    expect(countEl).toHaveTextContent("3 pools");
  });

  /**
   * Validates that pool cards show the max concurrency metric.
   * Concurrency is a key capacity indicator for operators.
   */
  it("shows max concurrency on pool cards", async () => {
    setupSuccessResponses();
    renderPoolsPage();

    const concurrency = await screen.findByTestId("pool-concurrency-pool-dev-1");
    expect(concurrency).toHaveTextContent("5");
  });

  /**
   * Validates pool type badges render correctly.
   * Operators use type badges to visually distinguish pool roles.
   */
  it("shows pool type badges", async () => {
    setupSuccessResponses();
    renderPoolsPage();

    // Two developer pools + one reviewer pool
    const devBadges = await screen.findAllByTestId("pool-type-developer");
    expect(devBadges).toHaveLength(2);

    const revBadges = screen.getAllByTestId("pool-type-reviewer");
    expect(revBadges).toHaveLength(1);
  });

  /**
   * Validates enabled/disabled status badges render correctly.
   * This is essential for operators to identify paused pools.
   */
  it("shows pool status badges", async () => {
    setupSuccessResponses();
    renderPoolsPage();

    // Two enabled pools + one disabled
    const enabledBadges = await screen.findAllByTestId("pool-status-enabled");
    expect(enabledBadges).toHaveLength(2);

    const disabledBadges = screen.getAllByTestId("pool-status-disabled");
    expect(disabledBadges).toHaveLength(1);
  });

  /**
   * Validates provider/model info is shown on pool cards.
   * Operators use this to identify which AI provider backs each pool.
   */
  it("shows provider and model info when available", async () => {
    setupSuccessResponses();
    renderPoolsPage();

    const providerInfo = await screen.findByTestId("pool-provider-pool-dev-1");
    expect(providerInfo).toHaveTextContent("copilot / gpt-4");
  });

  /**
   * Validates loading skeletons appear before data arrives.
   * Prevents layout shift and communicates loading state to operators.
   */
  it("shows loading skeleton while data loads", () => {
    fetchSpy.mockImplementation(() => new Promise(() => {}));
    renderPoolsPage();

    expect(screen.getByTestId("pools-skeleton")).toBeInTheDocument();
  });

  /**
   * Validates the error alert when the API fails.
   * Critical for operator awareness of connectivity issues.
   */
  it("shows error alert when API fails", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response("Internal Server Error", { status: 500 })),
    );
    renderPoolsPage();

    const errorAlert = await screen.findByTestId("pools-error");
    expect(errorAlert).toHaveTextContent("Unable to load pools");
  });

  /**
   * Validates the empty state when no pools exist.
   * Ensures graceful degradation on a fresh system.
   */
  it("shows empty state when no pools exist", async () => {
    setupSuccessResponses([]);
    renderPoolsPage();

    const emptyMsg = await screen.findByTestId("pools-empty");
    expect(emptyMsg).toHaveTextContent("No pools found");
  });

  /**
   * Validates pool cards link to the detail page.
   * Navigation is essential for the list → detail drill-down pattern.
   */
  it("pool cards link to detail page", async () => {
    setupSuccessResponses();
    renderPoolsPage();

    const card = await screen.findByTestId("pool-card-pool-dev-1");
    expect(card).toHaveAttribute("href", "/workers/pool-dev-1");
  });

  /**
   * Validates the filter toggle button shows/hides filters.
   * This keeps the default view clean while allowing filtering on demand.
   */
  it("toggles filter visibility", async () => {
    setupSuccessResponses();
    renderPoolsPage();

    // Filters start hidden
    expect(screen.queryByTestId("pool-filters")).not.toBeInTheDocument();

    // Show filters
    fireEvent.click(screen.getByTestId("toggle-filters"));
    expect(screen.getByTestId("pool-filters")).toBeInTheDocument();

    // Hide filters
    fireEvent.click(screen.getByTestId("toggle-filters"));
    expect(screen.queryByTestId("pool-filters")).not.toBeInTheDocument();
  });
});
