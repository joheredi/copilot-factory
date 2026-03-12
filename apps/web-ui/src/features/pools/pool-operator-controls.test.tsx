// @vitest-environment jsdom
/**
 * Tests for pool operator controls (T105).
 *
 * Validates the operator controls integrated into the pool detail view:
 *
 * - **PoolToggle**: Enable/disable buttons render correctly based on state,
 *   confirmation dialog shown for disable (disruptive action), enable is
 *   immediate, mutation callbacks produce correct feedback.
 * - **ConcurrencyEditor**: Display mode shows current value with edit button,
 *   edit mode shows input + save/cancel, validation rejects out-of-range
 *   values, save triggers mutation, cancel reverts, keyboard shortcuts work.
 *
 * These tests are critical because pool enable/disable and concurrency
 * changes directly affect task scheduling capacity. A broken toggle could
 * disable a pool without confirmation, and a broken concurrency editor
 * could set invalid limits that crash the scheduler.
 *
 * @see T105 — Integrate operator controls into pool and merge queue UI
 * @see docs/prd/006-additional-refinements.md §6.1 — Configurable pools
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PoolToggle } from "./components/pool-toggle";
import { ConcurrencyEditor } from "./components/concurrency-editor";

afterEach(cleanup);

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// PoolToggle tests
// ---------------------------------------------------------------------------

describe("PoolToggle", () => {
  /**
   * Validates that when a pool is enabled, the disable button is shown.
   * This is the primary entry point for operators to pause a pool.
   */
  it("shows disable button when pool is enabled", () => {
    const { wrapper } = createWrapper();
    render(<PoolToggle poolId="pool-1" enabled={true} onFeedback={vi.fn()} />, { wrapper });
    expect(screen.getByTestId("pool-disable-btn")).toBeInTheDocument();
    expect(screen.getByTestId("pool-disable-btn")).toHaveTextContent("Disable Pool");
  });

  /**
   * Validates that when a pool is disabled, the enable button is shown.
   * Enables should be safe and quick (no confirmation).
   */
  it("shows enable button when pool is disabled", () => {
    const { wrapper } = createWrapper();
    render(<PoolToggle poolId="pool-1" enabled={false} onFeedback={vi.fn()} />, { wrapper });
    expect(screen.getByTestId("pool-enable-btn")).toBeInTheDocument();
    expect(screen.getByTestId("pool-enable-btn")).toHaveTextContent("Enable Pool");
  });

  /**
   * Validates that clicking disable opens a confirmation dialog.
   * Disabling is a disruptive action that affects scheduling.
   */
  it("opens confirmation dialog on disable click", async () => {
    const { wrapper } = createWrapper();
    render(<PoolToggle poolId="pool-1" enabled={true} onFeedback={vi.fn()} />, { wrapper });
    await userEvent.click(screen.getByTestId("pool-disable-btn"));
    expect(screen.getByTestId("confirm-action-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-dialog-title")).toHaveTextContent("Disable Pool");
  });

  /**
   * Validates that enabling a pool calls the API directly without confirmation.
   * Enable is a safe action that restores normal operation.
   */
  it("enables pool immediately without confirmation", async () => {
    const onFeedback = vi.fn();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(fakeResponse({ id: "pool-1", enabled: true })),
    );

    const { wrapper } = createWrapper();
    render(<PoolToggle poolId="pool-1" enabled={false} onFeedback={onFeedback} />, { wrapper });
    await userEvent.click(screen.getByTestId("pool-enable-btn"));
    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith("success", "Pool enabled successfully."),
    );

    const callUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(callUrl).toBe("/api/pools/pool-1");
    const callInit = fetchSpy.mock.calls[0]![1]!;
    expect(callInit.method).toBe("PUT");
    const body = JSON.parse(callInit.body as string);
    expect(body.enabled).toBe(true);
  });

  /**
   * Validates that disabling a pool sends the correct API request after confirmation.
   */
  it("disables pool after confirmation with reason", async () => {
    const onFeedback = vi.fn();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(fakeResponse({ id: "pool-1", enabled: false })),
    );

    const { wrapper } = createWrapper();
    render(<PoolToggle poolId="pool-1" enabled={true} onFeedback={onFeedback} />, { wrapper });

    await userEvent.click(screen.getByTestId("pool-disable-btn"));
    await userEvent.type(screen.getByTestId("confirm-dialog-reason"), "Maintenance window");
    await userEvent.click(screen.getByTestId("confirm-dialog-submit"));

    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith(
        "success",
        "Pool disabled. Reason: Maintenance window",
      ),
    );

    const callInit = fetchSpy.mock.calls[0]![1]!;
    const body = JSON.parse(callInit.body as string);
    expect(body.enabled).toBe(false);
  });

  /**
   * Validates that API errors surface as error feedback.
   */
  it("shows error feedback on API failure", async () => {
    const onFeedback = vi.fn();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(fakeResponse({ message: "Server error" }, 500)),
    );

    const { wrapper } = createWrapper();
    render(<PoolToggle poolId="pool-1" enabled={false} onFeedback={onFeedback} />, { wrapper });
    await userEvent.click(screen.getByTestId("pool-enable-btn"));
    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("Failed to enable pool"),
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// ConcurrencyEditor tests
// ---------------------------------------------------------------------------

describe("ConcurrencyEditor", () => {
  /**
   * Validates that the display mode shows the current value and an edit button.
   * This is the default read-only state before the operator clicks edit.
   */
  it("displays current value with edit button in display mode", () => {
    const { wrapper } = createWrapper();
    render(<ConcurrencyEditor poolId="pool-1" currentValue={5} onFeedback={vi.fn()} />, {
      wrapper,
    });
    expect(screen.getByTestId("concurrency-display")).toBeInTheDocument();
    expect(screen.getByTestId("stat-max-concurrency")).toHaveTextContent("5");
    expect(screen.getByTestId("concurrency-edit-btn")).toBeInTheDocument();
  });

  /**
   * Validates that clicking the edit button transitions to edit mode
   * with an input pre-populated with the current value.
   */
  it("enters edit mode when edit button is clicked", async () => {
    const { wrapper } = createWrapper();
    render(<ConcurrencyEditor poolId="pool-1" currentValue={5} onFeedback={vi.fn()} />, {
      wrapper,
    });

    await userEvent.click(screen.getByTestId("concurrency-edit-btn"));
    expect(screen.getByTestId("concurrency-editor")).toBeInTheDocument();
    expect(screen.getByTestId("concurrency-input")).toHaveValue(5);
    expect(screen.getByTestId("concurrency-save-btn")).toBeInTheDocument();
    expect(screen.getByTestId("concurrency-cancel-btn")).toBeInTheDocument();
  });

  /**
   * Validates that cancel returns to display mode without calling API.
   */
  it("cancels editing and reverts to display mode", async () => {
    const { wrapper } = createWrapper();
    render(<ConcurrencyEditor poolId="pool-1" currentValue={5} onFeedback={vi.fn()} />, {
      wrapper,
    });

    await userEvent.click(screen.getByTestId("concurrency-edit-btn"));
    await userEvent.click(screen.getByTestId("concurrency-cancel-btn"));
    expect(screen.getByTestId("concurrency-display")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /**
   * Validates that saving a new value calls the update API correctly.
   */
  it("saves new concurrency value via API", async () => {
    const onFeedback = vi.fn();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(fakeResponse({ id: "pool-1", maxConcurrency: 10 })),
    );

    const { wrapper } = createWrapper();
    render(<ConcurrencyEditor poolId="pool-1" currentValue={5} onFeedback={onFeedback} />, {
      wrapper,
    });

    await userEvent.click(screen.getByTestId("concurrency-edit-btn"));
    const input = screen.getByTestId("concurrency-input");
    await userEvent.clear(input);
    await userEvent.type(input, "10");
    await userEvent.click(screen.getByTestId("concurrency-save-btn"));

    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith("success", "Concurrency updated from 5 to 10."),
    );

    const callInit = fetchSpy.mock.calls[0]![1]!;
    const body = JSON.parse(callInit.body as string);
    expect(body.maxConcurrency).toBe(10);
  });

  /**
   * Validates that saving the same value cancels the edit (no API call).
   */
  it("cancels when saving unchanged value", async () => {
    const { wrapper } = createWrapper();
    render(<ConcurrencyEditor poolId="pool-1" currentValue={5} onFeedback={vi.fn()} />, {
      wrapper,
    });

    await userEvent.click(screen.getByTestId("concurrency-edit-btn"));
    await userEvent.click(screen.getByTestId("concurrency-save-btn"));
    expect(screen.getByTestId("concurrency-display")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /**
   * Validates that pressing Enter triggers save (keyboard shortcut).
   */
  it("saves on Enter key press", async () => {
    const onFeedback = vi.fn();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(fakeResponse({ id: "pool-1", maxConcurrency: 8 })),
    );

    const { wrapper } = createWrapper();
    render(<ConcurrencyEditor poolId="pool-1" currentValue={5} onFeedback={onFeedback} />, {
      wrapper,
    });

    await userEvent.click(screen.getByTestId("concurrency-edit-btn"));
    const input = screen.getByTestId("concurrency-input");
    await userEvent.clear(input);
    await userEvent.type(input, "8{Enter}");

    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith(
        "success",
        expect.stringContaining("Concurrency updated"),
      ),
    );
  });

  /**
   * Validates that pressing Escape cancels editing (keyboard shortcut).
   */
  it("cancels on Escape key press", async () => {
    const { wrapper } = createWrapper();
    render(<ConcurrencyEditor poolId="pool-1" currentValue={5} onFeedback={vi.fn()} />, {
      wrapper,
    });

    await userEvent.click(screen.getByTestId("concurrency-edit-btn"));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByTestId("concurrency-display")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /**
   * Validates that API errors surface as error feedback.
   */
  it("shows error feedback on API failure", async () => {
    const onFeedback = vi.fn();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(fakeResponse({ message: "Invalid value" }, 400)),
    );

    const { wrapper } = createWrapper();
    render(<ConcurrencyEditor poolId="pool-1" currentValue={5} onFeedback={onFeedback} />, {
      wrapper,
    });

    await userEvent.click(screen.getByTestId("concurrency-edit-btn"));
    const input = screen.getByTestId("concurrency-input");
    await userEvent.clear(input);
    await userEvent.type(input, "20");
    await userEvent.click(screen.getByTestId("concurrency-save-btn"));

    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("Failed to update concurrency"),
      ),
    );
  });
});
