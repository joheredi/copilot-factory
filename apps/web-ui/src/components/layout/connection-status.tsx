import { cn } from "../../lib/utils";
import { Wifi, WifiOff } from "lucide-react";
import type { ConnectionState } from "../../lib/websocket/types";

/**
 * Props for the ConnectionStatus component.
 */
export interface ConnectionStatusProps {
  /**
   * Current WebSocket connection state.
   *
   * - `"connected"` — live updates are flowing (green indicator)
   * - `"reconnecting"` — temporarily lost, attempting to restore (amber pulsing)
   * - `"disconnected"` — no connection, live updates are not available (red indicator)
   */
  status: ConnectionState;
}

/** Aria labels for each connection state. */
const ARIA_LABELS: Record<ConnectionState, string> = {
  connected: "Connected to server",
  reconnecting: "Reconnecting to server",
  disconnected: "Disconnected from server",
};

/** Display labels for each connection state. */
const STATUS_LABELS: Record<ConnectionState, string> = {
  connected: "Connected",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected",
};

/**
 * WebSocket connection status indicator.
 *
 * Displays a small icon with a colored dot to indicate the real-time
 * WebSocket connection state to the control plane.
 * Green = connected, amber (pulsing) = reconnecting, red = disconnected.
 *
 * This is placed in the sidebar footer so operators always have
 * visibility into whether they are receiving live updates.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — UI real-time status
 */
export function ConnectionStatus({ status }: ConnectionStatusProps) {
  return (
    <div
      className="flex items-center gap-2 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
      aria-label={ARIA_LABELS[status]}
    >
      {status === "connected" && (
        <>
          <span className="relative flex h-2 w-2">
            <span
              className={cn(
                "absolute inline-flex h-full w-full rounded-full opacity-75",
                "animate-ping bg-green-400",
              )}
            />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          <Wifi className="h-3 w-3" />
        </>
      )}
      {status === "reconnecting" && (
        <>
          <span className="relative flex h-2 w-2">
            <span
              className={cn(
                "absolute inline-flex h-full w-full rounded-full opacity-75",
                "animate-ping bg-amber-400",
              )}
            />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          <Wifi className="h-3 w-3" />
        </>
      )}
      {status === "disconnected" && (
        <>
          <span className="relative flex h-2 w-2">
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          <WifiOff className="h-3 w-3" />
        </>
      )}
      <span>{STATUS_LABELS[status]}</span>
    </div>
  );
}
