/**
 * Crash recovery port interfaces.
 *
 * These interfaces define the contracts for workspace inspection and
 * partial artifact capture during lease reclaim. The crash recovery
 * service uses these ports to:
 *
 * 1. Check a workspace for a filesystem-persisted result packet (§9.8.2 fallback)
 * 2. Capture partial work artifacts (modified files, git diff, partial outputs)
 * 3. Store captured artifacts in the artifact store
 * 4. Update the lease record with partial artifact references
 *
 * @see docs/prd/002-data-model.md §2.8 — Worker Lease Protocol (Crash Recovery)
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8.2 — Network Partition Handling
 * @module @factory/application/ports/crash-recovery.ports
 */

// ─── Partial Work Snapshot ──────────────────────────────────────────────────

/**
 * Represents a captured partial work snapshot from a workspace after
 * a lease reclaim. Contains references to stored artifacts that preserve
 * whatever work the worker completed before failing.
 *
 * Stored as the `prior_partial_work` context in the next TaskPacket
 * so the retry worker can understand what was already done.
 *
 * @see docs/prd/002-data-model.md §2.8 — Crash Recovery
 */
export interface PartialWorkSnapshot {
  /** ISO 8601 timestamp of when the snapshot was captured. */
  readonly capturedAt: string;
  /** The lease ID that was reclaimed. */
  readonly leaseId: string;
  /** The task ID associated with the reclaimed lease. */
  readonly taskId: string;
  /**
   * List of files that were modified in the workspace relative to the base branch.
   * Empty if git diff could not be obtained.
   */
  readonly modifiedFiles: readonly string[];
  /**
   * Artifact reference path to the stored git diff output.
   * Null if no changes were detected or diff could not be captured.
   */
  readonly gitDiffRef: string | null;
  /**
   * Artifact reference paths for any partial output files found in the workspace.
   * These may include incomplete result packets, logs, or other worker outputs.
   */
  readonly partialOutputRefs: readonly string[];
  /**
   * Artifact reference path to the stored filesystem-persisted result packet,
   * if one was found but was invalid (could not be processed normally).
   * Null if no filesystem result was found at all.
   */
  readonly invalidResultPacketRef: string | null;
}

// ─── Workspace Inspector Port ───────────────────────────────────────────────

/**
 * Describes a file found in the workspace outputs directory.
 */
export interface WorkspaceOutputFile {
  /** Filename (not the full path). */
  readonly name: string;
  /** Full content of the file as a string. */
  readonly content: string;
}

/**
 * Port for inspecting workspace state during crash recovery.
 *
 * Implementations read from the workspace filesystem to detect
 * filesystem-persisted result packets and gather partial work artifacts.
 * All operations are best-effort — workspace may be in an inconsistent
 * state after a crash.
 *
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8.2 — Network Partition Handling
 */
export interface WorkspaceInspectorPort {
  /**
   * Check for and read a filesystem-persisted result packet from the workspace.
   *
   * Workers that lose connectivity to the control plane may write their result
   * packet directly to the workspace filesystem as a fallback (§9.8.2). On
   * lease reclaim, the orchestrator checks for this file before treating the
   * run as lost.
   *
   * @param workspacePath - Absolute path to the workspace root directory.
   * @returns The raw content of the result packet file, or null if not found.
   */
  readResultPacket(workspacePath: string): Promise<string | null>;

  /**
   * Get the list of files modified relative to the base branch.
   *
   * Uses `git diff --name-only` or equivalent to identify changed files.
   * Returns an empty array if the diff cannot be obtained (e.g., workspace
   * is not a valid git worktree).
   *
   * @param workspacePath - Absolute path to the workspace worktree directory.
   * @returns Array of relative file paths that were modified.
   */
  getModifiedFiles(workspacePath: string): Promise<readonly string[]>;

  /**
   * Get the unified diff of all changes relative to the base branch.
   *
   * Returns the full diff output, or null if no changes exist or the
   * diff cannot be obtained.
   *
   * @param workspacePath - Absolute path to the workspace worktree directory.
   * @returns The diff output as a string, or null.
   */
  getGitDiff(workspacePath: string): Promise<string | null>;

  /**
   * Read all output files from the workspace outputs directory.
   *
   * Returns whatever files exist in the workspace outputs path.
   * Returns an empty array if the directory doesn't exist or is empty.
   *
   * @param workspacePath - Absolute path to the workspace root directory.
   * @returns Array of output files with names and contents.
   */
  readOutputFiles(workspacePath: string): Promise<readonly WorkspaceOutputFile[]>;
}

// ─── Artifact Capture Port ──────────────────────────────────────────────────

/**
 * Port for storing crash recovery artifacts.
 *
 * Abstracts the artifact store so the crash recovery service does not
 * depend directly on infrastructure. Each method stores content and
 * returns a relative artifact reference path.
 */
export interface CrashRecoveryArtifactPort {
  /**
   * Store the git diff from a crashed workspace.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param runId - The run ID of the failed worker execution.
   * @param diffContent - The unified diff output.
   * @returns Relative artifact reference path.
   */
  storeGitDiff(repoId: string, taskId: string, runId: string, diffContent: string): Promise<string>;

  /**
   * Store a partial output file from a crashed workspace.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param runId - The run ID of the failed worker execution.
   * @param filename - Original filename of the output.
   * @param content - File content.
   * @returns Relative artifact reference path.
   */
  storePartialOutput(
    repoId: string,
    taskId: string,
    runId: string,
    filename: string,
    content: string,
  ): Promise<string>;

  /**
   * Store an invalid result packet that was found on the filesystem but
   * could not be parsed or validated.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param runId - The run ID of the failed worker execution.
   * @param content - Raw content of the invalid result packet.
   * @returns Relative artifact reference path.
   */
  storeInvalidResultPacket(
    repoId: string,
    taskId: string,
    runId: string,
    content: string,
  ): Promise<string>;

  /**
   * Store the partial work snapshot metadata as a JSON artifact.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param runId - The run ID of the failed worker execution.
   * @param snapshot - The complete partial work snapshot.
   * @returns Relative artifact reference path.
   */
  storeSnapshot(
    repoId: string,
    taskId: string,
    runId: string,
    snapshot: PartialWorkSnapshot,
  ): Promise<string>;
}

// ─── Lease Update Port ──────────────────────────────────────────────────────

/**
 * Port for updating the lease record with partial artifact references
 * after crash recovery capture.
 *
 * This is a narrow port — it only exposes the operation needed to set
 * `partial_result_artifact_refs` on a lease that has already been reclaimed.
 */
export interface CrashRecoveryLeasePort {
  /**
   * Update the partial result artifact references on a reclaimed lease.
   *
   * @param leaseId - The reclaimed lease to update.
   * @param artifactRefs - Array of relative artifact reference paths.
   */
  updatePartialArtifactRefs(leaseId: string, artifactRefs: readonly string[]): Promise<void>;
}

// ─── Result Packet Validator Port ───────────────────────────────────────────

/**
 * Port for validating a filesystem-persisted result packet.
 *
 * Determines whether a raw string found in the workspace is a valid,
 * processable result packet or just garbage/partial content.
 */
export interface ResultPacketValidatorPort {
  /**
   * Validate raw content as a result packet.
   *
   * @param content - Raw string content from the filesystem.
   * @returns Object with `valid` flag and parsed data if valid.
   */
  validate(content: string): ResultPacketValidation;
}

/**
 * Outcome of validating a filesystem-persisted result packet.
 */
export type ResultPacketValidation =
  | { readonly valid: true; readonly data: unknown }
  | { readonly valid: false; readonly reason: string };
