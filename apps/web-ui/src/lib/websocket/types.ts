/**
 * WebSocket event types mirroring the backend event contract.
 *
 * These types define the client-side representation of the real-time event
 * system. They match the server-side definitions in
 * `apps/control-plane/src/events/types.ts` so that clients can safely
 * decode incoming events.
 *
 * @see docs/prd/007-technical-architecture.md §7.7 — event architecture
 * @module @factory/web-ui/lib/websocket/types
 */

/**
 * Connection state for the WebSocket client.
 *
 * Three-state model so the UI can distinguish between a healthy connection,
 * a transient reconnection attempt (where data may be stale), and a full
 * disconnect (where live updates are not flowing).
 */
export type ConnectionState = "connected" | "reconnecting" | "disconnected";

/**
 * Channels that clients can subscribe to for receiving events.
 *
 * Mirrors the backend {@link EventChannel} enum. Each channel corresponds
 * to a domain aggregate that produces real-time updates.
 */
export enum EventChannel {
  /** Task lifecycle events — state transitions, progress, errors. */
  Tasks = "tasks",
  /** Worker events — heartbeats, status changes, pool updates. */
  Workers = "workers",
  /** Queue events — merge queue changes, scheduling updates. */
  Queue = "queue",
}

/**
 * Structured event payload delivered by the WebSocket server.
 *
 * This is the client-side mirror of the server's `FactoryEvent` interface.
 * Every event received on the `"factory_event"` socket.io message conforms
 * to this shape.
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
 * Subscription request sent by the client to join a channel or entity room.
 */
export interface SubscriptionRequest {
  /** Channel to subscribe to. Must be a valid {@link EventChannel}. */
  channel: string;
  /** Optional entity ID for entity-specific subscriptions. */
  entityId?: string;
}

/**
 * Callback signature for components that need direct access to factory events.
 *
 * Used by {@link WebSocketContextValue.addListener} for streaming use-cases
 * (e.g., worker stdout) where query-cache invalidation is not sufficient.
 */
export type FactoryEventListener = (event: FactoryEvent) => void;

/**
 * Context value provided by {@link WebSocketProvider}.
 *
 * Exposes connection state and subscription management to consuming components.
 */
export interface WebSocketContextValue {
  /** Current connection state. */
  state: ConnectionState;
  /** Subscribe to a channel and optionally an entity-specific room. */
  subscribe: (channel: EventChannel, entityId?: string) => void;
  /** Unsubscribe from a channel and optionally an entity-specific room. */
  unsubscribe: (channel: EventChannel, entityId?: string) => void;
  /**
   * Register a callback that receives every incoming {@link FactoryEvent}.
   * Useful for streaming use-cases (e.g., worker output) where the
   * consumer needs the raw event payload, not just cache invalidation.
   */
  addListener: (listener: FactoryEventListener) => void;
  /** Remove a previously registered event listener. */
  removeListener: (listener: FactoryEventListener) => void;
}

/**
 * The socket.io event name used by the backend to emit all factory events.
 *
 * All events are multiplexed through this single event name, with the
 * `type` and `channel` fields inside the payload used for routing.
 */
export const FACTORY_EVENT_NAME = "factory_event";
