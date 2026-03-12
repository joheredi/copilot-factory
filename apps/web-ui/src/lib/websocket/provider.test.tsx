// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebSocketProvider } from "./provider";
import { useWebSocket } from "./use-websocket";

afterEach(cleanup);

/**
 * Mock socket.io-client to avoid real network connections in tests.
 *
 * Creates a fake socket that emits lifecycle events so we can test
 * the provider's connection state management without a real server.
 */
vi.mock("socket.io-client", () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  const mockSocket = {
    connected: false,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
      return mockSocket;
    }),
    emit: vi.fn(),
    removeAllListeners: vi.fn(() => {
      listeners.clear();
      return mockSocket;
    }),
    disconnect: vi.fn(),
    // Test helper to simulate server events
    _simulateEvent: (event: string, ...args: unknown[]) => {
      const handlers = listeners.get(event);
      if (handlers) {
        for (const handler of handlers) {
          handler(...args);
        }
      }
    },
    _listeners: listeners,
  };

  return {
    io: vi.fn(() => mockSocket),
    __mockSocket: mockSocket,
  };
});

/**
 * Helper to access the mock socket for simulating events in tests.
 */
async function getMockSocket() {
  const mod = await import("socket.io-client");
  return (mod as unknown as { __mockSocket: MockSocket }).__mockSocket;
}

/** Type alias for the mock socket shape used in tests. */
interface MockSocket {
  connected: boolean;
  on: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  _simulateEvent: (event: string, ...args: unknown[]) => void;
  _listeners: Map<string, Set<(...args: unknown[]) => void>>;
}

/**
 * Component that renders the current WebSocket state for testing.
 */
function StateDisplay() {
  const { state } = useWebSocket();
  return <div data-testid="ws-state">{state}</div>;
}

/**
 * Helper to render the provider with all required wrappers.
 */
function renderWithProvider(autoConnect = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={autoConnect}>
        <StateDisplay />
      </WebSocketProvider>
    </QueryClientProvider>,
  );
}

/**
 * Tests for the WebSocketProvider component.
 *
 * The provider manages the socket.io connection lifecycle and exposes
 * connection state to the component tree. These tests verify that the
 * provider correctly:
 * - Starts in disconnected state
 * - Transitions to connected when socket connects
 * - Transitions to reconnecting during reconnection attempts
 * - Subscribes to all default channels on connect
 *
 * Correctness here is critical because the entire real-time update
 * pipeline depends on this provider maintaining accurate state.
 */
describe("WebSocketProvider", () => {
  /**
   * Verifies the provider starts in disconnected state when autoConnect
   * is false. This is the initial state before any connection attempt.
   */
  it("starts in disconnected state with autoConnect=false", () => {
    renderWithProvider(false);
    expect(screen.getByTestId("ws-state")).toHaveTextContent("disconnected");
  });

  /**
   * Verifies the provider starts in disconnected state initially even
   * with autoConnect=true (before the socket connects).
   */
  it("starts in disconnected state before socket connects", () => {
    renderWithProvider(true);
    expect(screen.getByTestId("ws-state")).toHaveTextContent("disconnected");
  });

  /**
   * Verifies that simulating a socket connect event transitions the
   * provider to the "connected" state.
   */
  it("transitions to connected on socket connect event", async () => {
    renderWithProvider(true);
    const socket = await getMockSocket();

    await act(() => {
      socket._simulateEvent("connect");
    });

    expect(screen.getByTestId("ws-state")).toHaveTextContent("connected");
  });

  /**
   * Verifies that a disconnect event transitions back to "disconnected".
   */
  it("transitions to disconnected on socket disconnect event", async () => {
    renderWithProvider(true);
    const socket = await getMockSocket();

    await act(() => {
      socket._simulateEvent("connect");
    });
    expect(screen.getByTestId("ws-state")).toHaveTextContent("connected");

    await act(() => {
      socket._simulateEvent("disconnect");
    });
    expect(screen.getByTestId("ws-state")).toHaveTextContent("disconnected");
  });

  /**
   * Verifies that a reconnect_attempt event transitions to "reconnecting".
   * This intermediate state tells the UI that recovery is in progress.
   */
  it("transitions to reconnecting on reconnect_attempt event", async () => {
    renderWithProvider(true);
    const socket = await getMockSocket();

    await act(() => {
      socket._simulateEvent("reconnect_attempt");
    });

    expect(screen.getByTestId("ws-state")).toHaveTextContent("reconnecting");
  });

  /**
   * Verifies that the provider subscribes to all three default channels
   * (tasks, workers, queue) when the socket connects. This ensures the
   * client receives the full event stream for cache invalidation.
   */
  it("subscribes to all default channels on connect", async () => {
    const socket = await getMockSocket();
    (socket.emit as ReturnType<typeof vi.fn>).mockClear();

    renderWithProvider(true);

    await act(() => {
      socket._simulateEvent("connect");
    });

    const subscribeCalls = (socket.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === "subscribe",
    );
    expect(subscribeCalls).toHaveLength(3);
    expect(subscribeCalls.map((c: unknown[]) => (c[1] as { channel: string }).channel)).toEqual(
      expect.arrayContaining(["tasks", "workers", "queue"]),
    );
  });

  /**
   * Verifies that creating the socket.io connection uses the correct
   * configuration (WebSocket transport, reconnection enabled, credentials).
   */
  it("creates socket with correct configuration", async () => {
    renderWithProvider(true);
    const { io } = await import("socket.io-client");

    expect(io).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        path: "/socket.io",
        transports: ["websocket", "polling"],
        reconnection: true,
        withCredentials: true,
      }),
    );
  });
});
