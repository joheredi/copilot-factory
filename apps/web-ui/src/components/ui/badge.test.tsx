// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

/**
 * Tests for the Badge component.
 *
 * Validates that Badge renders with correct variant styling.
 * Badges are used throughout the UI for status indicators
 * (task states, worker statuses, review decisions).
 */
describe("Badge", () => {
  it("renders with default variant", () => {
    render(<Badge>Status</Badge>);
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("renders with destructive variant", () => {
    render(<Badge variant="destructive">Error</Badge>);
    const badge = screen.getByText("Error");
    expect(badge.className).toContain("bg-destructive");
  });

  it("renders with outline variant", () => {
    render(<Badge variant="outline">Outline</Badge>);
    const badge = screen.getByText("Outline");
    expect(badge.className).toContain("text-foreground");
  });

  it("applies custom className", () => {
    render(<Badge className="custom">Custom</Badge>);
    expect(screen.getByText("Custom").className).toContain("custom");
  });
});
