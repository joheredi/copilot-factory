// @vitest-environment jsdom
/**
 * Tests for the RecentActivityFeed helper functions.
 *
 * These pure functions format timestamps and event types for display.
 * Incorrect formatting would make the activity feed confusing for
 * operators trying to understand system events.
 *
 * @see T093 — Build dashboard view with system health summary
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { formatRelativeTime, formatEventType } from "./recent-activity-feed.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatRelativeTime", () => {
  /**
   * Validates that very recent timestamps show "just now".
   */
  it("returns 'just now' for timestamps within 60 seconds", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("just now");
  });

  /**
   * Validates minute-level formatting.
   */
  it("formats minutes correctly", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe("5m ago");
  });

  /**
   * Validates hour-level formatting.
   */
  it("formats hours correctly", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe("2h ago");
  });

  /**
   * Validates day-level formatting.
   */
  it("formats days correctly", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe("3d ago");
  });

  /**
   * Validates graceful handling of future timestamps (clock skew).
   */
  it("returns 'just now' for future timestamps", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(formatRelativeTime(future)).toBe("just now");
  });

  /**
   * Validates graceful handling of invalid date strings.
   */
  it("returns 'just now' for invalid date strings", () => {
    expect(formatRelativeTime("not-a-date")).toBe("just now");
  });
});

describe("formatEventType", () => {
  /**
   * Validates that dot-separated event types are parsed and title-cased.
   */
  it("formats dot-separated event types", () => {
    expect(formatEventType("task.state_changed")).toBe("State Changed");
  });

  /**
   * Validates handling of simple (non-dotted) event types.
   */
  it("formats simple event types", () => {
    expect(formatEventType("heartbeat")).toBe("Heartbeat");
  });

  /**
   * Validates handling of deeply nested event types.
   */
  it("uses the last segment of deeply nested event types", () => {
    expect(formatEventType("worker.pool.capacity_changed")).toBe("Capacity Changed");
  });
});
