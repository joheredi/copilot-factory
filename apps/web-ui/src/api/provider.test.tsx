// @vitest-environment jsdom
/**
 * Tests for the TanStack Query provider component.
 *
 * Validates that:
 * - ApiProvider renders children correctly
 * - createQueryClient produces a client with expected defaults
 * - Custom client can be injected (important for test isolation)
 *
 * These are important because the provider is the top-level wrapper
 * for the entire data-fetching layer — if it breaks, no hooks work.
 */
import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { ApiProvider, createQueryClient } from "./provider";

describe("createQueryClient", () => {
  /**
   * Validates that the factory returns a QueryClient with the
   * expected default staleTime of 30 seconds.
   */
  it("creates a QueryClient with 30s staleTime", () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(30_000);
  });

  /**
   * Validates that queries retry once (not the default 3)
   * so operator dashboards surface errors quickly.
   */
  it("sets query retry to 1", () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.retry).toBe(1);
  });

  /**
   * Validates that mutations do not retry so the user gets
   * immediate feedback on write failures.
   */
  it("sets mutation retry to 0", () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();
    expect(defaults.mutations?.retry).toBe(0);
  });
});

describe("ApiProvider", () => {
  /**
   * Validates that children are rendered within the provider.
   * This is the basic smoke test for the wrapper.
   */
  it("renders children", () => {
    const client = createQueryClient();
    render(
      <ApiProvider client={client}>
        <div data-testid="child">Hello</div>
      </ApiProvider>,
    );
    expect(screen.getByTestId("child")).toHaveTextContent("Hello");
  });

  /**
   * Validates that the custom client prop is passed through to
   * QueryClientProvider, which is critical for test isolation.
   */
  it("provides the custom QueryClient to descendants", () => {
    const customClient = new QueryClient();
    let receivedClient: QueryClient | undefined;

    function Inspector() {
      receivedClient = useQueryClient();
      return null;
    }

    render(
      <ApiProvider client={customClient}>
        <Inspector />
      </ApiProvider>,
    );
    expect(receivedClient).toBe(customClient);
  });
});
