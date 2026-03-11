/**
 * Re-exports all fake test doubles from the @factory/testing package.
 *
 * @module @factory/testing/fakes
 */

export { FakeClock, DEFAULT_INITIAL_TIME } from "./fake-clock.js";
export { FakeWorkspaceManager } from "./fake-workspace-manager.js";
export type { FakeWorkspaceManagerConfig, TrackedWorkspace } from "./fake-workspace-manager.js";
export { FakeRunnerAdapter } from "./fake-runner-adapter.js";
export type { FakeRunnerConfig, FakeRunOutcome, FakeRunnerCall } from "./fake-runner-adapter.js";
