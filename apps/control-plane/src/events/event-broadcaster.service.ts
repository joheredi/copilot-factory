/**
 * Service for broadcasting events to WebSocket clients.
 *
 * This is the public API that the rest of the application uses to emit
 * real-time events. Other modules inject {@link EventBroadcasterService}
 * and call its broadcast methods — they never interact with the gateway
 * or socket.io server directly.
 *
 * Event routing:
 * - Channel events go to the channel room (e.g., "tasks")
 * - Entity events go to both the channel room AND the entity-specific
 *   room (e.g., "tasks" + "tasks:abc-123"), so clients subscribed to
 *   either receive the event.
 *
 * @see docs/prd/007-technical-architecture.md §7.7 for event architecture
 * @module @factory/control-plane/events
 */
import { Injectable } from "@nestjs/common";

import { EventsGateway } from "./events.gateway.js";
import { EventChannel, FactoryEvent, buildEntityRoom } from "./types.js";

/**
 * Broadcasts structured events to subscribed WebSocket clients.
 *
 * Depends on {@link EventsGateway} for access to the socket.io server
 * instance. Events are delivered as socket.io messages with the
 * "factory_event" event name.
 *
 * Usage from other modules:
 * ```typescript
 * this.broadcaster.broadcastToChannel(EventChannel.Tasks, {
 *   type: "task.state_changed",
 *   channel: EventChannel.Tasks,
 *   data: { fromState: "queued", toState: "assigned" },
 *   timestamp: new Date().toISOString(),
 * });
 * ```
 */
@Injectable()
export class EventBroadcasterService {
  /** socket.io event name used for all factory events. */
  static readonly EVENT_NAME = "factory_event";

  constructor(private readonly gateway: EventsGateway) {}

  /**
   * Broadcast an event to all clients subscribed to a channel.
   *
   * Sends the event to the channel room. All clients that have
   * subscribed to this channel will receive it.
   *
   * @param channel - Target channel
   * @param event - Event payload (must include type and data at minimum)
   */
  broadcastToChannel(
    channel: EventChannel,
    event: Omit<FactoryEvent, "channel" | "timestamp"> & { timestamp?: string },
  ): void {
    const fullEvent: FactoryEvent = {
      ...event,
      channel,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };

    this.gateway.server?.to(channel).emit(EventBroadcasterService.EVENT_NAME, fullEvent);
  }

  /**
   * Broadcast an event to a specific entity's subscribers within a channel.
   *
   * Sends the event to both:
   * 1. The entity-specific room (e.g., "tasks:abc-123")
   * 2. The channel room (e.g., "tasks")
   *
   * This ensures clients subscribed to the broad channel also receive
   * entity-specific events, while clients subscribed to a specific
   * entity get targeted delivery.
   *
   * @param channel - Target channel
   * @param entityId - Entity identifier for room targeting
   * @param event - Event payload (must include type and data at minimum)
   */
  broadcastToEntity(
    channel: EventChannel,
    entityId: string,
    event: Omit<FactoryEvent, "channel" | "entityId" | "timestamp"> & { timestamp?: string },
  ): void {
    const fullEvent: FactoryEvent = {
      ...event,
      channel,
      entityId,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };

    const entityRoom = buildEntityRoom(channel, entityId);

    // Emit to entity-specific room and channel room
    this.gateway.server?.to(entityRoom).emit(EventBroadcasterService.EVENT_NAME, fullEvent);
    this.gateway.server?.to(channel).emit(EventBroadcasterService.EVENT_NAME, fullEvent);
  }

  /**
   * Get the number of currently connected WebSocket clients.
   *
   * Delegates to the gateway's client tracking for observability.
   *
   * @returns Number of connected clients
   */
  getConnectedClientCount(): number {
    return this.gateway.getConnectedClientCount();
  }
}
