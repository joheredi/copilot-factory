/**
 * @module worker-runtime
 *
 * Worker runtime adapter contract and registration mechanism.
 *
 * This module defines the pluggable interface for execution backends and
 * provides a registry for adapter discovery at dispatch time. All
 * orchestration code interacts with workers exclusively through the
 * {@link WorkerRuntime} interface.
 *
 * @see docs/prd/010-integration-contracts.md §10.8
 * @see docs/prd/007-technical-architecture.md §7.9
 */

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  RunStatus,
  WorkspacePaths,
  TimeoutSettings,
  OutputSchemaExpectation,
  RunContext,
  PreparedRun,
  RunOutputStream,
  RunLogEntry,
  CancelResult,
  CollectedArtifacts,
  FinalizeResult,
} from "./types.js";

// ─── Interface ───────────────────────────────────────────────────────────────
export type { WorkerRuntime } from "./runtime.interface.js";

// ─── Registry ────────────────────────────────────────────────────────────────
export type { WorkerRuntimeFactory } from "./registry.js";
export { RuntimeRegistry, RuntimeNotFoundError, DuplicateRuntimeError } from "./registry.js";
