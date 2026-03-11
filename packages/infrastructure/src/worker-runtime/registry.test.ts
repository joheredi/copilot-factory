/**
 * Tests for the RuntimeRegistry.
 *
 * The registry is the central mechanism for registering and retrieving
 * worker runtime adapters at dispatch time. These tests verify registration,
 * lookup, error handling, and lifecycle management.
 *
 * @why The registry is used by the scheduler and worker supervisor to select
 * execution backends. Bugs here would cause dispatched tasks to fail to find
 * their runtime adapter, silently use the wrong adapter, or allow duplicate
 * registrations that create ambiguity.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeRegistry, RuntimeNotFoundError, DuplicateRuntimeError } from "./registry.js";
import type { WorkerRuntime } from "./runtime.interface.js";
import type {
  RunContext,
  PreparedRun,
  CancelResult,
  CollectedArtifacts,
  FinalizeResult,
  RunOutputStream,
} from "./types.js";

/** Creates a minimal mock runtime for registry tests. */
function createMinimalMockRuntime(name: string): WorkerRuntime {
  return {
    name,
    prepareRun: async (_ctx: RunContext): Promise<PreparedRun> => ({
      runId: "run-1",
      context: _ctx,
      preparedAt: new Date().toISOString(),
    }),
    startRun: async (_runId: string): Promise<void> => {},
    async *streamRun(_runId: string): AsyncIterable<RunOutputStream> {},
    cancelRun: async (_runId: string): Promise<CancelResult> => ({ cancelled: true }),
    collectArtifacts: async (_runId: string): Promise<CollectedArtifacts> => ({
      packetOutput: null,
      packetValid: false,
      artifactPaths: [],
      validationErrors: [],
    }),
    finalizeRun: async (_runId: string): Promise<FinalizeResult> => ({
      runId: _runId,
      status: "cancelled",
      packetOutput: null,
      artifactPaths: [],
      logs: [],
      exitCode: null,
      durationMs: 0,
      finalizedAt: new Date().toISOString(),
    }),
  };
}

