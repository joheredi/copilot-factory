/**
 * @module @factory/testing — Fakes, fixtures, test helpers, and shared test infrastructure.
 *
 * Provides reusable utilities for tests across all packages in the monorepo.
 * Import from `@factory/testing` in test files to access helpers.
 *
 * ## Available exports
 *
 * ### Core utilities
 * - `createTestId(prefix?)` — unique test IDs
 * - `createSequentialId(prefix?)` — deterministic sequential IDs
 * - `sleep(ms)` — async delay
 *
 * ### Fakes (test doubles)
 * - `FakeClock` — deterministic time control
 * - `FakeWorkspaceManager` — in-memory workspace provider
 * - `FakeRunnerAdapter` — configurable worker runtime adapter
 *
 * ### Fixtures (entity factories)
 * - `createTestProject()`, `createTestTask()`, etc. — domain entity factories
 *
 * ### Database
 * - `createTestDatabase()` — in-memory SQLite with migrations
 *
 * ### Helpers
 * - `runTaskToState()` — drive task through lifecycle to a target state
 * - `findTransitionPath()` — compute shortest state transition path
 */

// ─── Core utilities ─────────────────────────────────────────────────────────

/**
 * Generates a unique test identifier with an optional prefix.
 * Useful for creating unique entity IDs in tests to avoid collisions
 * between concurrent or repeated test runs.
 *
 * @param prefix - String prefix for the generated ID. Defaults to `"test"`.
 * @returns A unique string in the format `{prefix}-{timestamp}-{random}`.
 *
 * @example
 * ```ts
 * const taskId = createTestId("task");
 * // => "task-1710000000000-a1b2c3d"
 * ```
 */
export function createTestId(prefix = "test"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Creates a deterministic test identifier using a counter instead of timestamps.
 * Useful when tests need predictable, reproducible IDs.
 *
 * @returns A factory function that generates sequential IDs with the given prefix.
 *
 * @example
 * ```ts
 * const nextId = createSequentialId("task");
 * nextId(); // => "task-1"
 * nextId(); // => "task-2"
 * ```
 */
export function createSequentialId(prefix = "test"): () => string {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

/**
 * Pauses execution for the specified number of milliseconds.
 * Useful for testing time-dependent behavior or simulating async delays.
 *
 * @param ms - Number of milliseconds to wait.
 * @returns A promise that resolves after the specified delay.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Fakes ──────────────────────────────────────────────────────────────────

export { FakeClock, DEFAULT_INITIAL_TIME } from "./fakes/index.js";
export { FakeWorkspaceManager } from "./fakes/index.js";
export type {
  FakeWorkspaceManagerConfig,
  TrackedWorkspace,
  TrackedCleanup,
} from "./fakes/index.js";
export { FakeRunnerAdapter } from "./fakes/index.js";
export type { FakeRunnerConfig, FakeRunOutcome, FakeRunnerCall } from "./fakes/index.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

export {
  createTestProject,
  createTestRepository,
  createTestTask,
  createTestWorkerPool,
  createTestTaskLease,
  createTestReviewCycle,
  createTestMergeQueueItem,
  createTestJob,
  createTestValidationRun,
  createTestSupervisedWorker,
  createTestAuditEvent,
  createTestPacket,
  createTestAgentProfile,
} from "./fixtures/index.js";

export type {
  TestProject,
  TestRepository,
  TestTask,
  TestWorkerPool,
  TestTaskLease,
  TestReviewCycle,
  TestMergeQueueItem,
  TestJob,
  TestValidationRun,
  TestSupervisedWorker,
  TestAuditEvent,
  TestPacket,
  TestAgentProfile,
} from "./fixtures/index.js";

// ─── Database ───────────────────────────────────────────────────────────────

export { createTestDatabase } from "./database/index.js";
export type { TestDatabaseConnection, TestDatabaseConfig } from "./database/index.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

export { runTaskToState, findTransitionPath } from "./helpers/index.js";
export type {
  RunTaskToStateResult,
  RunTaskToStateOptions,
  TransitionCallback,
} from "./helpers/index.js";
