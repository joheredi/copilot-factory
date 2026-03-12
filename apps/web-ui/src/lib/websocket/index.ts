/**
 * Public API for the WebSocket real-time event module.
 *
 * Re-exports the provider, hook, types, and invalidation utilities needed
 * by the rest of the application. Internal implementation details (socket
 * management, context internals) are not exported.
 *
 * @module @factory/web-ui/lib/websocket
 */

export { WebSocketProvider } from "./provider";
export type { WebSocketProviderProps } from "./provider";
export { useWebSocket } from "./use-websocket";
export { invalidateQueriesForEvent, getInvalidationKeys } from "./invalidation";
export type { ConnectionState, FactoryEvent, EventChannel, WebSocketContextValue } from "./types";
export { FACTORY_EVENT_NAME } from "./types";
export { EventChannel as EventChannelEnum } from "./types";
