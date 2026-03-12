// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ConnectionStatus } from "./connection-status";

afterEach(cleanup);

/**
 * Tests for the ConnectionStatus component.
 *
 * Validates that the WebSocket connection indicator accurately reflects
 * connected, reconnecting, and disconnected states. This is important
 * because operators rely on this indicator to know if they are receiving
 * live updates; a wrong status would undermine trust in the dashboard data.
 */
describe("ConnectionStatus", () => {
  /**
   * Verifies the connected state renders the "Connected" label and
   * an accessible status region with the correct aria-label.
   */
  it("renders connected state", () => {
    render(<ConnectionStatus status="connected" />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Connected to server");
  });

  /**
   * Verifies the disconnected state renders the "Disconnected" label
   * and an accessible status region with the correct aria-label.
   */
  it("renders disconnected state", () => {
    render(<ConnectionStatus status="disconnected" />);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByLabelText("Disconnected from server")).toBeInTheDocument();
  });

  /**
   * Verifies the reconnecting state renders the "Reconnecting…" label
   * and an accessible status region with the correct aria-label.
   * This state is shown during transient connection loss so operators
   * know data may be momentarily stale but recovery is in progress.
   */
  it("renders reconnecting state", () => {
    render(<ConnectionStatus status="reconnecting" />);
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    expect(screen.getByLabelText("Reconnecting to server")).toBeInTheDocument();
  });

  /**
   * Verifies the component uses aria-live="polite" so screen readers
   * announce connection status changes without interrupting the user.
   */
  it("has aria-live polite for screen reader announcements", () => {
    render(<ConnectionStatus status="connected" />);
    expect(screen.getByLabelText("Connected to server")).toHaveAttribute("aria-live", "polite");
  });
});
