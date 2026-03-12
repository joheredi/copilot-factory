// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "./layout";
import { WebSocketProvider } from "../lib/websocket";

afterEach(cleanup);

/**
 * Helper to render the AppLayout within a MemoryRouter at a given path.
 * Wraps in QueryClientProvider and WebSocketProvider (autoConnect=false)
 * so the layout can use useWebSocket without a real connection.
 */
function renderLayout(initialPath = "/dashboard") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={false}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/" element={<AppLayout />}>
              <Route path="dashboard" element={<div>Dashboard Content</div>} />
              <Route path="tasks" element={<div>Tasks Content</div>} />
              <Route path="workers" element={<div>Workers Content</div>} />
              <Route path="reviews" element={<div>Reviews Content</div>} />
              <Route path="merge-queue" element={<div>Merge Queue Content</div>} />
              <Route path="config" element={<div>Config Content</div>} />
              <Route path="audit" element={<div>Audit Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </WebSocketProvider>
    </QueryClientProvider>,
  );
}

/**
 * Tests for the AppLayout component (app shell).
 *
 * The app shell is the root layout that wraps all feature views. These tests
 * ensure the sidebar navigation, breadcrumbs, connection status, and
 * responsive behavior work correctly. Failures here would break navigation
 * across the entire application.
 */
describe("AppLayout", () => {
  /**
   * Verifies the Factory branding is visible in the sidebar header.
   * This is a basic smoke test to confirm the layout renders.
   */
  it("renders Factory branding in sidebar", () => {
    renderLayout();
    expect(screen.getByText("Factory")).toBeInTheDocument();
  });

  /**
   * Verifies all seven navigation items are present in the sidebar.
   * These items correspond to the views defined in §7.16 of the tech architecture.
   */
  it("renders all navigation items", () => {
    renderLayout();
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav).toBeInTheDocument();
    // Use getAllByText since labels may appear in both nav and breadcrumbs
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Tasks").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Workers").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Reviews").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Merge Queue").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Config").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Audit Log").length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Verifies the active navigation link has the correct visual styling.
   * Active route highlighting is a core acceptance criterion for T092.
   */
  it("highlights the active navigation link", () => {
    renderLayout("/dashboard");
    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink.className).toContain("bg-accent");
    expect(dashboardLink.className).toContain("text-accent-foreground");
  });

  /**
   * Verifies inactive navigation links have muted styling.
   */
  it("uses muted style for inactive navigation links", () => {
    renderLayout("/dashboard");
    const tasksLink = screen.getByRole("link", { name: "Tasks" });
    expect(tasksLink.className).toContain("text-muted-foreground");
  });

  /**
   * Verifies the child route content renders through the Outlet.
   * This confirms the layout correctly nests page content.
   */
  it("renders child route content via Outlet", () => {
    renderLayout("/dashboard");
    expect(screen.getByText("Dashboard Content")).toBeInTheDocument();
  });

  /**
   * Verifies clicking a nav link navigates to the correct page.
   * This tests the core navigation functionality of the shell.
   */
  it("navigates to different pages via sidebar links", async () => {
    const user = userEvent.setup();
    renderLayout("/dashboard");
    await user.click(screen.getByRole("link", { name: "Tasks" }));
    expect(screen.getByText("Tasks Content")).toBeInTheDocument();
  });

  /**
   * Verifies the breadcrumb component is present in the layout.
   * Breadcrumbs are a core acceptance criterion for T092.
   */
  it("renders breadcrumbs in the header", () => {
    renderLayout("/dashboard");
    expect(screen.getByLabelText("Breadcrumb")).toBeInTheDocument();
  });

  /**
   * Verifies the WebSocket connection status indicator is displayed.
   * The connection indicator is a core acceptance criterion for T092.
   */
  it("renders connection status indicator", () => {
    renderLayout();
    expect(screen.getByLabelText("Disconnected from server")).toBeInTheDocument();
  });

  /**
   * Verifies the mobile sidebar toggle button exists.
   * Responsive layout is a core acceptance criterion for T092.
   */
  it("renders mobile sidebar toggle button", () => {
    renderLayout();
    expect(screen.getByLabelText("Open sidebar")).toBeInTheDocument();
  });

  /**
   * Verifies the mobile sidebar close button exists.
   */
  it("renders mobile sidebar close button", () => {
    renderLayout();
    expect(screen.getByLabelText("Close sidebar")).toBeInTheDocument();
  });

  /**
   * Verifies the sidebar has the main navigation aria label for accessibility.
   */
  it("has accessible navigation landmark", () => {
    renderLayout();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
  });
});
