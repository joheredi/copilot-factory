// @vitest-environment jsdom
/**
 * Tests for the Pool Detail page (PoolDetailPage).
 *
 * Validates the pool detail view:
 * - Shows pool name, type, and configuration
 * - Displays worker stats (online count, busy count, max concurrency)
 * - Renders worker table with correct status and task assignment
 * - Shows agent profiles with policy badges
 * - Handles loading, error, and empty states
 *
 * This page provides deep operational visibility into individual pools,
 * so regressions here impact an operator's ability to diagnose issues.
 *
 * @see T096 — Build worker pool monitoring panel
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WebSocketProvider } from "../../lib/websocket/index.js";
import PoolDetailPage from "./PoolDetailPage.js";

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

/** Fixture: a realistic pool for the detail view. */
function makePool() {
  return {
    id: "pool-dev-1",
    name: "Dev Pool Alpha",
    poolType: "developer",
    provider: "copilot",
    runtime: "copilot-cli",
    model: "gpt-4",
    maxConcurrency: 5,
    defaultTimeoutSec: 600,
    defaultTokenBudget: 50000,
    costProfile: "premium",
    capabilities: ["typescript", "react", "database"],
    repoScopeRules: null,
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-15T12:00:00Z",
  };
}

/** Fixture: workers registered in the pool. */
function makeWorkers() {
  return [
    {
      workerId: "worker-1",
      name: "worker-alpha",
      status: "busy",
      host: "localhost:8001",
      runtimeVersion: "copilot-cli/1.2.3",
      lastHeartbeatAt: new Date().toISOString(),
      currentTaskId: "task-abc-12345678",
      currentRunId: "run-001",
    },
    {
      workerId: "worker-2",
      name: "worker-beta",
      status: "online",
      host: "localhost:8002",
      runtimeVersion: "copilot-cli/1.2.3",
      lastHeartbeatAt: new Date(Date.now() - 30_000).toISOString(),
      currentTaskId: null,
      currentRunId: null,
    },
    {
      workerId: "worker-3",
      name: "worker-gamma",
      status: "offline",
      host: null,
      runtimeVersion: null,
      lastHeartbeatAt: null,
      currentTaskId: null,
      currentRunId: null,
    },
  ];
}

/** Fixture: agent profiles. */
function makeProfiles() {
  return [
    {
      id: "profile-1",
      poolId: "pool-dev-1",
      promptTemplateId: "tmpl-1",
      toolPolicyId: "tp-1",
      commandPolicyId: null,
      fileScopePolicyId: null,
      validationPolicyId: "vp-1",
      reviewPolicyId: null,
      budgetPolicyId: null,
      retryPolicyId: null,
      createdAt: "2026-01-05T00:00:00Z",
      updatedAt: "2026-01-05T00:00:00Z",
    },
  ];
}

function setupSuccessResponses() {
  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/api/pools/pool-dev-1/workers")) {
      return Promise.resolve(fakeResponse(makeWorkers()));
    }
    if (url.includes("/api/pools/pool-dev-1/profiles")) {
      return Promise.resolve(fakeResponse(makeProfiles()));
    }
    if (url.includes("/api/pools/pool-dev-1")) {
      return Promise.resolve(fakeResponse(makePool()));
    }

    return Promise.resolve(fakeResponse(null, 404));
  });
}

