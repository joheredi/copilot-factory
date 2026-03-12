/**
 * Event types for the WebSocket gateway real-time event system.
 *
 * Defines the core event structure and channel taxonomy used for
 * broadcasting live updates to connected UI clients. All events
 * flowing through the WebSocket gateway conform to {@link FactoryEvent}.
 *
 * Channels map to the major domain entities that produce live updates:
 * - tasks: task state changes, progress updates
 * - workers: worker heartbeats, status changes
 * - queue: merge queue updates, scheduling changes
 *
 * @see docs/prd/007-technical-architecture.md §7.7 for event architecture
 * @module @factory/control-plane/events
 */

/**
 * Channels that clients can subscribe to for receiving events.
 *
 * Each channel corresponds to a domain aggregate that produces real-time
 * updates. Clients join socket.io rooms named after these channels, and
 * optionally join entity-specific rooms (e.g., `tasks:abc-123`) for
 * fine-grained subscriptions.
 */
export enum EventChannel {
  /** Task lifecycle events — state transitions, progress, errors. */
  Tasks = "tasks",
  /** Worker events — heartbeats, status changes, pool updates. */
  Workers = "workers",
  /** Queue events — merge queue changes, scheduling updates. */
  Queue = "queue",
}

/** All valid channel values as a readonly array for runtime validation. */
export const EVENT_CHANNELS = Object.values(EventChannel) as readonly string[];

/**
 * Structured event payload delivered to WebSocket clients.
 *
 * Every event has a type discriminator, an optional entity identifier
 * for entity-specific subscriptions, the data payload, and a timestamp.
 * This shape is the contract between the server-side {@link EventBroadcasterService}
 * and all WebSocket clients.
 *
 * @example
 * ```json
 * {
 *   "type": "task.state_changed",
 *   "channel": "tasks",
 *   "entityId": "task-abc-123",
 *   "data": { "fromState": "queued", "toState": "assigned" },
 *   "timestamp": "2026-03-12T05:30:00.000Z"
 * }
 * ```
 */
export interface FactoryEvent {
  /** Dot-delimited event type discriminator (e.g., "task.state_changed"). */
  type: string;
  /** Channel this event belongs to. */
  channel: EventChannel;
  /** Identifier of the entity that produced the event, if applicable. */
  entityId?: string;
  /** Arbitrary event payload. */
  data: Record<string, unknown>;
  /** ISO 8601 timestamp of when the event was created. */
  timestamp: string;
}

/**
 * Subscription request sent by clients to join a channel or entity room.
 *
 * Clients send this via the "subscribe" message type. If only `channel`
 * is provided, the client receives all events on that channel. If
 * `entityId` is also provided, the client additionally joins the
 * entity-specific room for targeted updates.
 */
export interface SubscriptionRequest {
  /** Channel to subscribe to. Must be a valid {@link EventChannel}. */
  channel: string;
  /** Optional entity ID for entity-specific subscriptions. */
  entityId?: string;
}

/**
 * Response sent back to clients after a subscribe/unsubscribe operation.
 */
export interface SubscriptionResponse {
  /** Whether the operation succeeded. */
  success: boolean;
  /** The room(s) the client was subscribed to or unsubscribed from. */
  rooms: string[];
  /** Error message if the operation failed. */
  error?: string;
}

/**
 * Build a room name for an entity-specific subscription.
 *
 * Combines the channel and entity ID into a colon-separated room name
 * used by socket.io for targeted event delivery.
 *
 * @param channel - The event channel
 * @param entityId - The entity identifier
 * @returns Room name in the format "channel:entityId"
 */
export function buildEntityRoom(channel: EventChannel, entityId: string): string {
  return `${channel}:${entityId}`;
}
