/**
 * Tests for the QueueWorkerEventsService.
 *
 * Validates heartbeat throttling, pool summary broadcasting, merge queue
 * position updates, and periodic queue depth gauge broadcasting. These
 * are the aggregate/enrichment events added by T088 on top of the
 * individual domain events broadcast by T087.
 *
 * Uses the same mock server pattern as the other events tests — manual
 * instantiation with a mock socket.io server that captures emit calls.
 * Database queries are isolated by spying on the service's snapshot methods.
 *
 * @module @factory/control-plane/events
 */
import type { Server } from "socket.io";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { EventBroadcasterService } from "./event-broadcaster.service.js";
import { EventsGateway } from "./events.gateway.js";
import { QueueWorkerEventsService } from "./queue-worker-events.service.js";
import { EventChannel } from "./types.js";
import type { FactoryEvent } from "./types.js";

/**
 * Create a mock socket.io server that records all emit calls.
 * Same pattern used in event-broadcaster and domain-event-broadcaster tests.
 */
function createMockServer() {
  const emitCalls: Array<{ room: string; event: string; data: FactoryEvent }> = [];
  return {
    emitCalls,
    to: vi.fn((room: string) => ({
      emit: vi.fn((event: string, data: FactoryEvent) => {
        emitCalls.push({ room, event, data });
      }),
    })),
  };
}

/**
 * Create a mock ModuleRef that returns a mock DatabaseConnection.
 * The actual DB queries are bypassed by spying on the snapshot methods,
 * so this mock only needs to satisfy the ModuleRef.get signature.
 */
function createMockModuleRef() {
  const mockConn = {
    db: {},
    sqlite: {},
    close: vi.fn(),
    healthCheck: vi.fn(),
    writeTransaction: vi.fn(),
  };
  return {
    get: vi.fn(() => mockConn),
  } as never;
}

