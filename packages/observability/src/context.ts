import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Correlation context fields that are propagated through the async call chain.
 * Based on §7.14 of the technical architecture document.
 *
 * These fields are automatically attached to all log entries within an active
 * correlation scope. Use {@link runWithContext} to establish a scope, and
 * {@link getContext} to read the current context.
 */
export interface CorrelationContext {
  /** Unique identifier for the current request or operation. */
  readonly correlationId?: string;
  /** Task being processed. */
  readonly taskId?: string;
  /** Current worker run identifier. */
  readonly runId?: string;
  /** Worker executing the task. */
  readonly workerId?: string;
  /** Review cycle identifier. */
  readonly reviewCycleId?: string;
  /** Merge queue item identifier. */
  readonly mergeQueueItemId?: string;
  /** Semantic event type for structured log routing. */
  readonly eventType?: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Runs a function within a correlation context scope.
 *
 * All log entries created within the callback (and any async continuations)
 * will automatically include the provided context fields. Contexts can be
 * nested — inner scopes merge with and override outer scope fields.
 *
 * @param context - Correlation fields to attach to this scope.
 * @param fn - The function to run within the scope.
 * @returns The return value of {@link fn}.
 *
 * @example
 * ```ts
 * await runWithContext({ taskId: "task-1", runId: "run-42" }, async () => {
 *   logger.info("Starting work"); // logs include taskId and runId
 * });
 * ```
 */
export function runWithContext<T>(context: CorrelationContext, fn: () => T): T {
  const parent = storage.getStore();
  const merged = parent ? { ...parent, ...context } : context;
  return storage.run(merged, fn);
}

/**
 * Returns the current correlation context, or an empty object if none is active.
 *
 * This is used internally by the logger to attach context fields, but can also
 * be called directly when correlation fields are needed outside of logging
 * (e.g., to pass taskId to an external service call).
 */
export function getContext(): CorrelationContext {
  return storage.getStore() ?? {};
}

/**
 * Returns the underlying AsyncLocalStorage instance.
 *
 * Exposed for advanced use cases such as NestJS interceptors that need to
 * establish context at the framework level. Prefer {@link runWithContext}
 * for application code.
 */
export function getContextStorage(): AsyncLocalStorage<CorrelationContext> {
  return storage;
}
