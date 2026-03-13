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
const TasksPage = lazy(() => import("../features/tasks/page.js"));
const TaskDetailPage = lazy(() => import("../features/task-detail/TaskDetailPage.js"));
const PoolsPage = lazy(() => import("../features/pools/PoolsPage.js"));
const PoolDetailPage = lazy(() => import("../features/pools/PoolDetailPage.js"));
const ReviewsPage = lazy(() => import("../features/reviews/page.js"));
const MergeQueuePage = lazy(() => import("../features/merge-queue/page.js"));
const ConfigPage = lazy(() => import("../features/config/page.js"));
const AuditPage = lazy(() => import("../features/audit/page.js"));
const PromptsPage = lazy(() => import("../features/prompts/PromptsPage.js"));
const PromptDetailPage = lazy(() => import("../features/prompts/PromptDetailPage.js"));
const NotFoundPage = lazy(() => import("../features/not-found/page.js"));

/**
 * Application route definitions.
 *
 * Uses React Router v6 data router with lazy-loaded feature pages.
 * The AppLayout wraps all routes providing the navigation shell
 * with sidebar, breadcrumbs, and connection status.
 *
 * Each route maps to a sidebar navigation item defined in `layout.tsx`.
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
        path: "tasks",
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <TasksPage />
          </Suspense>
        ),
      },
      {
        path: "tasks/:id",
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <TaskDetailPage />
          </Suspense>
        ),
      },
      {
        path: "workers",
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <PoolsPage />
          </Suspense>
        ),
      },
      {
        path: "workers/:id",
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <PoolDetailPage />
          </Suspense>
        ),
      },
      {
        path: "reviews",
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <ReviewsPage />
          </Suspense>
        ),
      },
      {
        path: "merge-queue",
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <MergeQueuePage />
          </Suspense>
        ),
      },
      {
        path: "config",
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <ConfigPage />
          </Suspense>
        ),
      },
      {
        path: "audit",
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <AuditPage />
          </Suspense>
        ),
      },
      {
        path: "prompts",
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <PromptsPage />
          </Suspense>
        ),
      },
      {
        path: "prompts/:id",
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <PromptDetailPage />
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
