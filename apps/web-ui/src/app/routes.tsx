import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";
import { AppLayout } from "./layout";

/**
 * Lazily loaded page components.
 *
 * Each feature view is loaded on demand to keep the initial bundle small.
 * React.lazy + Suspense provides code splitting at the route level.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — UI screen list
 */
const DashboardPage = lazy(() => import("../features/dashboard/page.js"));
const NotFoundPage = lazy(() => import("../features/not-found/page.js"));

/**
 * Application route definitions.
 *
 * Uses React Router v6 data router with lazy-loaded feature pages.
 * The AppLayout wraps all routes providing the navigation shell.
 * Placeholder routes are defined for future feature views (T090+).
 */
const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      {
        path: "dashboard",
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <DashboardPage />
          </Suspense>
        ),
      },
      {
        path: "*",
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <NotFoundPage />
          </Suspense>
        ),
      },
    ],
  },
];

/** Loading skeleton shown while lazy page components are being loaded. */
function PageSkeleton() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="text-muted-foreground">Loading…</div>
    </div>
  );
}

export const router = createBrowserRouter(routes);
