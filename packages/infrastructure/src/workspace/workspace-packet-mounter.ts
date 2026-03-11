/**
 * @module workspace/workspace-packet-mounter
 * Mounts task packet, run config, and effective policy snapshot files into a
 * workspace directory before worker execution.
 *
 * The workspace layout places these JSON files alongside the worktree/ directory:
 * ```text
 * {workspaceRoot}/
 *   worktree/                        ← git worktree (created by WorkspaceManager)
 *   task-packet.json                 ← mounted by this module
 *   run-config.json                  ← mounted by this module
 *   effective-policy-snapshot.json   ← mounted by this module
 *   logs/
 *   outputs/
 * ```
 *
 * All writes are verified by reading back and parsing the written JSON.
 * If any write or verification fails, all previously written files in the
 * current mount operation are cleaned up before the error is propagated.
 *
 * @see docs/prd/007-technical-architecture.md §7.10 — Workspace Strategy
 * @see docs/prd/007-technical-architecture.md §7.6 — Workspace Module
 */

import { join } from "node:path";

import type { FileSystem } from "./types.js";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Filename for the task packet JSON in the workspace root. */
export const TASK_PACKET_FILENAME = "task-packet.json";

/** Filename for the run config JSON in the workspace root. */
export const RUN_CONFIG_FILENAME = "run-config.json";

/** Filename for the effective policy snapshot JSON in the workspace root. */
export const POLICY_SNAPSHOT_FILENAME = "effective-policy-snapshot.json";

// ─── Error ─────────────────────────────────────────────────────────────────────

/**
 * Thrown when workspace packet mounting fails. Captures the workspace path,
 * the specific file that caused the failure, and the underlying error.
 */
export class PacketMountError extends Error {
  /** Workspace root directory where mounting was attempted. */
  readonly workspacePath: string;
  /** The file that caused the failure (e.g., "task-packet.json"). */
  readonly failedFile: string;
  /** The underlying error that caused the mount failure. */
  readonly cause: unknown;

  constructor(workspacePath: string, failedFile: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to mount "${failedFile}" in workspace "${workspacePath}": ${causeMessage}`);
    this.name = "PacketMountError";
    this.workspacePath = workspacePath;
    this.failedFile = failedFile;
    this.cause = cause;
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Input data for mounting workspace packets.
 * All fields must be JSON-serializable objects.
 */
export interface MountPacketsInput {
  /** The task packet data to write as task-packet.json. */
  readonly taskPacket: Record<string, unknown>;
  /** The run configuration data to write as run-config.json. */
  readonly runConfig: Record<string, unknown>;
  /** The effective policy snapshot to write as effective-policy-snapshot.json. */
  readonly policySnapshot: Record<string, unknown>;
}

/**
 * Result of a successful mount operation.
 * Contains the absolute paths to all mounted files.
 */
export interface MountPacketsResult {
  /** Absolute path to the written task-packet.json. */
  readonly taskPacketPath: string;
  /** Absolute path to the written run-config.json. */
  readonly runConfigPath: string;
  /** Absolute path to the written effective-policy-snapshot.json. */
  readonly policySnapshotPath: string;
}

// ─── Workspace Packet Mounter ──────────────────────────────────────────────────

/**
 * Mounts context files (task packet, run config, policy snapshot) into a
 * workspace directory before worker execution begins.
 *
 * **Atomicity guarantee:** If any file write or verification fails, all
 * files written in the current mount operation are removed before the error
 * is propagated. This prevents workers from starting with partial context.
 *
 * **Verification:** After writing each file, it is read back and parsed as
 * JSON to confirm the written content is valid and readable.
 */
export class WorkspacePacketMounter {
  private readonly fs: FileSystem;

  /**
   * @param fs - Filesystem implementation for file I/O operations.
   */
  constructor(fs: FileSystem) {
    this.fs = fs;
  }

  /**
   * Mount all workspace packets into the given workspace directory.
   *
   * Writes task-packet.json, run-config.json, and effective-policy-snapshot.json
   * to the workspace root. Each file is verified after writing by reading it
   * back and parsing the JSON content.
   *
   * @param workspacePath - Absolute path to the workspace root directory.
   * @param input - The packet data to mount.
   * @returns Paths to all mounted files.
   * @throws {PacketMountError} If any file write or verification fails.
   *         Partial files are cleaned up before throwing.
   */
  async mountPackets(workspacePath: string, input: MountPacketsInput): Promise<MountPacketsResult> {
    const filesToWrite: Array<{ filename: string; data: Record<string, unknown> }> = [
      { filename: TASK_PACKET_FILENAME, data: input.taskPacket },
      { filename: RUN_CONFIG_FILENAME, data: input.runConfig },
      { filename: POLICY_SNAPSHOT_FILENAME, data: input.policySnapshot },
    ];

    const writtenPaths: string[] = [];

    for (const { filename, data } of filesToWrite) {
      const filePath = join(workspacePath, filename);
      try {
        await this.writeAndVerify(filePath, data);
        writtenPaths.push(filePath);
      } catch (err: unknown) {
        // Include the current file in cleanup — it may have been written
        // before verification failed
        await this.cleanupFiles([...writtenPaths, filePath]);
        throw new PacketMountError(workspacePath, filename, err);
      }
    }

    return {
      taskPacketPath: join(workspacePath, TASK_PACKET_FILENAME),
      runConfigPath: join(workspacePath, RUN_CONFIG_FILENAME),
      policySnapshotPath: join(workspacePath, POLICY_SNAPSHOT_FILENAME),
    };
  }

  /**
   * Remove all mounted packet files from a workspace directory.
   *
   * Best-effort cleanup — does not throw if files are already absent.
   * Useful for workspace teardown or re-mounting with updated data.
   *
   * @param workspacePath - Absolute path to the workspace root directory.
   */
  async unmountPackets(workspacePath: string): Promise<void> {
    const filenames = [TASK_PACKET_FILENAME, RUN_CONFIG_FILENAME, POLICY_SNAPSHOT_FILENAME];
    const paths = filenames.map((f) => join(workspacePath, f));
    await this.cleanupFiles(paths);
  }

  /**
   * Serialize data to JSON, write to disk, then read back and parse
   * to confirm the file is valid and readable.
   *
   * @param filePath - Absolute path to write the JSON file.
   * @param data - Data to serialize and write.
   * @throws If serialization, writing, or verification fails.
   */
  private async writeAndVerify(filePath: string, data: Record<string, unknown>): Promise<void> {
    // Serialize with 2-space indent for readability and debuggability
    const json = JSON.stringify(data, null, 2);

    // Write the file
    await this.fs.writeFile(filePath, json);

    // Verify: read back and parse to confirm validity
    const readBack = await this.fs.readFile(filePath);
    JSON.parse(readBack);
  }

  /**
   * Remove a list of files, ignoring errors for files that don't exist.
   * Best-effort: continues cleanup even if individual deletes fail.
   *
   * @param paths - Absolute file paths to remove.
   */
  private async cleanupFiles(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      try {
        await this.fs.unlink(path);
      } catch {
        // Best-effort cleanup — ignore failures
      }
    }
  }
}