describe("RuntimeRegistry", () => {
  let registry: RuntimeRegistry;

  beforeEach(() => {
    registry = RuntimeRegistry.create();
  });

  /**
   * @why Verifies that the factory pattern creates fresh instances. This
   * ensures the singleton is properly initialized and usable.
   */
  it("should create a new registry via static factory", () => {
    expect(registry).toBeInstanceOf(RuntimeRegistry);
    expect(registry.getRegisteredNames()).toEqual([]);
  });

  /**
   * @why Verifies basic registration and lookup. This is the primary
   * usage pattern — register at bootstrap, lookup at dispatch.
   */
  it("should register and retrieve a runtime adapter", () => {
    const mockRuntime = createMinimalMockRuntime("test-adapter");
    registry.register("test-adapter", () => mockRuntime);

    const retrieved = registry.get("test-adapter");
    expect(retrieved.name).toBe("test-adapter");
  });

  /**
   * @why Verifies the factory is called each time. This ensures adapters
   * are freshly instantiated per retrieval, supporting per-run isolation.
   */
  it("should invoke the factory on each get call", () => {
    let callCount = 0;
    registry.register("counting-adapter", () => {
      callCount++;
      return createMinimalMockRuntime(`instance-${String(callCount)}`);
    });

    const first = registry.get("counting-adapter");
    const second = registry.get("counting-adapter");

    expect(callCount).toBe(2);
    expect(first.name).toBe("instance-1");
    expect(second.name).toBe("instance-2");
  });

  /**
   * @why Prevents silent overwrites of adapter registrations. Duplicate
   * names would cause ambiguity in adapter selection at dispatch time.
   */
  it("should throw DuplicateRuntimeError for duplicate registration", () => {
    registry.register("adapter-a", () => createMinimalMockRuntime("a"));

    expect(() => {
      registry.register("adapter-a", () => createMinimalMockRuntime("a-dup"));
    }).toThrow(DuplicateRuntimeError);

    try {
      registry.register("adapter-a", () => createMinimalMockRuntime("a-dup"));
    } catch (e) {
      expect(e).toBeInstanceOf(DuplicateRuntimeError);
      expect((e as DuplicateRuntimeError).adapterName).toBe("adapter-a");
    }
  });

  /**
   * @why Ensures clear error messages when an adapter is not found.
   * Runtime lookup failures at dispatch time must be diagnosable.
   */
  it("should throw RuntimeNotFoundError for unknown adapter", () => {
    expect(() => registry.get("nonexistent")).toThrow(RuntimeNotFoundError);

    try {
      registry.get("nonexistent");
    } catch (e) {
      expect(e).toBeInstanceOf(RuntimeNotFoundError);
      expect((e as RuntimeNotFoundError).adapterName).toBe("nonexistent");
      expect((e as RuntimeNotFoundError).message).toContain("nonexistent");
    }
  });

  /**
   * @why Verifies has() for conditional adapter selection logic
   * in the scheduler (e.g., fallback to default adapter).
   */
  it("should correctly report adapter existence via has()", () => {
    expect(registry.has("adapter-x")).toBe(false);

    registry.register("adapter-x", () => createMinimalMockRuntime("x"));
    expect(registry.has("adapter-x")).toBe(true);
  });

  /**
   * @why Verifies listing of registered names for operator tooling
   * and error messages that enumerate available adapters.
   */
  it("should list all registered adapter names", () => {
    registry.register("alpha", () => createMinimalMockRuntime("alpha"));
    registry.register("beta", () => createMinimalMockRuntime("beta"));
    registry.register("gamma", () => createMinimalMockRuntime("gamma"));

    const names = registry.getRegisteredNames();
    expect(names).toEqual(["alpha", "beta", "gamma"]);
  });

  /**
   * @why Verifies that unregister properly removes adapters. Needed
   * for dynamic runtime reconfiguration and testing cleanup.
   */
  it("should unregister an adapter by name", () => {
    registry.register("removable", () => createMinimalMockRuntime("removable"));
    expect(registry.has("removable")).toBe(true);

    const removed = registry.unregister("removable");
    expect(removed).toBe(true);
    expect(registry.has("removable")).toBe(false);
  });

  /**
   * @why Verifies unregister returns false for unknown adapters rather
   * than throwing, so callers don't need try/catch for cleanup.
   */
  it("should return false when unregistering a non-existent adapter", () => {
    const removed = registry.unregister("ghost");
    expect(removed).toBe(false);
  });

  /**
   * @why Verifies clear() for test isolation. Tests need to reset
   * the registry between test cases without creating a new instance.
   */
  it("should clear all registered adapters", () => {
    registry.register("a", () => createMinimalMockRuntime("a"));
    registry.register("b", () => createMinimalMockRuntime("b"));

    registry.clear();

    expect(registry.getRegisteredNames()).toEqual([]);
    expect(registry.has("a")).toBe(false);
    expect(registry.has("b")).toBe(false);
  });

  /**
   * @why Verifies re-registration after unregister works. This supports
   * hot-swapping adapters during development or reconfiguration.
   */
  it("should allow re-registration after unregister", () => {
    registry.register("swappable", () => createMinimalMockRuntime("v1"));
    registry.unregister("swappable");
    registry.register("swappable", () => createMinimalMockRuntime("v2"));

    const runtime = registry.get("swappable");
    expect(runtime.name).toBe("v2");
  });

  /**
   * @why Verifies the singleton instance is updated on create(). The
   * error classes reference the singleton for diagnostic messages.
   */
  it("should set the singleton instance on create", () => {
    const newRegistry = RuntimeRegistry.create();
    expect(RuntimeRegistry.instance).toBe(newRegistry);
  });
});
