import { RouterProvider } from "react-router-dom";
import { router } from "./app/routes";
import { ApiProvider } from "./api/provider";
import { WebSocketProvider } from "./lib/websocket";

/**
 * Root application component.
 *
 * Wraps the router with the TanStack Query {@link ApiProvider} and the
 * {@link WebSocketProvider} so that all route-level components can use
 * data-fetching hooks and receive real-time updates via WebSocket.
 *
 * Provider ordering matters:
 * 1. {@link ApiProvider} — creates the QueryClient
 * 2. {@link WebSocketProvider} — uses QueryClient for cache invalidation
 * 3. {@link RouterProvider} — renders routes that consume both
 */
export function App() {
  return (
    <ApiProvider>
      <WebSocketProvider>
        <RouterProvider router={router} />
      </WebSocketProvider>
    </ApiProvider>
  );
}
