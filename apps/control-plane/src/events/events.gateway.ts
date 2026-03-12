/**
 * WebSocket gateway for real-time event delivery to UI clients.
 *
 * Uses socket.io via NestJS @WebSocketGateway to manage client connections,
 * channel subscriptions, and room-based event routing. Clients subscribe to
 * channels ({@link EventChannel}) and optionally to entity-specific rooms
 * for fine-grained updates.
 *
 * Connection lifecycle:
 * 1. Client connects via socket.io
 * 2. Client sends "subscribe" messages to join channels/rooms
 * 3. Server broadcasts events to subscribed rooms
 * 4. Client sends "unsubscribe" to leave rooms
 * 5. On disconnect, client is automatically removed from all rooms
 *
 * @see docs/prd/007-technical-architecture.md §7.7 for event architecture
 * @module @factory/control-plane/events
 */
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";

import { EventChannel, EVENT_CHANNELS, buildEntityRoom } from "./types.js";
import type { SubscriptionRequest, SubscriptionResponse } from "./types.js";

/**
 * WebSocket gateway that manages real-time event delivery.
 *
 * Runs on the same port as the HTTP server (via socket.io's transport
 * upgrade mechanism). Supports CORS for local UI development.
 *
 * Clients interact via two message types:
 * - "subscribe": Join a channel and/or entity-specific room
 * - "unsubscribe": Leave a channel and/or entity-specific room
 *
 * Events are broadcast to rooms by the {@link EventBroadcasterService},
 * not directly by this gateway. This gateway only handles connection
 * management and subscription routing.
 */
@WebSocketGateway({
  cors: {
    origin: [/^http:\/\/localhost(:\d+)?$/],
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  /** socket.io server instance, injected by NestJS after initialization. */
  @WebSocketServer()
  server!: Server;

  /** Track connected client IDs for observability. */
  private readonly connectedClients = new Set<string>();

  /**
   * Handle new client connection.
   *
   * Registers the client in the connected set. Clients must explicitly
   * subscribe to channels after connecting — no auto-subscriptions.
   *
   * @param client - The connecting socket.io client
   */
  handleConnection(client: Socket): void {
    this.connectedClients.add(client.id);
  }

  /**
   * Handle client disconnection.
   *
   * Removes the client from the connected set. socket.io automatically
   * removes the client from all rooms on disconnect.
   *
   * @param client - The disconnecting socket.io client
   */
  handleDisconnect(client: Socket): void {
    this.connectedClients.delete(client.id);
  }

  /**
   * Handle subscription requests from clients.
   *
   * Validates the requested channel, then joins the client to:
   * 1. The channel room (e.g., "tasks") — receives all events on that channel
   * 2. Optionally, an entity room (e.g., "tasks:abc-123") — receives
   *    entity-specific events
   *
   * @param client - The requesting socket.io client
   * @param request - Subscription request with channel and optional entityId
   * @returns Subscription response indicating success/failure and joined rooms
   */
  @SubscribeMessage("subscribe")
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() request: Record<string, unknown>,
  ): SubscriptionResponse {
    const sub = request as unknown as SubscriptionRequest;
    if (!sub || !sub.channel) {
      return { success: false, rooms: [], error: "Missing channel in subscription request" };
    }

    if (!EVENT_CHANNELS.includes(sub.channel)) {
      return {
        success: false,
        rooms: [],
        error: `Invalid channel "${sub.channel}". Valid channels: ${EVENT_CHANNELS.join(", ")}`,
      };
    }

    const channel = sub.channel as EventChannel;
    const rooms: string[] = [channel];
    client.join(channel);

    if (sub.entityId) {
      const entityRoom = buildEntityRoom(channel, sub.entityId);
      client.join(entityRoom);
      rooms.push(entityRoom);
    }

    return { success: true, rooms };
  }

  /**
   * Handle unsubscription requests from clients.
   *
   * Removes the client from the specified channel and/or entity room.
   *
   * @param client - The requesting socket.io client
   * @param request - Unsubscription request with channel and optional entityId
   * @returns Subscription response indicating success/failure and left rooms
   */
  @SubscribeMessage("unsubscribe")
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() request: Record<string, unknown>,
  ): SubscriptionResponse {
    const sub = request as unknown as SubscriptionRequest;
    if (!sub || !sub.channel) {
      return { success: false, rooms: [], error: "Missing channel in unsubscription request" };
    }

    if (!EVENT_CHANNELS.includes(sub.channel)) {
      return {
        success: false,
        rooms: [],
        error: `Invalid channel "${sub.channel}". Valid channels: ${EVENT_CHANNELS.join(", ")}`,
      };
    }

    const channel = sub.channel as EventChannel;
    const rooms: string[] = [channel];
    client.leave(channel);

    if (sub.entityId) {
      const entityRoom = buildEntityRoom(channel, sub.entityId);
      client.leave(entityRoom);
      rooms.push(entityRoom);
    }

    return { success: true, rooms };
  }

  /**
   * Get the number of currently connected clients.
   *
   * Useful for health checks and observability.
   *
   * @returns Number of connected WebSocket clients
   */
  getConnectedClientCount(): number {
    return this.connectedClients.size;
  }
}
