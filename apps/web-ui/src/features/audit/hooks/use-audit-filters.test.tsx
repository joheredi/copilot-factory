// @vitest-environment jsdom
/**
 * Tests for the useAuditFilters hook.
 *
 * Validates that audit filter state is correctly read from and written
 * to URL search params, enabling shareable/bookmarkable filter links.
 * Tests cover initial state, individual filter changes, pagination,
 * and the clearAll action.
 *
 * @see T100 — Build audit explorer view
 */

import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuditFilters } from "./use-audit-filters.js";

afterEach(cleanup);

function createWrapper(initialEntries = ["/audit"]) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  );
}

describe("useAuditFilters", () => {
  /**
   * Verifies that the hook returns sensible defaults when no URL params
   * are present. This is the initial state operators see when first
   * visiting the audit page.
   */
  it("returns default state when no URL params are present", () => {
    const { result } = renderHook(() => useAuditFilters(), {
      wrapper: createWrapper(),
    });

    const [state] = result.current;
    expect(state.entityTypeFilter).toBe("");
    expect(state.entityIdFilter).toBe("");
    expect(state.eventTypeFilter).toBe("");
    expect(state.actorTypeFilter).toBe("");
    expect(state.actorIdFilter).toBe("");
    expect(state.startFilter).toBe("");
    expect(state.endFilter).toBe("");
    expect(state.page).toBe(1);
    expect(state.limit).toBe(20);
    expect(state.params).toEqual({ page: 1, limit: 20 });
  });

  /**
   * Verifies that pre-existing URL params (e.g. from a shared link)
   * are correctly parsed into filter state on initial render.
   */
  it("parses existing URL params into filter state", () => {
    const { result } = renderHook(() => useAuditFilters(), {
      wrapper: createWrapper(["/audit?entityType=task&eventType=state_transition&page=3&limit=50"]),
    });

    const [state] = result.current;
    expect(state.entityTypeFilter).toBe("task");
    expect(state.eventTypeFilter).toBe("state_transition");
    expect(state.page).toBe(3);
    expect(state.limit).toBe(50);
    expect(state.params).toEqual({
      page: 3,
      limit: 50,
      entityType: "task",
      eventType: "state_transition",
    });
  });

  /**
   * Verifies that setting a filter resets the page to 1, since the
   * result set has changed and the previous page may not exist.
   */
  it("resets page to 1 when a filter changes", () => {
    const { result } = renderHook(() => useAuditFilters(), {
      wrapper: createWrapper(["/audit?page=5"]),
    });

    act(() => {
      result.current[1].setEntityType("task");
    });

    const [state] = result.current;
    expect(state.entityTypeFilter).toBe("task");
    expect(state.page).toBe(1);
  });

  /**
   * Verifies that the setPage action updates page without touching
   * existing filter params.
   */
  it("updates page without affecting filters", () => {
    const { result } = renderHook(() => useAuditFilters(), {
      wrapper: createWrapper(["/audit?entityType=lease"]),
    });

    act(() => {
      result.current[1].setPage(4);
    });

    const [state] = result.current;
    expect(state.page).toBe(4);
    expect(state.entityTypeFilter).toBe("lease");
  });

  /**
   * Verifies that clearAll removes all filters and resets pagination,
   * returning to the default "show all events" state.
   */
  it("clears all filters and resets pagination", () => {
    const { result } = renderHook(() => useAuditFilters(), {
      wrapper: createWrapper(["/audit?entityType=task&eventType=created&page=3&limit=50"]),
    });

    act(() => {
      result.current[1].clearAll();
    });

    const [state] = result.current;
    expect(state.entityTypeFilter).toBe("");
    expect(state.eventTypeFilter).toBe("");
    expect(state.page).toBe(1);
    expect(state.limit).toBe(20);
  });

  /**
   * Verifies that setting the limit resets page to 1, since the
   * number of pages changes with a different page size.
   */
  it("resets page to 1 when limit changes", () => {
    const { result } = renderHook(() => useAuditFilters(), {
      wrapper: createWrapper(["/audit?page=5"]),
    });

    act(() => {
      result.current[1].setLimit(50);
    });

    const [state] = result.current;
    expect(state.limit).toBe(50);
    expect(state.page).toBe(1);
  });

  /**
   * Verifies that time range filters (start/end) are correctly set
   * and included in the params object for the API query.
   */
  it("sets time range filters", () => {
    const { result } = renderHook(() => useAuditFilters(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current[1].setStart("2024-01-15T00:00");
    });
    act(() => {
      result.current[1].setEnd("2024-01-16T23:59");
    });

    const [state] = result.current;
    expect(state.startFilter).toBe("2024-01-15T00:00");
    expect(state.endFilter).toBe("2024-01-16T23:59");
    expect(state.params.start).toBe("2024-01-15T00:00");
    expect(state.params.end).toBe("2024-01-16T23:59");
  });

  /**
   * Verifies that all filter actions produce the correct params shape.
   * This ensures the API hook receives the expected query parameters.
   */
  it("builds correct params with multiple filters active", () => {
    const { result } = renderHook(() => useAuditFilters(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current[1].setEntityType("task");
    });
    act(() => {
      result.current[1].setEntityId("task-123");
    });
    act(() => {
      result.current[1].setActorType("worker");
    });

    const [state] = result.current;
    expect(state.params).toEqual({
      page: 1,
      limit: 20,
      entityType: "task",
      entityId: "task-123",
      actorType: "worker",
    });
  });

  /**
   * Verifies limit clamping: invalid values fall back to the default of 20,
   * and values above 100 are clamped to 100.
   */
  it("clamps limit to valid range", () => {
    const { result: underflow } = renderHook(() => useAuditFilters(), {
      wrapper: createWrapper(["/audit?limit=0"]),
    });
    expect(underflow.current[0].limit).toBe(20);

    const { result: overflow } = renderHook(() => useAuditFilters(), {
      wrapper: createWrapper(["/audit?limit=999"]),
    });
    expect(overflow.current[0].limit).toBe(100);
  });
});
