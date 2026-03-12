// @vitest-environment jsdom
/**
 * Integration tests for the AuditPage component.
 *
 * Validates the full audit explorer page including data fetching,
 * filter toggle, error states, and pagination integration. Uses
 * a mocked fetch to simulate API responses.
 *
 * @see T100 — Build audit explorer view
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AuditPage from "./page.js";

afterEach(cleanup);

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyAuditResponse() {
  return { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } };
}

function populatedAuditResponse() {
  return {
    data: [
      {
        id: "evt-001",
        entityType: "task",
        entityId: "task-abc",
        eventType: "state_transition",
        actorType: "system",
        actorId: "scheduler",
        oldState: "ready",
        newState: "in_progress",
        metadata: { worker: "w1" },
        timestamp: "2024-06-15T14:30:00Z",
      },
      {
        id: "evt-002",
        entityType: "lease",
        entityId: "lease-xyz",
        eventType: "created",
        actorType: "worker",
        actorId: "worker-001",
        oldState: null,
        newState: null,
        metadata: {},
        timestamp: "2024-06-15T14:29:00Z",
      },
    ],
    meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
  };
}

function renderAuditPage(initialEntries = ["/audit"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <AuditPage />
      </MemoryRouter>
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

describe("AuditPage", () => {
  /**
   * Verifies the page renders with the correct heading and description.
   * This is the operator's entry point to the audit system.
   */
  it("renders the page heading and description", () => {
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(emptyAuditResponse())));
    renderAuditPage();

    expect(screen.getByText("Audit Explorer")).toBeInTheDocument();
    expect(
      screen.getByText("Search and browse system events across all entities"),
    ).toBeInTheDocument();
  });

  /**
   * Verifies that filters are visible by default on initial page load.
   * Operators should immediately see available filter options.
   */
  it("shows filters by default", () => {
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(emptyAuditResponse())));
    renderAuditPage();

    expect(screen.getByTestId("audit-filters")).toBeInTheDocument();
  });

  /**
   * Verifies the filter panel can be toggled on and off, allowing
   * operators to maximize screen real estate for the event table.
   */
  it("toggles filter visibility", () => {
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(emptyAuditResponse())));
    renderAuditPage();

    expect(screen.getByTestId("audit-filters")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-filters"));
    expect(screen.queryByTestId("audit-filters")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-filters"));
    expect(screen.getByTestId("audit-filters")).toBeInTheDocument();
  });

  /**
   * Verifies that events are displayed in the table once data loads.
   * Both events from the mock response should be visible.
   */
  it("displays events in the table after loading", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(populatedAuditResponse())));
    renderAuditPage();

    await waitFor(() => {
      expect(screen.getByTestId("audit-event-table")).toBeInTheDocument();
    });

    expect(screen.getByTestId("audit-row-evt-001")).toBeInTheDocument();
    expect(screen.getByTestId("audit-row-evt-002")).toBeInTheDocument();
  });

  /**
   * Verifies that the results summary shows the correct count of
   * matching events, providing context for filter effectiveness.
   */
  it("shows results summary with event count", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(populatedAuditResponse())));
    renderAuditPage();

    await waitFor(() => {
      expect(screen.getByTestId("results-summary")).toHaveTextContent("Found 2 events");
    });
  });

  /**
   * Verifies that an error message is displayed when the API request fails.
   * This helps operators diagnose connectivity issues with the control plane.
   */
  it("shows error state when API request fails", async () => {
    fetchSpy.mockImplementation(() => Promise.reject(new Error("Network error")));
    renderAuditPage();

    await waitFor(() => {
      expect(screen.getByTestId("audit-error")).toBeInTheDocument();
    });

    expect(screen.getByText(/Unable to load audit events/)).toBeInTheDocument();
  });

  /**
   * Verifies that the API is called with the correct query parameters
   * based on URL search params (simulating a shared filter link).
   */
  it("passes URL filter params to the API", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(emptyAuditResponse())));
    renderAuditPage(["/audit?entityType=task&eventType=state_transition"]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });

    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain("entityType=task");
    expect(url).toContain("eventType=state_transition");
  });

  /**
   * Verifies that the "no events" message is shown when filters
   * produce zero results, guiding operators to adjust their search.
   */
  it("shows 'no events' summary when results are empty", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(emptyAuditResponse())));
    renderAuditPage();

    await waitFor(() => {
      expect(screen.getByTestId("results-summary")).toHaveTextContent(
        "No events match your filters",
      );
    });
  });

  /**
   * Verifies that pagination is not rendered when the result set is empty.
   * There's no point showing pagination controls with zero results.
   */
  it("hides pagination when no events", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(fakeResponse(emptyAuditResponse())));
    renderAuditPage();

    await waitFor(() => {
      expect(screen.getByTestId("results-summary")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("audit-pagination")).not.toBeInTheDocument();
  });

  /**
   * Verifies that pagination controls appear when there are events.
   * This ensures operators can navigate through large result sets.
   */
  it("shows pagination when events are present", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        fakeResponse({
          data: [
            {
              id: "evt-001",
              entityType: "task",
              entityId: "task-1",
              eventType: "created",
              actorType: "system",
              actorId: "sys",
              oldState: null,
              newState: null,
              metadata: {},
              timestamp: "2024-06-15T14:30:00Z",
            },
          ],
          meta: { page: 1, limit: 20, total: 50, totalPages: 2 },
        }),
      ),
    );
    renderAuditPage();

    await waitFor(() => {
      expect(screen.getByTestId("audit-pagination")).toBeInTheDocument();
    });

    expect(screen.getByTestId("audit-pagination-info")).toHaveTextContent(
      "Showing 1–20 of 50 events",
    );
  });
});