function renderDetailPage(poolId = "pool-dev-1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={false}>
        <MemoryRouter initialEntries={[`/workers/${poolId}`]}>
          <Routes>
            <Route path="/workers/:id" element={<PoolDetailPage />} />
          </Routes>
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

describe("PoolDetailPage", () => {
  /**
   * Validates the pool name renders as a heading.
   * This is the primary identifier on the detail page.
   */
  it("renders pool name as heading", async () => {
    setupSuccessResponses();
    renderDetailPage();

    const heading = await screen.findByTestId("pool-name");
    expect(heading).toHaveTextContent("Dev Pool Alpha");
  });

  /**
   * Validates pool type and status badges are displayed.
   * Operators need to see type and availability at a glance.
   */
  it("shows pool type and status badges", async () => {
    setupSuccessResponses();
    renderDetailPage();

    expect(await screen.findByTestId("pool-type-developer")).toBeInTheDocument();
    expect(screen.getByTestId("pool-status-enabled")).toBeInTheDocument();
  });

  /**
   * Validates worker stat cards show correct counts.
   * Worker online/busy counts are essential capacity metrics.
   */
  it("shows worker statistics", async () => {
    setupSuccessResponses();
    renderDetailPage();

    // 2 online (busy + online), 1 offline
    const onlineStat = await screen.findByTestId("stat-workers-online");
    expect(onlineStat).toHaveTextContent("2");

    // 1 busy
    const busyStat = screen.getByTestId("stat-workers-busy");
    expect(busyStat).toHaveTextContent("1");

    // Max concurrency = 5
    const concurrencyStat = screen.getByTestId("stat-max-concurrency");
    expect(concurrencyStat).toHaveTextContent("5");
  });

  /**
   * Validates the configuration section displays all pool settings.
   * Operators reference this to understand pool behaviour.
   */
  it("shows pool configuration", async () => {
    setupSuccessResponses();
    renderDetailPage();

    const config = await screen.findByTestId("pool-config");
    expect(config).toHaveTextContent("copilot");
    expect(config).toHaveTextContent("gpt-4");
    expect(config).toHaveTextContent("copilot-cli");
    expect(config).toHaveTextContent("premium");
    expect(config).toHaveTextContent("600s");
    expect(config).toHaveTextContent("50,000");
  });

  /**
   * Validates that capabilities badges render correctly.
   * Capabilities determine which tasks a pool can handle.
   */
  it("shows capability badges", async () => {
    setupSuccessResponses();
    renderDetailPage();

    expect(await screen.findByText("typescript")).toBeInTheDocument();
    expect(screen.getByText("react")).toBeInTheDocument();
    expect(screen.getByText("database")).toBeInTheDocument();
  });

  /**
   * Validates the worker table shows all workers with their status.
   * This table is the primary tool for diagnosing worker issues.
   */
  it("renders worker table with status badges", async () => {
    setupSuccessResponses();
    renderDetailPage();

    const table = await screen.findByTestId("worker-table");
    expect(table).toBeInTheDocument();

    // Check worker names
    expect(screen.getByText("worker-alpha")).toBeInTheDocument();
    expect(screen.getByText("worker-beta")).toBeInTheDocument();
    expect(screen.getByText("worker-gamma")).toBeInTheDocument();

    // Check status badges
    const busyStatus = screen.getByTestId("worker-status-worker-1");
    expect(busyStatus).toHaveTextContent("busy");

    const onlineStatus = screen.getByTestId("worker-status-worker-2");
    expect(onlineStatus).toHaveTextContent("online");
  });

  /**
   * Validates worker task assignment is displayed.
   * Operators need to see which tasks workers are executing.
   */
  it("shows current task assignment for busy workers", async () => {
    setupSuccessResponses();
    renderDetailPage();

    // Busy worker should show truncated task ID (first 8 chars)
    await screen.findByTestId("worker-table");
    expect(screen.getByText(/task-abc/)).toBeInTheDocument();
  });

  /**
   * Validates agent profiles section renders with policy badges.
   * Profiles define worker behaviour — operators review them to
   * understand and debug worker actions.
   */
  it("shows agent profiles with policy badges", async () => {
    setupSuccessResponses();
    renderDetailPage();

    const profilesList = await screen.findByTestId("profiles-list");
    expect(profilesList).toBeInTheDocument();

    const profile = screen.getByTestId("profile-profile-1");
    expect(profile).toBeInTheDocument();

    // Profile has prompt, tool-policy, and validation configured
    expect(profile).toHaveTextContent("prompt");
    expect(profile).toHaveTextContent("tool-policy");
    expect(profile).toHaveTextContent("validation");
  });

  /**
   * Validates the back navigation link.
   * Ensures operators can return to the pool list easily.
   */
  it("renders back to pools link", async () => {
    setupSuccessResponses();
    renderDetailPage();

    const backLink = await screen.findByTestId("back-to-pools");
    expect(backLink).toBeInTheDocument();
  });

  /**
   * Validates loading skeleton while pool data loads.
   * Prevents layout shift and communicates loading state.
   */
  it("shows loading skeleton while pool loads", () => {
    fetchSpy.mockImplementation(() => new Promise(() => {}));
    renderDetailPage();

    expect(screen.getByTestId("pool-detail-skeleton")).toBeInTheDocument();
  });

  /**
   * Validates error state when pool is not found.
   * Handles invalid IDs or deleted pools gracefully.
   */
  it("shows error when pool not found", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(new Response("Not Found", { status: 404 })));
    renderDetailPage("nonexistent-id");

    const error = await screen.findByTestId("pool-detail-error");
    expect(error).toHaveTextContent("Pool not found");
  });

  /**
   * Validates empty worker table state.
   * Pools may exist before any workers register.
   */
  it("shows empty worker state when no workers", async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/workers")) {
        return Promise.resolve(fakeResponse([]));
      }
      if (url.includes("/profiles")) {
        return Promise.resolve(fakeResponse([]));
      }
      if (url.includes("/api/pools/")) {
        return Promise.resolve(fakeResponse(makePool()));
      }
      return Promise.resolve(fakeResponse(null, 404));
    });
    renderDetailPage();

    const empty = await screen.findByTestId("worker-table-empty");
    expect(empty).toHaveTextContent("No workers registered");
  });

  /**
   * Validates empty profiles state.
   * Pools may have no agent profiles configured initially.
   */
  it("shows empty profiles state when no profiles", async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/workers")) {
        return Promise.resolve(fakeResponse(makeWorkers()));
      }
      if (url.includes("/profiles")) {
        return Promise.resolve(fakeResponse([]));
      }
      if (url.includes("/api/pools/")) {
        return Promise.resolve(fakeResponse(makePool()));
      }
      return Promise.resolve(fakeResponse(null, 404));
    });
    renderDetailPage();

    const empty = await screen.findByTestId("profiles-empty");
    expect(empty).toHaveTextContent("No profiles configured");
  });
});
