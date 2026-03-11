import { describe, it, expect } from "vitest";

import { FakeRunnerAdapter } from "./fake-runner-adapter.js";
import type { SupervisorRunContext } from "@factory/application";

/**
 * Tests for FakeRunnerAdapter — configurable worker runtime test double.
 *
 * The RuntimeAdapterPort is the boundary between the orchestrator and worker
 * processes. This fake enables integration tests to simulate success, failure,
 * partial results, timeout, and cancellation scenarios without spawning real
 * AI worker processes.
 */

/** Create a minimal valid run context for testing. */
function createMinimalContext(): SupervisorRunContext {
  return {
    taskPacket: { task_id: "test-task" },
    effectivePolicySnapshot: { version: "1.0" },
    workspacePaths: {
      worktreePath: "/fake/worktree",
      artifactRoot: "/fake/artifacts",
      packetInputPath: "/fake/packet.json",
      policySnapshotPath: "/fake/policy.json",
    },
    outputSchemaExpectation: {
      packetType: "dev_result_packet",
      schemaVersion: "1.0",
    },
    timeoutSettings: {
      timeBudgetSeconds: 300,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      heartbeatIntervalSeconds: 30,
      missedHeartbeatThreshold: 3,
      gracePeriodSeconds: 60,
    },
  };
}

