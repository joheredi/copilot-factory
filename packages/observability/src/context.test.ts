import { describe, it, expect } from "vitest";
import { runWithContext, getContext } from "./context.js";

describe("CorrelationContext", () => {
  /**
   * Tests that the correlation context module correctly manages async-scoped
   * context fields using AsyncLocalStorage. This is the foundation for
   * automatic log enrichment — if context propagation breaks, all structured
   * log correlation fields will be lost.
   */

  describe("getContext", () => {
    /**
     * Verifies the safe default behavior: when no context scope is active,
     * getContext returns an empty object rather than undefined or throwing.
     * This ensures loggers can always call getContext without guard clauses.
     */
    it("should return empty object when no context is active", () => {
      const ctx = getContext();
      expect(ctx).toEqual({});
    });
  });

  describe("runWithContext", () => {
    /**
     * Validates that a simple context scope makes fields available
     * inside the callback. This is the basic contract: set context,
     * read context.
     */
    it("should provide context within the callback", () => {
      const result = runWithContext({ taskId: "task-1", runId: "run-42" }, () => {
        return getContext();
      });

      expect(result).toEqual({ taskId: "task-1", runId: "run-42" });
    });

    /**
     * Validates that context does not leak outside the callback scope.
     * This prevents cross-request contamination in concurrent environments.
     */
    it("should not leak context outside the callback", () => {
      runWithContext({ taskId: "task-1" }, () => {
        // Context is active here
      });

      const ctx = getContext();
      expect(ctx).toEqual({});
    });

    /**
     * Validates nested context merging: inner scopes inherit from outer
     * scopes and can override specific fields. This supports patterns like
     * a request-level correlationId with a task-level taskId nested inside.
     */
    it("should merge nested contexts with inner overriding outer", () => {
      const result = runWithContext({ correlationId: "req-1", taskId: "task-1" }, () => {
        return runWithContext({ taskId: "task-2", runId: "run-99" }, () => {
          return getContext();
        });
      });

      expect(result).toEqual({
        correlationId: "req-1",
        taskId: "task-2",
        runId: "run-99",
      });
    });

    /**
     * Validates that the outer context is restored after a nested scope exits.
     * This ensures that context nesting does not corrupt the parent scope.
     */
    it("should restore outer context after inner scope exits", () => {
      const result = runWithContext({ taskId: "task-1" }, () => {
        runWithContext({ taskId: "task-2" }, () => {
          // Inner scope
        });
        return getContext();
      });

      expect(result).toEqual({ taskId: "task-1" });
    });

    /**
     * Validates that async continuations within a context scope still see
     * the correct context. This is critical for real-world usage where
     * database queries, HTTP calls, and other async operations occur
     * inside a context scope.
     */
    it("should propagate context through async operations", async () => {
      const result = await runWithContext(
        { taskId: "task-async", workerId: "worker-7" },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return getContext();
        },
      );

      expect(result).toEqual({ taskId: "task-async", workerId: "worker-7" });
    });

    /**
     * Validates that the return value of the callback is passed through.
     * This ensures runWithContext can be used as a transparent wrapper
     * in any call chain.
     */
    it("should return the callback's return value", () => {
      const result = runWithContext({ taskId: "task-1" }, () => {
        return 42;
      });

      expect(result).toBe(42);
    });

    /**
     * Validates all §7.14 correlation fields can be set and retrieved.
     * Ensures the CorrelationContext interface supports the full field set
     * specified by the architecture document.
     */
    it("should support all §7.14 correlation fields", () => {
      const fullContext = {
        correlationId: "corr-1",
        taskId: "task-1",
        runId: "run-1",
        workerId: "worker-1",
        reviewCycleId: "review-1",
        mergeQueueItemId: "merge-1",
        eventType: "task.transition",
      };

      const result = runWithContext(fullContext, () => getContext());
      expect(result).toEqual(fullContext);
    });
  });
});
