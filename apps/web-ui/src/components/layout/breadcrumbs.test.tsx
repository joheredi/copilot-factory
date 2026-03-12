// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Breadcrumbs } from "./breadcrumbs";

afterEach(cleanup);

/**
 * Tests for the Breadcrumbs component.
 *
 * Validates that breadcrumbs correctly render navigation segments based on
 * the current route. This is critical because breadcrumbs are the primary
 * way users orient themselves within the app shell, and incorrect labels
 * or links would break navigation UX across all feature views.
 */
describe("Breadcrumbs", () => {
  /**
   * Verifies a top-level route renders just a Home icon and the page label.
   * This is the most common breadcrumb state since most views are at the top level.
   */
  it("renders breadcrumbs for a top-level route", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Breadcrumbs />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("Home")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toHaveAttribute("aria-current", "page");
  });

  /**
   * Verifies that known route segments are mapped to human-readable labels
   * (e.g., "merge-queue" → "Merge Queue") rather than displaying raw URL segments.
   */
  it("maps route segments to human-readable labels", () => {
    render(
      <MemoryRouter initialEntries={["/merge-queue"]}>
        <Breadcrumbs />
      </MemoryRouter>,
    );
    expect(screen.getByText("Merge Queue")).toBeInTheDocument();
  });

  /**
   * Verifies breadcrumbs render nothing at the root path.
   * The root path redirects to /dashboard, so breadcrumbs should not appear.
   */
  it("renders nothing at the root path", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Breadcrumbs />
      </MemoryRouter>,
    );
    expect(container.querySelector("nav")).toBeNull();
  });

  /**
   * Verifies that the last breadcrumb segment is non-clickable (plain text)
   * while intermediate segments are links. This prevents the user from
   * clicking the current page link, which is a common UX pattern.
   */
  it("marks the last segment as current page and not a link", () => {
    render(
      <MemoryRouter initialEntries={["/tasks"]}>
        <Breadcrumbs />
      </MemoryRouter>,
    );
    const current = screen.getByText("Task Board");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.tagName).not.toBe("A");
  });

  /**
   * Verifies all known route segments get their correct labels.
   * Catches regressions if the segmentLabels map is accidentally modified.
   */
  it("displays correct labels for all known routes", () => {
    const routes = [
      { path: "/workers", label: "Worker Pools" },
      { path: "/reviews", label: "Review Center" },
      { path: "/config", label: "Configuration" },
      { path: "/audit", label: "Audit Explorer" },
    ];

    for (const { path, label } of routes) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <Breadcrumbs />
        </MemoryRouter>,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });
});
