// @vitest-environment jsdom
/**
 * Tests for the AuditEventTable component.
 *
 * Validates table rendering with event data, loading skeleton, empty state,
 * and expandable row detail functionality. These tests ensure operators
 * can browse and investigate audit events effectively.
 *
 * @see T100 — Build audit explorer view
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import type { AuditEvent } from "../../../api/types.js";
import { AuditEventTable } from "./audit-event-table.js";

afterEach(cleanup);

/** Factory for creating test audit events with sensible defaults. */
function createTestEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "evt-001",
    entityType: "task",
    entityId: "task-abc-123",
    eventType: "state_transition",
    actorType: "system",
    actorId: "scheduler",
    oldState: "ready",
    newState: "in_progress",
    metadata: { reason: "worker assigned" },
    timestamp: "2024-06-15T14:30:00Z",
    ...overrides,
  };
}

function renderTable(props: { events: readonly AuditEvent[]; isLoading: boolean }) {
  return render(
    <MemoryRouter>
      <AuditEventTable {...props} />
    </MemoryRouter>,
  );
}

describe("AuditEventTable", () => {
  /**
   * Verifies that the loading skeleton is shown while data is being fetched.
   * This provides visual feedback that data is loading.
   */
  it("shows loading skeleton when isLoading is true", () => {
    renderTable({ events: [], isLoading: true });
    expect(screen.getByTestId("audit-table-skeleton")).toBeInTheDocument();
  });

  /**
   * Verifies empty state message when no events match the current filters.
   * Helps operators understand they need to adjust filters.
   */
  it("shows empty state when no events and not loading", () => {
    renderTable({ events: [], isLoading: false });
    expect(screen.getByTestId("audit-table-empty")).toBeInTheDocument();
    expect(screen.getByText("No audit events found")).toBeInTheDocument();
  });

  /**
   * Verifies that events are rendered as table rows with correct data.
   * Each row should display time, entity badge, event type, and actor.
   */
  it("renders event rows with correct data", () => {
    const event = createTestEvent();
    renderTable({ events: [event], isLoading: false });

    expect(screen.getByTestId("audit-event-table")).toBeInTheDocument();
    expect(screen.getByTestId("audit-row-evt-001")).toBeInTheDocument();
    expect(screen.getByTestId("entity-type-badge-task")).toBeInTheDocument();
    expect(screen.getByText("task-abc-123")).toBeInTheDocument();
    expect(screen.getByText(/State Transition/)).toBeInTheDocument();
  });

  /**
   * Verifies that clicking a row expands it to show event detail.
   * The detail panel should show state transition, actor, entity,
   * and metadata information.
   */
  it("expands event detail on row click", () => {
    const event = createTestEvent();
    renderTable({ events: [event], isLoading: false });

    // Detail should not be visible initially
    expect(screen.queryByTestId("event-detail-evt-001")).not.toBeInTheDocument();

    // Click the row to expand
    fireEvent.click(screen.getByTestId("audit-row-evt-001"));

    // Detail should now be visible
    expect(screen.getByTestId("event-detail-evt-001")).toBeInTheDocument();
    expect(screen.getByTestId("old-state")).toHaveTextContent("ready");
    expect(screen.getByTestId("new-state")).toHaveTextContent("in_progress");
    expect(screen.getByTestId("event-metadata")).toHaveTextContent("worker assigned");
  });

  /**
   * Verifies that clicking an expanded row collapses the detail view.
   * This toggle behavior is essential for browsing multiple events.
   */
  it("collapses event detail on second click", () => {
    const event = createTestEvent();
    renderTable({ events: [event], isLoading: false });

    // Expand
    fireEvent.click(screen.getByTestId("audit-row-evt-001"));
    expect(screen.getByTestId("event-detail-evt-001")).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByTestId("audit-row-evt-001"));
    expect(screen.queryByTestId("event-detail-evt-001")).not.toBeInTheDocument();
  });

  /**
   * Verifies that multiple events can be expanded simultaneously.
   * Operators often need to compare two events side by side.
   */
  it("supports multiple expanded rows simultaneously", () => {
    const events = [
      createTestEvent({ id: "evt-001" }),
      createTestEvent({ id: "evt-002", entityId: "task-def-456" }),
    ];
    renderTable({ events, isLoading: false });

    fireEvent.click(screen.getByTestId("audit-row-evt-001"));
    fireEvent.click(screen.getByTestId("audit-row-evt-002"));

    expect(screen.getByTestId("event-detail-evt-001")).toBeInTheDocument();
    expect(screen.getByTestId("event-detail-evt-002")).toBeInTheDocument();
  });

  /**
   * Verifies that events without state transitions don't show the
   * transition section in the detail view. Not all events are
   * state transitions (e.g. "created" events).
   */
  it("handles events without state transitions", () => {
    const event = createTestEvent({
      id: "evt-003",
      eventType: "created",
      oldState: null,
      newState: null,
    });
    renderTable({ events: [event], isLoading: false });

    fireEvent.click(screen.getByTestId("audit-row-evt-003"));

    // State transition section should not appear
    expect(screen.queryByTestId("old-state")).not.toBeInTheDocument();
    expect(screen.queryByTestId("new-state")).not.toBeInTheDocument();
  });

  /**
   * Verifies that events with empty metadata don't show the metadata
   * section, keeping the detail view clean and uncluttered.
   */
  it("hides metadata section when metadata is empty", () => {
    const event = createTestEvent({
      id: "evt-004",
      metadata: {},
    });
    renderTable({ events: [event], isLoading: false });

    fireEvent.click(screen.getByTestId("audit-row-evt-004"));

    expect(screen.queryByTestId("event-metadata")).not.toBeInTheDocument();
  });

  /**
   * Verifies that task entity IDs are rendered as links to the task
   * detail page, enabling quick navigation from audit to task view.
   */
  it("renders task entity IDs as links to task detail", () => {
    const event = createTestEvent();
    renderTable({ events: [event], isLoading: false });

    fireEvent.click(screen.getByTestId("audit-row-evt-001"));

    const link = screen.getByTestId("entity-link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/tasks/task-abc-123");
  });

  /**
   * Verifies that non-task entity IDs are displayed as plain text
   * (not links), since we don't have detail pages for all entities.
   */
  it("renders non-task entity IDs as code text", () => {
    const event = createTestEvent({
      id: "evt-005",
      entityType: "lease",
      entityId: "lease-xyz",
    });
    renderTable({ events: [event], isLoading: false });

    fireEvent.click(screen.getByTestId("audit-row-evt-005"));

    expect(screen.queryByTestId("entity-link")).not.toBeInTheDocument();
    expect(screen.getByTestId("entity-id")).toHaveTextContent("lease-xyz");
  });

  /**
   * Verifies that the inline state transition summary is shown in the
   * event type column when both oldState and newState are present.
   */
  it("shows inline state transition in event type column", () => {
    const event = createTestEvent();
    renderTable({ events: [event], isLoading: false });

    const row = screen.getByTestId("audit-row-evt-001");
    expect(row).toHaveTextContent("ready → in_progress");
  });
});
