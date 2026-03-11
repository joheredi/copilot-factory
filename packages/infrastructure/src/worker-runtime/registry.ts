/**
 * @module worker-runtime/registry
 *
 * Runtime registration mechanism for worker runtime adapters.
 *
 * The registry allows execution backends to be registered by name and
 * retrieved at dispatch time. This supports the pluggable runtime model
 * described in PRD 007 §7.9 where different adapters (Copilot CLI, local
 * LLM, remote API, deterministic validator) can be swapped without changing
 * orchestration code.
 *
 * @see docs/prd/007-technical-architecture.md §7.9
 */

import type { WorkerRuntime } from "./runtime.interface.js";

/**
 * Factory function that creates a {@link WorkerRuntime} adapter instance.
 *
 * Factories are used instead of direct instances so that adapters can be
 * lazily instantiated and each invocation can produce a fresh instance
 * if needed (e.g., for isolation or per-worker-pool configuration).
 */
export type WorkerRuntimeFactory = () => WorkerRuntime;

/**
 * Error thrown when a requested runtime adapter is not found in the registry.
 */
export class RuntimeNotFoundError extends Error {
  /** The adapter name that was requested but not found. */
  readonly adapterName: string;

  constructor(adapterName: string) {
    super(
      `Worker runtime adapter "${adapterName}" is not registered. ` +
        `Available adapters: ${RuntimeRegistry.instance ? RuntimeRegistry.instance.getRegisteredNames().join(", ") || "(none)" : "(registry not initialized)"}`,
    );
    this.name = "RuntimeNotFoundError";
    this.adapterName = adapterName;
  }
}

/**
 * Error thrown when attempting to register an adapter with a name that is
 * already in use.
 */
export class DuplicateRuntimeError extends Error {
  /** The adapter name that was duplicated. */
  readonly adapterName: string;

  constructor(adapterName: string) {
    super(`Worker runtime adapter "${adapterName}" is already registered.`);
    this.name = "DuplicateRuntimeError";
    this.adapterName = adapterName;
  }
}

/**
 * Central registry for worker runtime adapters.
 *
 * Provides a singleton registry where adapter factories are registered by
 * name. The scheduler and worker supervisor use this registry to look up
 * the appropriate adapter at dispatch time based on the worker pool's
 * configured runtime.
 *
 * **Usage:**
 * ```typescript
 * // At application bootstrap — register adapters
 * const registry = RuntimeRegistry.create();
 * registry.register("copilot-cli", () => new CopilotCliAdapter(config));
 * registry.register("deterministic-validator", () => new ValidatorAdapter());
 *
 * // At dispatch time — retrieve adapter
 * const runtime = registry.get("copilot-cli");
 * const prepared = await runtime.prepareRun(context);
 * ```
 *
 * @see docs/prd/007-technical-architecture.md §7.9
 */
export class RuntimeRegistry {
  /** Singleton instance for use by the error class. */
  static instance: RuntimeRegistry | null = null;

  private readonly factories = new Map<string, WorkerRuntimeFactory>();

  private constructor() {}

  /**
   * Create a new RuntimeRegistry and set it as the singleton instance.
   *
   * @returns A fresh registry with no registered adapters.
   */
  static create(): RuntimeRegistry {
    const registry = new RuntimeRegistry();
    RuntimeRegistry.instance = registry;
    return registry;
  }

  /**
   * Register a worker runtime adapter factory under the given name.
   *
   * @param name - Unique identifier for the adapter (e.g., "copilot-cli").
   * @param factory - Factory function that creates adapter instances.
   * @throws {DuplicateRuntimeError} If an adapter with the same name is already registered.
   */
  register(name: string, factory: WorkerRuntimeFactory): void {
    if (this.factories.has(name)) {
      throw new DuplicateRuntimeError(name);
    }
    this.factories.set(name, factory);
  }

  /**
   * Retrieve a worker runtime adapter instance by name.
   *
   * Invokes the registered factory to create a fresh adapter instance.
   *
   * @param name - The registered name of the adapter.
   * @returns A new adapter instance.
   * @throws {RuntimeNotFoundError} If no adapter is registered under the given name.
   */
  get(name: string): WorkerRuntime {
    const factory = this.factories.get(name);
    if (!factory) {
      throw new RuntimeNotFoundError(name);
    }
    return factory();
  }

  /**
   * Check whether an adapter is registered under the given name.
   *
   * @param name - The adapter name to check.
   * @returns `true` if a factory is registered for this name.
   */
  has(name: string): boolean {
    return this.factories.has(name);
  }

  /**
   * Get the names of all registered adapters.
   *
   * @returns An array of registered adapter names, in registration order.
   */
  getRegisteredNames(): string[] {
    return [...this.factories.keys()];
  }

  /**
   * Remove a registered adapter by name.
   *
   * @param name - The adapter name to unregister.
   * @returns `true` if the adapter was found and removed, `false` if it was not registered.
   */
  unregister(name: string): boolean {
    return this.factories.delete(name);
  }

  /**
   * Remove all registered adapters.
   *
   * Primarily useful for testing.
   */
  clear(): void {
    this.factories.clear();
  }
}
