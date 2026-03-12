// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../api/query-keys";
import { getInvalidationKeys, invalidateQueriesForEvent } from "./invalidation";
import { EventChannel } from "./types";
import type { FactoryEvent } from "./types";

/**
 * Tests for the WebSocket event → TanStack Query cache invalidation mapping.
 *
 * These tests ensure that incoming real-time events correctly invalidate
 * the right query caches. Incorrect mappings would cause either:
 * - Missing invalidation: UI shows stale data after a backend change
 * - Over-invalidation: excessive refetches hurting performance
 *
 * The invalidation strategy intentionally favors correctness over
 * minimalism — invalidating at the entity-type level rather than
 * individual keys.
 */
describe("getInvalidationKeys", () => {
  /**
   * Verifies that task channel events invalidate task, review, and audit
   * queries. Task state changes affect all three: the task itself, its
   * review history, and the audit log.
   */
  it("returns task, review, and audit keys for Tasks channel events", () => {
    const event: FactoryEvent = {
      type: "task.state_changed",
      channel: EventChannel.Tasks,
      entityId: "task-123",
      data: { fromState: "queued", toState: "assigned" },
      timestamp: new Date().toISOString(),
    };

    const keys = getInvalidationKeys(event);
    expect(keys).toContainEqual(queryKeys.tasks.all);
    expect(keys).toContainEqual(queryKeys.reviews.all);
    expect(keys).toContainEqual(queryKeys.audit.all);
  });

  /**
   * Verifies that task.state_changed also invalidates pool queries.
   * When a task transitions (e.g., to assigned), it may affect worker
   * pool utilization metrics.
   */
  it("includes pool keys for task.state_changed events", () => {
    const event: FactoryEvent = {
      type: "task.state_changed",
      channel: EventChannel.Tasks,
      data: {},
      timestamp: new Date().toISOString(),
    };

    const keys = getInvalidationKeys(event);
    expect(keys).toContainEqual(queryKeys.pools.all);
  });

  /**
   * Verifies that worker channel events invalidate pool and audit queries.
   * Worker status changes affect the pool monitoring panel and audit trail.
   */
  it("returns pool and audit keys for Workers channel events", () => {
    const event: FactoryEvent = {
      type: "worker.status_changed",
      channel: EventChannel.Workers,
      data: {},
      timestamp: new Date().toISOString(),
    };

    const keys = getInvalidationKeys(event);
    expect(keys).toContainEqual(queryKeys.pools.all);
    expect(keys).toContainEqual(queryKeys.audit.all);
  });

  /**
   * Verifies that queue channel events invalidate task and audit queries.
   * Merge queue changes affect both task status and the audit log.
   */
  it("returns task and audit keys for Queue channel events", () => {
    const event: FactoryEvent = {
      type: "merge_queue_item.state_changed",
      channel: EventChannel.Queue,
      data: {},
      timestamp: new Date().toISOString(),
    };

    const keys = getInvalidationKeys(event);
    expect(keys).toContainEqual(queryKeys.tasks.all);
    expect(keys).toContainEqual(queryKeys.audit.all);
  });

  /**
   * Verifies that merge_queue_item.state_changed adds review invalidation.
   * Merge queue state changes may affect review cycle display.
   */
  it("includes review keys for merge_queue_item.state_changed", () => {
    const event: FactoryEvent = {
      type: "merge_queue_item.state_changed",
      channel: EventChannel.Queue,
      data: {},
      timestamp: new Date().toISOString(),
    };

    const keys = getInvalidationKeys(event);
    expect(keys).toContainEqual(queryKeys.reviews.all);
  });

  /**
   * Verifies that the key deduplication works — when an event type's
   * extra invalidations overlap with channel-level keys, we don't
   * invalidate the same key twice.
   */
  it("deduplicates keys when extras overlap with channel defaults", () => {
    const event: FactoryEvent = {
      type: "task.state_changed",
      channel: EventChannel.Tasks,
      data: {},
      timestamp: new Date().toISOString(),
    };

    const keys = getInvalidationKeys(event);
    const poolOccurrences = keys.filter((k) => k === queryKeys.pools.all);
    expect(poolOccurrences).toHaveLength(1);
  });

  /**
   * Verifies that an unknown event type on a known channel still gets
   * the channel-level invalidations. This is the fallback behavior
   * for new event types we haven't explicitly mapped.
   */
  it("falls back to channel-level keys for unknown event types", () => {
    const event: FactoryEvent = {
      type: "task.unknown_event",
      channel: EventChannel.Tasks,
      data: {},
      timestamp: new Date().toISOString(),
    };

    const keys = getInvalidationKeys(event);
    expect(keys).toContainEqual(queryKeys.tasks.all);
    expect(keys).toContainEqual(queryKeys.reviews.all);
    expect(keys).toContainEqual(queryKeys.audit.all);
  });
});

/**
 * Tests for the invalidateQueriesForEvent integration function.
 *
 * Verifies that the function correctly calls QueryClient.invalidateQueries
 * with the right keys. This is the integration point between the event
 * stream and the cache — if it breaks, the UI won't update on events.
 */
describe("invalidateQueriesForEvent", () => {
  /**
   * Verifies that invalidateQueriesForEvent calls invalidateQueries on the
   * QueryClient for each key returned by getInvalidationKeys. Uses a real
   * QueryClient instance to test the actual integration.
   */
  it("calls invalidateQueries for each key", () => {
    const queryClient = new QueryClient();
    const calls: unknown[][] = [];
    const origInvalidate = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = (opts: { queryKey?: unknown[] } = {}) => {
      if (opts.queryKey) {
        calls.push(opts.queryKey as unknown[]);
      }
      return origInvalidate(opts);
    };

    const event: FactoryEvent = {
      type: "worker.status_changed",
      channel: EventChannel.Workers,
      data: {},
      timestamp: new Date().toISOString(),
    };

    invalidateQueriesForEvent(queryClient, event);

    expect(calls).toContainEqual(queryKeys.pools.all);
    expect(calls).toContainEqual(queryKeys.audit.all);
  });
});
