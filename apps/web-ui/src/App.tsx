import { RouterProvider } from "react-router-dom";
import { router } from "./app/routes";

/**
 * Root application component.
 *
 * Sets up the React Router provider with the application's route
 * configuration. Global providers (theme, query client, etc.)
 * will be added here in subsequent tasks (T090, T091).
 */
export function App() {
  return <RouterProvider router={router} />;
}
