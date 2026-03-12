/**
 * Tests for the WebSocket EventsGateway.
 *
 * Validates connection management, channel subscriptions, and error handling
 * for the real-time event delivery gateway. These tests ensure that clients
 * can connect, subscribe to channels and entity rooms, and that invalid
 * requests are rejected gracefully.
 *
 * The gateway is the entry point for all WebSocket clients — correctness
 * here is critical for the entire real-time event pipeline (T087, T088).
 *
 * @module @factory/control-plane/events
 */
import { Test, TestingModule } from "@nestjs/testing";
import type { Socket } from "socket.io";
import { describe, expect, it, beforeEach, vi } from "vitest";

import { EventsGateway } from "./events.gateway.js";
import { EventChannel } from "./types.js";

/**
 * Create a mock socket.io Socket for testing.
 *
 * Returns an object that satisfies the Socket interface methods used by
 * the gateway (id, join, leave), backed by vitest mock functions.
 */
function createMockClient(id = "test-client-1") {
  return {
    id,
    join: vi.fn(),
    leave: vi.fn(),
  } as unknown as Socket;
}

describe("EventsGateway", () => {
  let gateway: EventsGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EventsGateway],
    }).compile();

    gateway = module.get<EventsGateway>(EventsGateway);
  });

  describe("connection management", () => {
    /**
     * Validates that connecting clients are tracked.
     * Without connection tracking, we cannot report connected client
     * count for observability and health checks.
     */
    it("should track connected clients", () => {
      const client = createMockClient("client-1");
      gateway.handleConnection(client);

      expect(gateway.getConnectedClientCount()).toBe(1);
    });

    /**
     * Validates that multiple simultaneous connections are tracked correctly.
     * The gateway must support many concurrent clients for real-time updates
     * to work across multiple browser tabs or users.
     */
    it("should track multiple connected clients", () => {
      gateway.handleConnection(createMockClient("client-1"));
      gateway.handleConnection(createMockClient("client-2"));
      gateway.handleConnection(createMockClient("client-3"));

      expect(gateway.getConnectedClientCount()).toBe(3);
    });

    /**
     * Validates that disconnecting clients are removed from tracking.
     * Stale client tracking would cause incorrect observability metrics
     * and potential memory leaks over time.
     */
    it("should remove disconnected clients", () => {
      const client = createMockClient("client-1");
      gateway.handleConnection(client);
      gateway.handleDisconnect(client);

      expect(gateway.getConnectedClientCount()).toBe(0);
    });

    /**
     * Validates that only the disconnecting client is removed.
     * A bug here would cause all clients to appear disconnected when
     * one drops — breaking event delivery for remaining clients.
     */
    it("should only remove the disconnecting client", () => {
      const client1 = createMockClient("client-1");
      const client2 = createMockClient("client-2");
      gateway.handleConnection(client1);
      gateway.handleConnection(client2);
      gateway.handleDisconnect(client1);

      expect(gateway.getConnectedClientCount()).toBe(1);
    });

    /**
     * Validates graceful handling of disconnecting an unknown client.
     * Race conditions or network issues could cause disconnect events
     * for clients that were never tracked — this must not throw.
     */
    it("should handle disconnect for unknown client gracefully", () => {
      const client = createMockClient("unknown");
      expect(() => gateway.handleDisconnect(client)).not.toThrow();
      expect(gateway.getConnectedClientCount()).toBe(0);
    });
  });

  describe("subscribe", () => {
    /**
     * Validates that subscribing to a valid channel joins the channel room.
     * This is the core subscription mechanism — without it, clients
     * would never receive any events.
     */
    it("should join client to channel room on valid subscription", () => {
      const client = createMockClient();
      const result = gateway.handleSubscribe(client, {
        channel: EventChannel.Tasks,
      });

      expect(result.success).toBe(true);
      expect(result.rooms).toContain(EventChannel.Tasks);
      expect(client.join).toHaveBeenCalledWith(EventChannel.Tasks);
    });

    /**
     * Validates that subscribing with an entityId also joins the
     * entity-specific room. This enables targeted event delivery for
     * views that watch a single entity (e.g., task detail page).
     */
    it("should join client to entity room when entityId is provided", () => {
      const client = createMockClient();
      const result = gateway.handleSubscribe(client, {
        channel: EventChannel.Tasks,
        entityId: "task-123",
      });

      expect(result.success).toBe(true);
      expect(result.rooms).toEqual([EventChannel.Tasks, "tasks:task-123"]);
      expect(client.join).toHaveBeenCalledWith(EventChannel.Tasks);
      expect(client.join).toHaveBeenCalledWith("tasks:task-123");
    });

    /**
     * Validates that all three channels (tasks, workers, queue) are
     * accepted. The gateway must support the full channel taxonomy
     * defined in the architecture.
     */
    it("should accept all valid channels", () => {
      const client = createMockClient();

      for (const channel of [EventChannel.Tasks, EventChannel.Workers, EventChannel.Queue]) {
        const result = gateway.handleSubscribe(client, { channel });
        expect(result.success).toBe(true);
        expect(result.rooms).toContain(channel);
      }
    });

    /**
     * Validates that invalid channel names are rejected.
     * Without this check, clients could subscribe to arbitrary rooms,
     * bypassing the channel taxonomy and potentially leaking events.
     */
    it("should reject invalid channel names", () => {
      const client = createMockClient();
      const result = gateway.handleSubscribe(client, {
        channel: "invalid-channel",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid channel");
      expect(client.join).not.toHaveBeenCalled();
    });

    /**
     * Validates that missing channel in request is rejected.
     * Malformed client messages must not cause server-side errors.
     */
    it("should reject subscription with missing channel", () => {
      const client = createMockClient();
      const result = gateway.handleSubscribe(client, {} as Record<string, unknown>);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing channel");
    });

    /**
     * Validates that null/undefined request body is handled.
     * WebSocket messages can arrive malformed — the gateway must
     * handle this gracefully without throwing.
     */
    it("should reject null subscription request", () => {
      const client = createMockClient();
      const result = gateway.handleSubscribe(client, null as unknown as Record<string, unknown>);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing channel");
    });
  });

  describe("unsubscribe", () => {
    /**
     * Validates that unsubscribing leaves the channel room.
     * Without proper unsubscription, clients would continue receiving
     * events for channels they no longer care about, wasting bandwidth.
     */
    it("should leave channel room on valid unsubscription", () => {
      const client = createMockClient();
      const result = gateway.handleUnsubscribe(client, {
        channel: EventChannel.Workers,
      });

      expect(result.success).toBe(true);
      expect(result.rooms).toContain(EventChannel.Workers);
      expect(client.leave).toHaveBeenCalledWith(EventChannel.Workers);
    });

    /**
     * Validates that unsubscribing with entityId also leaves the
     * entity-specific room in addition to the channel room.
     */
    it("should leave entity room when entityId is provided", () => {
      const client = createMockClient();
      const result = gateway.handleUnsubscribe(client, {
        channel: EventChannel.Queue,
        entityId: "merge-456",
      });

      expect(result.success).toBe(true);
      expect(result.rooms).toEqual([EventChannel.Queue, "queue:merge-456"]);
      expect(client.leave).toHaveBeenCalledWith(EventChannel.Queue);
      expect(client.leave).toHaveBeenCalledWith("queue:merge-456");
    });

    /**
     * Validates that invalid channels are rejected on unsubscribe too.
     * Consistency between subscribe and unsubscribe validation prevents
     * subtle bugs where clients can unsubscribe from rooms they couldn't
     * subscribe to.
     */
    it("should reject invalid channel on unsubscribe", () => {
      const client = createMockClient();
      const result = gateway.handleUnsubscribe(client, {
        channel: "bad-channel",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid channel");
    });

    /**
     * Validates that missing channel in unsubscribe request is rejected.
     */
    it("should reject unsubscribe with missing channel", () => {
      const client = createMockClient();
      const result = gateway.handleUnsubscribe(client, {} as Record<string, unknown>);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing channel");
    });
  });
});
