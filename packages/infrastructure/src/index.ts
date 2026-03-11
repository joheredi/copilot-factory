/** @module @factory/infrastructure — Database repositories, git services, runner adapters, filesystem storage, event transport. */

// ─── Worker Runtime ──────────────────────────────────────────────────────────
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
  WorkerRuntime,
  WorkerRuntimeFactory,
} from "./worker-runtime/index.js";

export {
  RuntimeRegistry,
  RuntimeNotFoundError,
  DuplicateRuntimeError,
} from "./worker-runtime/index.js";
