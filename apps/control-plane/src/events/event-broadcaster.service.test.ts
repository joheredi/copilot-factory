/**
 * Tests for the EventBroadcasterService.
 *
 * Validates that events are correctly broadcast to the right socket.io
 * rooms with proper event structure. The broadcaster is the public API
 * that all other modules use to emit real-time events — correctness here
 * ensures that task state changes, worker heartbeats, and queue updates
 * reach subscribed UI clients.
 *
 * Tests use a mock gateway with a mock socket.io server to verify
 * room targeting and event payload structure without actual WebSocket
 * connections.
 *
 * @module @factory/control-plane/events
 */
import type { Socket, Server } from "socket.io";
import { describe, expect, it, beforeEach, vi } from "vitest";

import { EventBroadcasterService } from "./event-broadcaster.service.js";
import { EventsGateway } from "./events.gateway.js";
import { EventChannel, FactoryEvent } from "./types.js";

/**
 * Create a mock socket.io server with room targeting.
 *
 * Records all emit calls per room so tests can assert which rooms
 * received which events. The `to()` method returns an object with
 * an `emit()` that captures the call.
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

describe("EventBroadcasterService", () => {
  let broadcaster: EventBroadcasterService;
  let gateway: EventsGateway;
  let mockServer: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    // Manually construct instances — the @WebSocketGateway decorator
    // doesn't work with NestJS Test.createTestingModule in unit tests
    // because the WebSocket infrastructure isn't bootstrapped.
    gateway = new EventsGateway();
    mockServer = createMockServer();
    gateway.server = mockServer as unknown as Server;
    broadcaster = new EventBroadcasterService(gateway);
  });

  describe("broadcastToChannel", () => {
    /**
     * Validates that channel broadcasts emit to the correct room.
     * This is the primary broadcast path — events must reach all
     * clients subscribed to a channel.
     */
    it("should emit event to the channel room", () => {
      broadcaster.broadcastToChannel(EventChannel.Tasks, {
        type: "task.created",
        data: { taskId: "t-1" },
      });

      expect(mockServer.to).toHaveBeenCalledWith(EventChannel.Tasks);
      expect(mockServer.emitCalls).toHaveLength(1);
      expect(mockServer.emitCalls[0]!.room).toBe(EventChannel.Tasks);
      expect(mockServer.emitCalls[0]!.event).toBe(EventBroadcasterService.EVENT_NAME);
    });

    /**
     * Validates that the event payload includes the channel and timestamp.
     * The broadcaster enriches partial events with channel and timestamp
     * so callers don't need to provide these fields every time.
     */
    it("should enrich event with channel and timestamp", () => {
      broadcaster.broadcastToChannel(EventChannel.Workers, {
        type: "worker.heartbeat",
        data: { workerId: "w-1" },
      });

      const emitted = mockServer.emitCalls[0]!.data;
      expect(emitted.channel).toBe(EventChannel.Workers);
      expect(emitted.type).toBe("worker.heartbeat");
      expect(emitted.data).toEqual({ workerId: "w-1" });
      expect(emitted.timestamp).toBeDefined();
      // Verify it's a valid ISO timestamp
      expect(Date.parse(emitted.timestamp)).not.toBeNaN();
    });

    /**
     * Validates that all three channels can receive broadcasts.
     * Ensures no channel is accidentally excluded from broadcasting.
     */
    it("should broadcast to all valid channels", () => {
      const channels = [EventChannel.Tasks, EventChannel.Workers, EventChannel.Queue];

      for (const channel of channels) {
        broadcaster.broadcastToChannel(channel, {
          type: "test.event",
          data: {},
        });
      }

      expect(mockServer.emitCalls).toHaveLength(3);
      expect(mockServer.emitCalls.map((c) => c.room)).toEqual(channels);
    });
  });

  describe("broadcastToEntity", () => {
    /**
     * Validates that entity broadcasts emit to both the entity room
     * AND the channel room. This dual-emit ensures that:
     * - Clients watching a specific entity get the event
     * - Clients watching the whole channel also get the event
     * Both audiences must be served for the UI to work correctly.
     */
    it("should emit to both entity room and channel room", () => {
      broadcaster.broadcastToEntity(EventChannel.Tasks, "task-abc", {
        type: "task.state_changed",
        data: { from: "queued", to: "assigned" },
      });

      expect(mockServer.emitCalls).toHaveLength(2);
      // First call: entity room
      expect(mockServer.emitCalls[0]!.room).toBe("tasks:task-abc");
      // Second call: channel room
      expect(mockServer.emitCalls[1]!.room).toBe(EventChannel.Tasks);
    });

    /**
     * Validates that entity broadcast events include the entityId.
     * Without entityId, clients subscribed to a channel cannot filter
     * events for specific entities they're displaying.
     */
    it("should include entityId in the event payload", () => {
      broadcaster.broadcastToEntity(EventChannel.Workers, "worker-42", {
        type: "worker.status_changed",
        data: { status: "idle" },
      });

      const emitted = mockServer.emitCalls[0]!.data;
      expect(emitted.entityId).toBe("worker-42");
      expect(emitted.channel).toBe(EventChannel.Workers);
      expect(emitted.type).toBe("worker.status_changed");
    });

    /**
     * Validates that both entity room and channel room events have
     * identical payloads. Clients must receive the same data regardless
     * of which room they're subscribed to.
     */
    it("should emit identical events to both rooms", () => {
      broadcaster.broadcastToEntity(EventChannel.Queue, "merge-99", {
        type: "queue.item_added",
        data: { position: 3 },
      });

      const entityEvent = mockServer.emitCalls[0]!.data;
      const channelEvent = mockServer.emitCalls[1]!.data;
      expect(entityEvent).toEqual(channelEvent);
    });
  });

  describe("graceful handling when server is not ready", () => {
    /**
     * Validates that broadcasting before the server is initialized
     * does not throw. During app startup, the gateway's server may
     * not be set yet — broadcasts must be silently dropped, not crash.
     */
    it("should not throw when server is undefined", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Server type requires full socket.io initialization
      gateway.server = undefined as any;

      expect(() =>
        broadcaster.broadcastToChannel(EventChannel.Tasks, {
          type: "test",
          data: {},
        }),
      ).not.toThrow();
    });

    /**
     * Validates entity broadcast also handles missing server gracefully.
     */
    it("should not throw entity broadcast when server is undefined", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Server type requires full socket.io initialization
      gateway.server = undefined as any;

      expect(() =>
        broadcaster.broadcastToEntity(EventChannel.Tasks, "t-1", {
          type: "test",
          data: {},
        }),
      ).not.toThrow();
    });
  });

  describe("getConnectedClientCount", () => {
    /**
     * Validates that the broadcaster delegates client count to the gateway.
     * This allows other modules to check connection status via the
     * broadcaster without accessing the gateway directly.
     */
    it("should delegate to gateway", () => {
      expect(broadcaster.getConnectedClientCount()).toBe(0);

      // Simulate connections through gateway
      gateway.handleConnection({ id: "c-1", join: vi.fn(), leave: vi.fn() } as unknown as Socket);
      expect(broadcaster.getConnectedClientCount()).toBe(1);
    });
  });
});
