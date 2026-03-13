import { useState, useCallback } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { cn } from "../lib/utils";
import {
  LayoutDashboard,
  ListTodo,
  Users,
  MessageSquare,
  GitMerge,
  Settings,
  ScrollText,
  FileText,
  Factory,
  Menu,
  X,
} from "lucide-react";
import { Breadcrumbs } from "../components/layout/breadcrumbs";
import { ConnectionStatus } from "../components/layout/connection-status";
import { useWebSocket } from "../lib/websocket";

/**
 * Navigation item definition for the sidebar.
 */
interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

/**
 * Sidebar navigation items.
 *
 * Maps to the UI screens defined in §7.16 of the technical architecture.
 * Links for future feature views (T093+) are included but route to placeholder pages.
 */
const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Tasks", href: "/tasks", icon: ListTodo },
  { label: "Workers", href: "/workers", icon: Users },
  { label: "Reviews", href: "/reviews", icon: MessageSquare },
  { label: "Merge Queue", href: "/merge-queue", icon: GitMerge },
  { label: "Config", href: "/config", icon: Settings },
  { label: "Prompts", href: "/prompts", icon: FileText },
  { label: "Audit Log", href: "/audit", icon: ScrollText },
];

/**
 * Application shell layout with sidebar navigation, breadcrumbs, and
 * WebSocket connection indicator.
 *
 * Provides the persistent navigation sidebar and main content area.
 * Uses React Router's Outlet for rendering the active page.
 * The sidebar collapses into a hamburger menu on small screens (< md breakpoint).
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — UI layout
 */
export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { state: connectionState } = useWebSocket();

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile overlay — dims the content area when sidebar is open */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — fixed on mobile, static on desktop */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-card transition-transform duration-200 md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <Factory className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold">Factory</span>
          </div>
          {/* Close button — visible only on mobile */}
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground md:hidden"
            onClick={closeSidebar}
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 p-2" aria-label="Main navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              onClick={closeSidebar}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        {/* Connection status indicator in sidebar footer */}
        <div className="border-t p-3">
          <ConnectionStatus status={connectionState} />
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar with hamburger (mobile) and breadcrumbs */}
        <header className="flex h-14 items-center gap-4 border-b px-4 md:px-6">
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground md:hidden"
            onClick={toggleSidebar}
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Breadcrumbs />
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