describe("FakeRunnerAdapter", () => {
  /**
   * Validates the full happy-path lifecycle: prepare → start → stream →
   * collect → finalize. This is the most common integration test pattern.
   */
  it("runs the full lifecycle with default success outcome", async () => {
    const adapter = new FakeRunnerAdapter();
    const ctx = createMinimalContext();

    const prepared = await adapter.prepareRun(ctx);
    expect(prepared.runId).toBe("fake-run-1");
    expect(prepared.context).toBe(ctx);

    await adapter.startRun(prepared.runId);

    const events: string[] = [];
    for await (const event of adapter.streamRun(prepared.runId)) {
      events.push(event.type);
    }
    expect(events).toEqual(["stdout", "heartbeat", "stdout"]);

    const artifacts = await adapter.collectArtifacts(prepared.runId);
    expect(artifacts.packetValid).toBe(true);

    const result = await adapter.finalizeRun(prepared.runId);
    expect(result.status).toBe("success");
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBe(1000);
  });

  /**
   * Validates sequential run ID generation for deterministic assertions.
   */
  it("generates sequential run IDs", async () => {
    const adapter = new FakeRunnerAdapter();
    const ctx = createMinimalContext();

    const r1 = await adapter.prepareRun(ctx);
    const r2 = await adapter.prepareRun(ctx);
    const r3 = await adapter.prepareRun(ctx);

    expect(r1.runId).toBe("fake-run-1");
    expect(r2.runId).toBe("fake-run-2");
    expect(r3.runId).toBe("fake-run-3");
    expect(adapter.totalRunsPrepared).toBe(3);
  });

  /**
   * Validates failure scenario configuration for testing error recovery.
   */
  it("returns configured failure outcome", async () => {
    const adapter = new FakeRunnerAdapter({
      defaultOutcome: { status: "failed", exitCode: 1 },
    });
    const ctx = createMinimalContext();

    const prepared = await adapter.prepareRun(ctx);
    await adapter.startRun(prepared.runId);
    const result = await adapter.finalizeRun(prepared.runId);

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
  });

  /**
   * Validates partial result scenario for testing incomplete output handling.
   */
  it("returns configured partial outcome with invalid packet", async () => {
    const adapter = new FakeRunnerAdapter({
      defaultOutcome: {
        status: "partial",
        packetValid: false,
        validationErrors: ["Missing required field: summary"],
      },
    });
    const ctx = createMinimalContext();

    const prepared = await adapter.prepareRun(ctx);
    await adapter.startRun(prepared.runId);

    const artifacts = await adapter.collectArtifacts(prepared.runId);
    expect(artifacts.packetValid).toBe(false);
    expect(artifacts.validationErrors).toEqual(["Missing required field: summary"]);

    const result = await adapter.finalizeRun(prepared.runId);
    expect(result.status).toBe("partial");
  });

  /**
   * Validates per-run outcome overrides for mixed scenario tests.
   * First run succeeds, second run fails — a common retry test pattern.
   */
  it("supports per-run outcome overrides", async () => {
    const adapter = new FakeRunnerAdapter({
      outcomesByRun: new Map([[2, { status: "failed", exitCode: 1 }]]),
    });
    const ctx = createMinimalContext();

    // First run — default (success)
    const r1 = await adapter.prepareRun(ctx);
    await adapter.startRun(r1.runId);
    const result1 = await adapter.finalizeRun(r1.runId);
    expect(result1.status).toBe("success");

    // Second run — configured failure
    const r2 = await adapter.prepareRun(ctx);
    await adapter.startRun(r2.runId);
    const result2 = await adapter.finalizeRun(r2.runId);
    expect(result2.status).toBe("failed");
  });

  /**
   * Validates cancellation scenario. After cancel, finalize should
   * report "cancelled" status regardless of configured outcome.
   */
  it("handles cancellation correctly", async () => {
    const adapter = new FakeRunnerAdapter();
    const ctx = createMinimalContext();

    const prepared = await adapter.prepareRun(ctx);
    await adapter.startRun(prepared.runId);

    const cancelResult = await adapter.cancelRun(prepared.runId);
    expect(cancelResult.cancelled).toBe(true);

    const result = await adapter.finalizeRun(prepared.runId);
    expect(result.status).toBe("cancelled");
    expect(result.exitCode).toBeNull();
  });

  /**
   * Validates double-cancel is a no-op (idempotency).
   */
  it("returns cancelled: false for double cancel", async () => {
    const adapter = new FakeRunnerAdapter();
    const ctx = createMinimalContext();

    const prepared = await adapter.prepareRun(ctx);
    await adapter.startRun(prepared.runId);
    await adapter.cancelRun(prepared.runId);

    const result = await adapter.cancelRun(prepared.runId);
    expect(result.cancelled).toBe(false);
    expect(result.reason).toBe("Run already cancelled");
  });

  /**
   * Validates error injection at prepare stage.
   */
  it("throws configured prepareError", async () => {
    const adapter = new FakeRunnerAdapter({
      defaultOutcome: { prepareError: new Error("Prepare failed") },
    });

    await expect(adapter.prepareRun(createMinimalContext())).rejects.toThrow("Prepare failed");
  });

  /**
   * Validates error injection at start stage.
   */
  it("throws configured startError", async () => {
    const adapter = new FakeRunnerAdapter({
      defaultOutcome: { startError: new Error("Start failed") },
    });

    const prepared = await adapter.prepareRun(createMinimalContext());
    await expect(adapter.startRun(prepared.runId)).rejects.toThrow("Start failed");
  });

  /**
   * Validates that unknown run IDs are rejected.
   */
  it("throws on unknown run ID for startRun", async () => {
    const adapter = new FakeRunnerAdapter();
    await expect(adapter.startRun("nonexistent")).rejects.toThrow("Unknown run ID");
  });

  /**
   * Validates that double-start is rejected.
   */
  it("throws on double startRun", async () => {
    const adapter = new FakeRunnerAdapter();
    const prepared = await adapter.prepareRun(createMinimalContext());
    await adapter.startRun(prepared.runId);
    await expect(adapter.startRun(prepared.runId)).rejects.toThrow("already started");
  });

  /**
   * Validates that double-finalize is rejected.
   */
  it("throws on double finalizeRun", async () => {
    const adapter = new FakeRunnerAdapter();
    const prepared = await adapter.prepareRun(createMinimalContext());
    await adapter.startRun(prepared.runId);
    await adapter.finalizeRun(prepared.runId);
    await expect(adapter.finalizeRun(prepared.runId)).rejects.toThrow("Unknown run ID");
  });

  /**
   * Validates call tracking for integration test assertions.
   * Tests verify the supervisor called lifecycle methods in order.
   */
  it("tracks all method calls", async () => {
    const adapter = new FakeRunnerAdapter();
    const ctx = createMinimalContext();

    const prepared = await adapter.prepareRun(ctx);
    await adapter.startRun(prepared.runId);
    await adapter.finalizeRun(prepared.runId);

    const methods = adapter.calls.map((c) => c.method);
    expect(methods).toEqual(["prepareRun", "startRun", "finalizeRun"]);
  });

  /**
   * Validates custom stream events for testing specific output patterns.
   */
  it("uses configured stream events", async () => {
    const customEvents = [
      { type: "stderr" as const, content: "Warning!", timestamp: new Date().toISOString() },
    ];
    const adapter = new FakeRunnerAdapter({
      defaultOutcome: { streamEvents: customEvents },
    });

    const prepared = await adapter.prepareRun(createMinimalContext());
    await adapter.startRun(prepared.runId);

    const events = [];
    for await (const event of adapter.streamRun(prepared.runId)) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("stderr");
    expect(events[0]!.content).toBe("Warning!");
  });

  /**
   * Validates reset() clears all state for test isolation.
   */
  it("resets all state", async () => {
    const adapter = new FakeRunnerAdapter();
    await adapter.prepareRun(createMinimalContext());
    adapter.reset();

    expect(adapter.calls).toHaveLength(0);
    expect(adapter.totalRunsPrepared).toBe(0);
  });

  /**
   * Validates custom adapter name for runtime selection tests.
   */
  it("uses configured adapter name", () => {
    const adapter = new FakeRunnerAdapter({ name: "test-llm" });
    expect(adapter.name).toBe("test-llm");
  });
});
