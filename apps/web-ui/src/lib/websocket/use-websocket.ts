/**
 * Hook for consuming WebSocket connection state and subscription controls.
 *
 * Returns the current connection state (connected / reconnecting / disconnected)
 * and functions to subscribe/unsubscribe to event channels. Components use this
 * to display connection status or to subscribe to entity-specific updates.
 *
 * Must be used within a {@link WebSocketProvider}. Throws if the context is
 * not available (programming error — means the provider was not mounted).
 *
 * @see docs/prd/007-technical-architecture.md §7.7 — event architecture
 * @module @factory/web-ui/lib/websocket/use-websocket
 */

import { useContext } from "react";
import type { WebSocketContextValue } from "./types";
import { WebSocketContext } from "./provider";

/**
 * Access the WebSocket connection state and subscription controls.
 *
 * @returns The current {@link WebSocketContextValue} from the nearest
 *   {@link WebSocketProvider} ancestor.
 * @throws Error if called outside a WebSocketProvider — this is always
 *   a programming error (the provider should wrap the app shell).
 *
 * @example
 * ```tsx
 * function StatusBar() {
 *   const { state } = useWebSocket();
 *   return <ConnectionStatus status={state} />;
 * }
 * ```
 */
export function useWebSocket(): WebSocketContextValue {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error(
      "useWebSocket must be used within a WebSocketProvider. " +
        "Wrap your component tree with <WebSocketProvider>.",
    );
  }
  return context;
}
