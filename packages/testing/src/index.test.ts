import { describe, expect, it } from "vitest";

import { createSequentialId, createTestId, sleep } from "./index.js";

/**
 * Tests for @factory/testing shared test utilities.
 *
 * These tests validate the foundational testing infrastructure that all other
 * packages depend on. If these fail, the entire test pipeline is unreliable.
 */
describe("@factory/testing", () => {
  describe("createTestId", () => {
    /**
     * Validates the basic contract: IDs start with the default "test" prefix
     * followed by a timestamp and random suffix. This format is used by all
     * entity factories in tests.
     */
    it("generates a unique ID with default prefix", () => {
      const id = createTestId();
      expect(id).toMatch(/^test-\d+-[a-z0-9]+$/);
    });

    /**
     * Validates custom prefix support. Tests for domain entities (task, project,
     * etc.) use domain-specific prefixes for readability in test output.
     */
    it("generates a unique ID with custom prefix", () => {
      const id = createTestId("task");
      expect(id).toMatch(/^task-\d+-[a-z0-9]+$/);
    });

    /**
     * Validates uniqueness guarantee. Multiple entity creations in a single test
     * must never collide.
     */
    it("generates unique IDs on successive calls", () => {
      const ids = new Set(Array.from({ length: 100 }, () => createTestId()));
      expect(ids.size).toBe(100);
    });
  });

  describe("createSequentialId", () => {
    /**
     * Validates deterministic ID generation. Sequential IDs are essential for
     * snapshot testing and assertions that depend on predictable ordering.
     */
    it("generates sequential IDs starting from 1", () => {
      const nextId = createSequentialId("item");
      expect(nextId()).toBe("item-1");
      expect(nextId()).toBe("item-2");
      expect(nextId()).toBe("item-3");
    });

    /**
     * Validates that separate factory instances maintain independent counters.
     * This ensures test isolation when multiple factories are used.
     */
    it("maintains independent counters per factory", () => {
      const nextTask = createSequentialId("task");
      const nextWorker = createSequentialId("worker");

      expect(nextTask()).toBe("task-1");
      expect(nextWorker()).toBe("worker-1");
      expect(nextTask()).toBe("task-2");
      expect(nextWorker()).toBe("worker-2");
    });

    /**
     * Validates default prefix behavior for convenience usage.
     */
    it("uses default prefix when none provided", () => {
      const nextId = createSequentialId();
      expect(nextId()).toBe("test-1");
    });
  });

  describe("sleep", () => {
    /**
     * Validates that sleep resolves after approximately the specified duration.
     * This utility is used to test time-dependent orchestration behavior
     * (heartbeat staleness, lease TTL, etc.).
     */
    it("resolves after the specified delay", async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    /**
     * Validates that sleep(0) resolves on the next tick, which is useful for
     * yielding control in async test scenarios.
     */
    it("resolves immediately with 0ms delay", async () => {
      const start = Date.now();
      await sleep(0);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });
});
