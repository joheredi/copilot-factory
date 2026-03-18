/**
 * WebSocket context provider for real-time event delivery.
 *
 * Manages a single socket.io connection to the control-plane backend,
 * auto-subscribes to all event channels, and invalidates TanStack Query
 * caches when domain events arrive. Components consume connection state
 * via the {@link useWebSocket} hook.
 *
 * The provider follows the same pattern as {@link ApiProvider} — it wraps
 * the component tree and provides a context value. It connects on mount,
 * handles reconnection with exponential backoff (built into socket.io),
 * and disconnects on unmount.
 *
 * @see docs/prd/007-technical-architecture.md §7.7 — event architecture
 * @module @factory/web-ui/lib/websocket/provider
 */

import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ConnectionState,
  FactoryEvent,
  FactoryEventListener,
  SubscriptionRequest,
  WebSocketContextValue,
} from "./types";
import { EventChannel, FACTORY_EVENT_NAME } from "./types";
import { invalidateQueriesForEvent } from "./invalidation";

/**
 * React context for WebSocket state. Null when no provider is mounted.
 *
 * @internal Consumed via {@link useWebSocket} — never access directly.
 */
export const WebSocketContext = createContext<WebSocketContextValue | null>(null);

/**
 * Props for the {@link WebSocketProvider} component.
 */
export interface WebSocketProviderProps {
  /** Child components that can consume the WebSocket context. */
  children: ReactNode;
  /**
   * Base URL for the socket.io connection. Defaults to the window origin
   * (which works with the Vite dev proxy).
   *
   * Override this in tests or when the backend is on a different host.
   */
  url?: string;
  /**
   * Whether to auto-connect on mount. Defaults to true.
   * Set to false in tests where you don't want a real connection.
   */
  autoConnect?: boolean;
}

/**
 * Default channels to subscribe to on connection.
 *
 * The client subscribes to all three channels so that the UI receives
 * a comprehensive stream of domain events for cache invalidation.
 */
const DEFAULT_CHANNELS: readonly EventChannel[] = [
  EventChannel.Tasks,
  EventChannel.Workers,
  EventChannel.Queue,
];

/**
 * WebSocket provider that manages a socket.io connection and provides
 * real-time event delivery to the component tree.
 *
 * On mount, the provider:
 * 1. Opens a socket.io connection to the backend
 * 2. Subscribes to all default event channels
 * 3. Listens for `factory_event` messages and invalidates query caches
 * 4. Exposes connection state via React context
 *
 * On unmount, it cleanly disconnects.
 *
 * @example
 * ```tsx
 * <ApiProvider>
 *   <WebSocketProvider>
 *     <RouterProvider router={router} />
 *   </WebSocketProvider>
 * </ApiProvider>
 * ```
 */
export function WebSocketProvider({ children, url, autoConnect = true }: WebSocketProviderProps) {
  const [state, setState] = useState<ConnectionState>("disconnected");
  const socketRef = useRef<Socket | null>(null);
  const listenersRef = useRef<Set<FactoryEventListener>>(new Set());
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!autoConnect) return;

    const socket = io(url ?? window.location.origin, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      withCredentials: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setState("connected");
      // Subscribe to all default channels on connect/reconnect
      for (const channel of DEFAULT_CHANNELS) {
        const request: SubscriptionRequest = { channel };
        socket.emit("subscribe", request);
      }
    });

    socket.on("disconnect", () => {
      setState("disconnected");
    });

    socket.on("reconnect_attempt", () => {
      setState("reconnecting");
    });

    socket.on(FACTORY_EVENT_NAME, (event: FactoryEvent) => {
      invalidateQueriesForEvent(queryClient, event);
      for (const listener of listenersRef.current) {
        listener(event);
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [autoConnect, url, queryClient]);

  const subscribe = useCallback((channel: EventChannel, entityId?: string) => {
    const socket = socketRef.current;
    if (socket?.connected) {
      const request: SubscriptionRequest = { channel, entityId };
      socket.emit("subscribe", request);
    }
  }, []);

  const unsubscribe = useCallback((channel: EventChannel, entityId?: string) => {
    const socket = socketRef.current;
    if (socket?.connected) {
      const request: SubscriptionRequest = { channel, entityId };
      socket.emit("unsubscribe", request);
    }
  }, []);

  const addListener = useCallback((listener: FactoryEventListener) => {
    listenersRef.current.add(listener);
  }, []);

  const removeListener = useCallback((listener: FactoryEventListener) => {
    listenersRef.current.delete(listener);
  }, []);

  const contextValue: WebSocketContextValue = {
    state,
    subscribe,
    unsubscribe,
    addListener,
    removeListener,
  };

  return <WebSocketContext.Provider value={contextValue}>{children}</WebSocketContext.Provider>;
}
