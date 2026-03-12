// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { WebSocketProvider } from "./provider";
import { useWebSocket } from "./use-websocket";

afterEach(cleanup);

/**
 * Tests for the useWebSocket hook.
 *
 * Validates that the hook correctly accesses the WebSocket context
 * and throws when used outside the provider. This is important because
 * a missing provider is always a programming error, and a clear error
 * message saves debugging time.
 */
describe("useWebSocket", () => {
  /**
   * Verifies the hook throws a descriptive error when called outside
   * a WebSocketProvider. This protects against accidentally using the
   * hook in a component that isn't wrapped by the provider.
   */
  it("throws when used outside WebSocketProvider", () => {
    // Suppress React error boundary console output
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => useWebSocket());
    }).toThrow("useWebSocket must be used within a WebSocketProvider");

    spy.mockRestore();
  });

  /**
   * Verifies the hook returns the context value when used inside a
   * WebSocketProvider. The returned object should have state, subscribe,
   * and unsubscribe properties.
   */
  it("returns context value when inside WebSocketProvider", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <WebSocketProvider autoConnect={false}>{children}</WebSocketProvider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useWebSocket(), { wrapper });

    expect(result.current).toEqual(
      expect.objectContaining({
        state: "disconnected",
        subscribe: expect.any(Function),
        unsubscribe: expect.any(Function),
      }),
    );
  });
});

// Import vi for the spy in the throw test
import { vi } from "vitest";
