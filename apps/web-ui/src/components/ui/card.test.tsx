// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./card";

/**
 * Tests for the Card component family.
 *
 * Validates that Card and its sub-components render correctly
 * and compose together as expected. Cards are the primary
 * content container used throughout the dashboard.
 */
describe("Card", () => {
  it("renders a card with all sub-components", () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Content</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );

    expect(screen.getByTestId("card")).toBeInTheDocument();
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });

  it("applies custom className to Card", () => {
    render(
      <Card data-testid="test-card" className="custom">
        Content
      </Card>,
    );
    const cards = screen.getAllByTestId("test-card");
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards[0]!.className).toContain("custom");
  });
});
