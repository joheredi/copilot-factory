// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

/**
 * Tests for the root App component.
 *
 * Validates that the application mounts correctly with the router
 * and renders the dashboard page (the default route).
 * This is the top-level integration test for the SPA.
 */
describe("App", () => {
  it("renders without crashing", () => {
    render(<App />);
    // The app should render and show the dashboard heading
    const dashboards = screen.getAllByText("Dashboard");
    expect(dashboards.length).toBeGreaterThanOrEqual(1);
  });

  it("displays the Factory branding in sidebar", () => {
    render(<App />);
    const brands = screen.getAllByText("Factory");
    expect(brands.length).toBeGreaterThanOrEqual(1);
  });

  it("shows navigation items", () => {
    render(<App />);
    expect(screen.getAllByText("Tasks").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Workers").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Reviews").length).toBeGreaterThanOrEqual(1);
  });
});
