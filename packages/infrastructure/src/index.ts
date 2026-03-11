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

// ─── Workspace Management ────────────────────────────────────────────────────
export type {
  WorkspaceLayout,
  WorkspaceResult,
  CreateWorkspaceOptions,
  WorktreeEntry,
  GitOperations,
  FileSystem,
} from "./workspace/index.js";

export {
  WorkspaceManager,
  GitOperationError,
  WorkspaceBranchExistsError,
  WorkspaceDirtyError,
  createExecGitOperations,
  parseWorktreeListOutput,
  createNodeFileSystem,
} from "./workspace/index.js";
