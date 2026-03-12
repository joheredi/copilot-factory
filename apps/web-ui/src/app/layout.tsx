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
  Factory,
} from "lucide-react";

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
  { label: "Audit Log", href: "/audit", icon: ScrollText },
];

/**
 * Application shell layout with sidebar navigation.
 *
 * Provides the persistent navigation sidebar and main content area.
 * Uses React Router's Outlet for rendering the active page.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — UI layout
 */
export function AppLayout() {
  return (
    <div className="flex h-screen bg-background">
      <aside className="flex w-64 flex-col border-r bg-card">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Factory className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold">Factory</span>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
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
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
