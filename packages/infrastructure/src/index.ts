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

export type { MountPacketsInput, MountPacketsResult } from "./workspace/index.js";

export {
  WorkspaceManager,
  GitOperationError,
  WorkspaceBranchExistsError,
  WorkspaceDirtyError,
  createExecGitOperations,
  parseWorktreeListOutput,
  createNodeFileSystem,
  WorkspacePacketMounter,
  PacketMountError,
  TASK_PACKET_FILENAME,
  RUN_CONFIG_FILENAME,
  POLICY_SNAPSHOT_FILENAME,
} from "./workspace/index.js";

// ─── Policy Enforcement ──────────────────────────────────────────────────────
export type {
  PolicyViolationArtifact,
  CommandExecutionOptions,
  CommandExecutionResult,
} from "./policy/index.js";

export {
  PolicyViolationError,
  CommandExecutionError,
  createPolicyViolationArtifact,
  validateCommand,
  executeCommand,
  setProcessRunner,
  restoreDefaultProcessRunner,
} from "./policy/index.js";
