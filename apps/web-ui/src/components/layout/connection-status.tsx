import { cn } from "../../lib/utils";
import { Wifi, WifiOff } from "lucide-react";

/**
 * Props for the ConnectionStatus component.
 */
export interface ConnectionStatusProps {
  /** Whether the WebSocket connection is currently active. */
  connected: boolean;
}

/**
 * WebSocket connection status indicator.
 *
 * Displays a small icon with a colored dot to indicate whether the
 * real-time WebSocket connection to the control plane is active.
 * Green = connected, amber = disconnected.
 *
 * This is placed in the sidebar footer so operators always have
 * visibility into whether they are receiving live updates.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — UI real-time status
 */
export function ConnectionStatus({ connected }: ConnectionStatusProps) {
  return (
    <div
      className="flex items-center gap-2 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
      aria-label={connected ? "Connected to server" : "Disconnected from server"}
    >
      {connected ? (
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
          <span>Connected</span>
        </>
      ) : (
        <>
          <span className="relative flex h-2 w-2">
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          <WifiOff className="h-3 w-3" />
          <span>Disconnected</span>
        </>
      )}
    </div>
  );
}
