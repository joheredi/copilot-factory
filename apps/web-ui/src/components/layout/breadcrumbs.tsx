import { useLocation, Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * Route-to-label mapping for breadcrumb display.
 *
 * Maps URL path segments to human-readable labels shown in the breadcrumb trail.
 * Must be updated when new routes are added to `src/app/routes.tsx`.
 */
const segmentLabels: Record<string, string> = {
  dashboard: "Dashboard",
  tasks: "Task Board",
  workers: "Worker Pools",
  reviews: "Review Center",
  "merge-queue": "Merge Queue",
  config: "Configuration",
  audit: "Audit Explorer",
};

/**
 * Breadcrumb navigation component.
 *
 * Renders a breadcrumb trail based on the current React Router location.
 * Each segment of the URL path is converted to a clickable link with a
 * human-readable label. The last segment is displayed as plain text
 * (non-clickable) to indicate the current page.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — UI navigation
 */
export function Breadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
      <Link
        to="/dashboard"
        className="text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Home"
      >
        <Home className="h-4 w-4" />
      </Link>
      {segments.map((segment, index) => {
        const path = "/" + segments.slice(0, index + 1).join("/");
        const label = segmentLabels[segment] ?? segment;
        const isLast = index === segments.length - 1;

        return (
          <span key={path} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            {isLast ? (
              <span className={cn("font-medium text-foreground")} aria-current="page">
                {label}
              </span>
            ) : (
              <Link
                to={path}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
