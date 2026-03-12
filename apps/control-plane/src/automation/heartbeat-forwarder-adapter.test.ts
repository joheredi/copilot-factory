import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HeartbeatService, ReceiveHeartbeatParams } from "@factory/application";
import type { Logger } from "@factory/observability";
import { createHeartbeatForwarderAdapter } from "./heartbeat-forwarder-adapter.js";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

/**
 * Creates a minimal fake {@link HeartbeatService} with a spy on
 * `receiveHeartbeat`. Only the `receiveHeartbeat` method is needed by the
 * adapter; `detectStaleLeases` is stubbed to prevent accidental calls.
 */
function createFakeHeartbeatService() {
  return {
    receiveHeartbeat: vi.fn(),
    detectStaleLeases: vi.fn(),
  } satisfies HeartbeatService;
}

/**
 * Creates a minimal fake {@link Logger} with spies on all log methods.
 * Used to verify that errors are logged rather than thrown.
 */
function createFakeLogger(): Logger {
  return {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    level: "debug",
    isLevelEnabled: vi.fn().mockReturnValue(true),
  } as unknown as Logger;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

/**
 * Tests for the HeartbeatForwarderPort adapter.
 *
 * This adapter is a thin bridge between the Worker Supervisor's output stream
 * and the HeartbeatService. It is critical that:
 *
 * 1. Regular heartbeats are forwarded with `completing: false` to keep the
 *    lease alive during worker execution.
 * 2. Terminal heartbeats are forwarded with `completing: true` to signal the
 *    worker has finished and trigger the COMPLETING transition.
 * 3. Errors from the HeartbeatService are swallowed and logged — a heartbeat
 *    failure must never crash the worker process.
 *
 * Without this adapter, worker heartbeats would not reach the lease system,
 * causing leases to expire and tasks to be reclaimed prematurely.
 */
describe("HeartbeatForwarderAdapter", () => {
  let heartbeatService: ReturnType<typeof createFakeHeartbeatService>;
  let logger: Logger;

  beforeEach(() => {
    heartbeatService = createFakeHeartbeatService();
    logger = createFakeLogger();
  });

  /**
   * Validates that a regular (non-terminal) heartbeat is forwarded to the
   * HeartbeatService with `completing: false`. This is the most common case —
   * the supervisor detects a heartbeat event in the worker output stream and
   * forwards it to keep the lease alive.
   */
  it("forwards a regular heartbeat with completing=false", () => {
    const adapter = createHeartbeatForwarderAdapter({
      heartbeatService,
      logger,
    });

    adapter.forwardHeartbeat("lease-1", "worker-1", false);

    expect(heartbeatService.receiveHeartbeat).toHaveBeenCalledOnce();
    expect(heartbeatService.receiveHeartbeat).toHaveBeenCalledWith({
      leaseId: "lease-1",
      completing: false,
      actor: { type: "system", id: "worker-supervisor" },
    } satisfies ReceiveHeartbeatParams);
  });

  /**
   * Validates that a terminal heartbeat is forwarded with `completing: true`.
   * This signals the lease system that the worker has finished and the lease
   * should transition to COMPLETING state.
   */
  it("forwards a terminal heartbeat with completing=true", () => {
    const adapter = createHeartbeatForwarderAdapter({
      heartbeatService,
      logger,
    });

    adapter.forwardHeartbeat("lease-2", "worker-2", true);

    expect(heartbeatService.receiveHeartbeat).toHaveBeenCalledOnce();
    expect(heartbeatService.receiveHeartbeat).toHaveBeenCalledWith({
      leaseId: "lease-2",
      completing: true,
      actor: { type: "system", id: "worker-supervisor" },
    } satisfies ReceiveHeartbeatParams);
  });

  /**
   * Validates that errors from `receiveHeartbeat()` are caught and logged,
   * not propagated. This is essential because heartbeat forwarding happens
   * during the worker's async execution stream — if an error propagated, it
   * would kill the entire worker process for a transient issue like a lease
   * version conflict or an already-expired lease.
   */
  it("catches errors and logs a warning instead of throwing", () => {
    heartbeatService.receiveHeartbeat.mockImplementation(() => {
      throw new Error("Lease not found");
    });

    const adapter = createHeartbeatForwarderAdapter({
      heartbeatService,
      logger,
    });

    // Must not throw
    expect(() => adapter.forwardHeartbeat("lease-3", "worker-3", false)).not.toThrow();

    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith("Heartbeat forwarding failed", {
      leaseId: "lease-3",
      workerId: "worker-3",
      isTerminal: false,
      error: "Lease not found",
    });
  });

  /**
   * Validates that non-Error thrown values (e.g. strings) are still logged
   * correctly. JavaScript allows throwing any value, and the adapter must
   * handle this gracefully.
   */
  it("handles non-Error thrown values gracefully", () => {
    heartbeatService.receiveHeartbeat.mockImplementation(() => {
      throw "unexpected string error";
    });

    const adapter = createHeartbeatForwarderAdapter({
      heartbeatService,
      logger,
    });

    expect(() => adapter.forwardHeartbeat("lease-4", "worker-4", true)).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith("Heartbeat forwarding failed", {
      leaseId: "lease-4",
      workerId: "worker-4",
      isTerminal: true,
      error: "unexpected string error",
    });
  });

  /**
   * Validates that the adapter correctly uses the system actor identity
   * "worker-supervisor" for all forwarded heartbeats. This actor identity
   * is recorded in audit events and must be consistent.
   */
  it("uses the system actor identity for all heartbeats", () => {
    const adapter = createHeartbeatForwarderAdapter({
      heartbeatService,
      logger,
    });

    adapter.forwardHeartbeat("lease-a", "worker-a", false);
    adapter.forwardHeartbeat("lease-b", "worker-b", true);

    const calls = heartbeatService.receiveHeartbeat.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].actor).toEqual({ type: "system", id: "worker-supervisor" });
    expect(calls[1][0].actor).toEqual({ type: "system", id: "worker-supervisor" });
  });

  /**
   * Validates that multiple successive heartbeats can be forwarded without
   * interference. In practice, the supervisor forwards many heartbeats
   * during a single worker run — this ensures no stale state accumulates.
   */
  it("forwards multiple successive heartbeats independently", () => {
    const adapter = createHeartbeatForwarderAdapter({
      heartbeatService,
      logger,
    });

    adapter.forwardHeartbeat("lease-x", "worker-x", false);
    adapter.forwardHeartbeat("lease-x", "worker-x", false);
    adapter.forwardHeartbeat("lease-x", "worker-x", true);

    expect(heartbeatService.receiveHeartbeat).toHaveBeenCalledTimes(3);

    // First two are regular, last is terminal
    expect(heartbeatService.receiveHeartbeat.mock.calls[0][0].completing).toBe(false);
    expect(heartbeatService.receiveHeartbeat.mock.calls[1][0].completing).toBe(false);
    expect(heartbeatService.receiveHeartbeat.mock.calls[2][0].completing).toBe(true);
  });

  /**
   * Validates that an error on one heartbeat does not prevent subsequent
   * heartbeats from being forwarded. The adapter must remain functional
   * after catching an error — it should not enter a broken state.
   */
  it("remains functional after an error on a previous heartbeat", () => {
    let callCount = 0;
    heartbeatService.receiveHeartbeat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error("transient failure");
      }
    });

    const adapter = createHeartbeatForwarderAdapter({
      heartbeatService,
      logger,
    });

    // First heartbeat fails
    adapter.forwardHeartbeat("lease-r", "worker-r", false);
    expect(logger.warn).toHaveBeenCalledOnce();

    // Second heartbeat succeeds
    adapter.forwardHeartbeat("lease-r", "worker-r", false);
    expect(heartbeatService.receiveHeartbeat).toHaveBeenCalledTimes(2);
  });
});
