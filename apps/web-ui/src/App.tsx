import { RouterProvider } from "react-router-dom";
import { router } from "./app/routes";
import { ApiProvider } from "./api/provider";

/**
 * Root application component.
 *
 * Wraps the router with the TanStack Query {@link ApiProvider} so that
 * all route-level components can use data-fetching hooks. Additional
 * global providers (WebSocket, theme) will be added in subsequent tasks.
 */
export function App() {
  return (
    <ApiProvider>
      <RouterProvider router={router} />
    </ApiProvider>
  );
}