describe("QueueWorkerEventsService", () => {
  let service: QueueWorkerEventsService;
  let gateway: EventsGateway;
  let broadcaster: EventBroadcasterService;
  let mockServer: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    vi.useFakeTimers();

    gateway = new EventsGateway();
    mockServer = createMockServer();
    gateway.server = mockServer as unknown as Server;
    broadcaster = new EventBroadcasterService(gateway);

    // Create service without triggering onModuleInit (no auto-polling in tests)
    service = new QueueWorkerEventsService(broadcaster, createMockModuleRef());
  });

  afterEach(() => {
    // Clean up any intervals that may have been started
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  describe("heartbeat throttling", () => {
    /**
     * Validates that the first heartbeat for a worker is always broadcast.
     * Without this, new workers would have a delayed first appearance in the UI.
     */
    it("should broadcast the first heartbeat for a worker", () => {
      const result = service.broadcastHeartbeat("worker-1", {
        leaseId: "lease-1",
        heartbeatAt: "2026-03-12T05:30:00.000Z",
      });

      expect(result).toBe(true);
      expect(mockServer.emitCalls).toHaveLength(2); // entity room + channel room
      expect(mockServer.emitCalls[0]!.data.type).toBe("worker.heartbeat");
      expect(mockServer.emitCalls[0]!.data.entityId).toBe("worker-1");
      expect(mockServer.emitCalls[0]!.data.data).toEqual(
        expect.objectContaining({
          workerId: "worker-1",
          leaseId: "lease-1",
          heartbeatAt: "2026-03-12T05:30:00.000Z",
        }),
      );
    });

    /**
     * Validates the core throttling behavior: rapid successive heartbeats
     * within the throttle window are suppressed. This prevents UI flooding
     * when workers send heartbeats every second.
     */
    it("should throttle heartbeats within the throttle window", () => {
      service.broadcastHeartbeat("worker-1", { seq: 1 });
      mockServer.emitCalls.length = 0;

      // Second heartbeat within 5s should be throttled
      vi.advanceTimersByTime(2_000);
      const result = service.broadcastHeartbeat("worker-1", { seq: 2 });

      expect(result).toBe(false);
      expect(mockServer.emitCalls).toHaveLength(0);
    });

    /**
     * Validates that heartbeats are broadcast again after the throttle
     * window expires. Workers continue to appear alive in the UI with
     * a 5-second granularity.
     */
    it("should allow heartbeat broadcast after throttle window expires", () => {
      service.broadcastHeartbeat("worker-1", { seq: 1 });
      mockServer.emitCalls.length = 0;

      vi.advanceTimersByTime(5_001);
      const result = service.broadcastHeartbeat("worker-1", { seq: 2 });

      expect(result).toBe(true);
      expect(mockServer.emitCalls).toHaveLength(2);
    });

    /**
     * Validates that throttling is per-worker, not global. Two different
     * workers sending heartbeats simultaneously should both be broadcast.
     */
    it("should throttle independently per worker", () => {
      service.broadcastHeartbeat("worker-1", { seq: 1 });
      service.broadcastHeartbeat("worker-2", { seq: 1 });

      // 4 emit calls: 2 per worker (entity room + channel room each)
      expect(mockServer.emitCalls).toHaveLength(4);
    });

    /**
     * Validates that heartbeat broadcasting does not throw even when
     * the socket.io server fails. Heartbeats are observability events —
     * failures must not disrupt the heartbeat processing pipeline.
     */
    it("should not throw when broadcaster fails", () => {
      vi.spyOn(broadcaster, "broadcastToEntity").mockImplementation(() => {
        throw new Error("socket.io exploded");
      });

      const result = service.broadcastHeartbeat("worker-1", { seq: 1 });

      expect(result).toBe(false);
    });
  });

  describe("pool summary broadcasting", () => {
    /**
     * Validates that pool summaries include aggregate worker counts
     * grouped by status. This is the primary data the UI pool monitoring
     * panel needs to display pool health.
     */
    it("should broadcast pool summary with status breakdown", () => {
      vi.spyOn(service, "getWorkerPoolSnapshot").mockReturnValue({
        poolId: "pool-1",
        poolWorkers: [
          { status: "online" },
          { status: "busy" },
          { status: "busy" },
          { status: "offline" },
        ],
      });

      service.broadcastPoolSummary("worker-1");

      expect(mockServer.emitCalls).toHaveLength(2); // entity room + channel room
      expect(mockServer.emitCalls[0]!.data.type).toBe("pool.summary_updated");
      expect(mockServer.emitCalls[0]!.data.channel).toBe(EventChannel.Workers);
      expect(mockServer.emitCalls[0]!.data.entityId).toBe("pool-1");
      expect(mockServer.emitCalls[0]!.data.data).toEqual({
        poolId: "pool-1",
        totalWorkers: 4,
        activeWorkers: 2,
        byStatus: { online: 1, busy: 2, offline: 1 },
      });
    });

    /**
     * Validates graceful handling when a worker is not found or has no
     * pool assignment. This can happen during worker registration before
     * pool assignment, or after worker deregistration.
     */
    it("should skip broadcast when worker has no pool", () => {
      vi.spyOn(service, "getWorkerPoolSnapshot").mockReturnValue(undefined);

      service.broadcastPoolSummary("orphan-worker");

      expect(mockServer.emitCalls).toHaveLength(0);
    });

    /**
     * Validates that pool summary broadcasting does not throw on
     * database or broadcaster errors. Pool summaries are supplementary
     * enrichment events — failures must not cascade.
     */
    it("should not throw when snapshot query fails", () => {
      vi.spyOn(service, "getWorkerPoolSnapshot").mockImplementation(() => {
        throw new Error("DB connection lost");
      });

      expect(() => service.broadcastPoolSummary("worker-1")).not.toThrow();
    });
  });

  describe("merge queue position broadcasting", () => {
    /**
     * Validates that merge queue position updates include the full ordered
     * list of items for a repository. The UI merge queue view needs the
     * complete list to render queue positions correctly.
     */
    it("should broadcast merge queue positions for a repository", () => {
      vi.spyOn(service, "getMergeQueueSnapshot").mockReturnValue({
        repositoryId: "repo-1",
        items: [
          { mergeQueueItemId: "mqi-1", taskId: "task-1", position: 1, status: "QUEUED" },
          { mergeQueueItemId: "mqi-2", taskId: "task-2", position: 2, status: "QUEUED" },
          { mergeQueueItemId: "mqi-3", taskId: "task-3", position: 3, status: "IN_PROGRESS" },
        ],
      });

      service.broadcastMergeQueueUpdate("mqi-1");

      expect(mockServer.emitCalls).toHaveLength(1); // channel room only (broadcastToChannel)
      expect(mockServer.emitCalls[0]!.data.type).toBe("merge_queue.positions_updated");
      expect(mockServer.emitCalls[0]!.data.channel).toBe(EventChannel.Queue);
      expect(mockServer.emitCalls[0]!.data.data).toEqual({
        repositoryId: "repo-1",
        items: [
          { mergeQueueItemId: "mqi-1", taskId: "task-1", position: 1, status: "QUEUED" },
          { mergeQueueItemId: "mqi-2", taskId: "task-2", position: 2, status: "QUEUED" },
          { mergeQueueItemId: "mqi-3", taskId: "task-3", position: 3, status: "IN_PROGRESS" },
        ],
      });
    });

    /**
     * Validates graceful handling when the merge queue item is not found.
     * This can happen if the item was deleted between the domain event
     * emission and the enrichment broadcast.
     */
    it("should skip broadcast when merge queue item not found", () => {
      vi.spyOn(service, "getMergeQueueSnapshot").mockReturnValue(undefined);

      service.broadcastMergeQueueUpdate("deleted-item");

      expect(mockServer.emitCalls).toHaveLength(0);
    });

    /**
     * Validates error resilience for merge queue broadcasting.
     */
    it("should not throw when snapshot query fails", () => {
      vi.spyOn(service, "getMergeQueueSnapshot").mockImplementation(() => {
        throw new Error("DB error");
      });

      expect(() => service.broadcastMergeQueueUpdate("mqi-1")).not.toThrow();
    });
  });

  describe("queue depth broadcasting", () => {
    /**
     * Validates that queue depths are broadcast as a gauge with pending
     * job counts grouped by job type. This gives the UI a real-time
     * overview of system backpressure across all job categories.
     */
    it("should broadcast queue depths grouped by job type", () => {
      vi.spyOn(service, "getQueueDepthSnapshot").mockReturnValue({
        depths: {
          scheduler_tick: 2,
          worker_dispatch: 5,
          validation_execution: 1,
        },
        totalPending: 8,
      });

      service.broadcastQueueDepths();

      expect(mockServer.emitCalls).toHaveLength(1); // channel room only
      expect(mockServer.emitCalls[0]!.data.type).toBe("queue.depth_updated");
      expect(mockServer.emitCalls[0]!.data.channel).toBe(EventChannel.Queue);
      expect(mockServer.emitCalls[0]!.data.data).toEqual({
        depths: {
          scheduler_tick: 2,
          worker_dispatch: 5,
          validation_execution: 1,
        },
        totalPending: 8,
      });
    });

    /**
     * Validates that empty queue depths (no pending jobs) are still
     * broadcast. The UI needs this to show "all clear" states and
     * zero-value gauges.
     */
    it("should broadcast empty depths when no pending jobs", () => {
      vi.spyOn(service, "getQueueDepthSnapshot").mockReturnValue({
        depths: {},
        totalPending: 0,
      });

      service.broadcastQueueDepths();

      expect(mockServer.emitCalls).toHaveLength(1);
      expect(mockServer.emitCalls[0]!.data.data).toEqual({
        depths: {},
        totalPending: 0,
      });
    });

    /**
     * Validates error resilience for queue depth broadcasting.
     */
    it("should not throw when snapshot query fails", () => {
      vi.spyOn(service, "getQueueDepthSnapshot").mockImplementation(() => {
        throw new Error("DB timeout");
      });

      expect(() => service.broadcastQueueDepths()).not.toThrow();
    });
  });

  describe("periodic polling lifecycle", () => {
    /**
     * Validates that the polling interval triggers queue depth broadcasts
     * at the configured interval. Uses fake timers to verify the exact
     * timing without waiting for real time to pass.
     */
    it("should poll queue depths at the configured interval", () => {
      const spy = vi.spyOn(service, "getQueueDepthSnapshot").mockReturnValue({
        depths: {},
        totalPending: 0,
      });

      service.onModuleInit();

      // No immediate call
      expect(spy).not.toHaveBeenCalled();

      // First tick
      vi.advanceTimersByTime(QueueWorkerEventsService.QUEUE_DEPTH_INTERVAL_MS);
      expect(spy).toHaveBeenCalledTimes(1);

      // Second tick
      vi.advanceTimersByTime(QueueWorkerEventsService.QUEUE_DEPTH_INTERVAL_MS);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    /**
     * Validates that the polling interval is properly cleaned up on
     * module destroy. Without this, the interval would continue firing
     * after the application shuts down, causing errors.
     */
    it("should stop polling on module destroy", () => {
      const spy = vi.spyOn(service, "getQueueDepthSnapshot").mockReturnValue({
        depths: {},
        totalPending: 0,
      });

      service.onModuleInit();
      service.onModuleDestroy();

      vi.advanceTimersByTime(QueueWorkerEventsService.QUEUE_DEPTH_INTERVAL_MS * 3);
      expect(spy).not.toHaveBeenCalled();
    });

    /**
     * Validates that polling failures do not crash the interval loop.
     * If a single poll fails (e.g., transient DB error), subsequent
     * polls should still execute.
     */
    it("should survive polling failures and continue polling", () => {
      const spy = vi
        .spyOn(service, "getQueueDepthSnapshot")
        .mockImplementationOnce(() => {
          throw new Error("Transient DB error");
        })
        .mockReturnValue({ depths: {}, totalPending: 0 });

      service.onModuleInit();

      // First tick fails
      vi.advanceTimersByTime(QueueWorkerEventsService.QUEUE_DEPTH_INTERVAL_MS);
      expect(spy).toHaveBeenCalledTimes(1);

      // Second tick succeeds
      vi.advanceTimersByTime(QueueWorkerEventsService.QUEUE_DEPTH_INTERVAL_MS);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(mockServer.emitCalls).toHaveLength(1); // Only the successful one
    });
  });

  describe("throttle map cleanup", () => {
    /**
     * Validates that stale throttle entries are pruned during the periodic
     * polling cycle. Without cleanup, the heartbeat throttle map would
     * grow unboundedly as workers come and go, leaking memory.
     */
    it("should prune stale throttle entries during polling", () => {
      vi.spyOn(service, "getQueueDepthSnapshot").mockReturnValue({
        depths: {},
        totalPending: 0,
      });

      // Broadcast a heartbeat to create a throttle entry
      service.broadcastHeartbeat("worker-stale", { seq: 1 });
      mockServer.emitCalls.length = 0;

      service.onModuleInit();

      // Advance past the cleanup threshold (30s)
      vi.advanceTimersByTime(35_000);

      // The stale entry should have been cleaned up, so a new heartbeat
      // for the same worker should be broadcast (not throttled)
      const result = service.broadcastHeartbeat("worker-stale", { seq: 2 });
      expect(result).toBe(true);
    });

    /**
     * Validates that recent throttle entries are NOT pruned. Only entries
     * older than THROTTLE_CLEANUP_AGE_MS should be removed. The entry
     * must also still be within the heartbeat throttle window to verify
     * it wasn't removed by cleanup.
     */
    it("should keep recent throttle entries", () => {
      vi.spyOn(service, "getQueueDepthSnapshot").mockReturnValue({
        depths: {},
        totalPending: 0,
      });

      service.onModuleInit();

      // Advance a bit, then create a heartbeat entry
      vi.advanceTimersByTime(10_000);
      service.broadcastHeartbeat("worker-recent", { seq: 1 });
      mockServer.emitCalls.length = 0;

      // Advance 3s (entry is 3s old — within 5s throttle window AND within 30s cleanup threshold)
      vi.advanceTimersByTime(3_000);

      // Should still be throttled (entry not cleaned up AND within throttle window)
      const result = service.broadcastHeartbeat("worker-recent", { seq: 2 });
      expect(result).toBe(false);
    });
  });
});
