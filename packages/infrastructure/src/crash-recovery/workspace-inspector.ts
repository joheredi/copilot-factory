/**
 * Infrastructure adapter implementing {@link WorkspaceInspectorPort} for crash recovery.
 *
 * Inspects a workspace's filesystem and git state to capture partial work
 * artifacts when a lease is reclaimed. Uses the {@link FileSystem} abstraction
 * for filesystem access and a {@link GitDiffProvider} for git operations,
 * enabling full testability without real I/O.
 *
 * All operations are best-effort — a crashed workspace may be in any state,
 * and no single failure should prevent inspection of other aspects.
 *
 * @see docs/prd/002-data-model.md §2.8 — Worker Lease Protocol (Crash Recovery)
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8.2 — Network Partition Handling
 * @see docs/backlog/tasks/T072-partial-work-snapshot.md
 * @module @factory/infrastructure/crash-recovery/workspace-inspector
 */

import { join } from "node:path";

import type { FileSystem } from "../workspace/types.js";
import type { WorkspaceInspectorPort, WorkspaceOutputFile } from "@factory/application";

// ─── Result Packet Filename ─────────────────────────────────────────────────

/**
 * Well-known filename for the filesystem-persisted result packet.
 * Workers write to this file as a network partition fallback (§9.8.2).
 */
const RESULT_PACKET_FILENAME = "result-packet.json";

// ─── Git Diff Provider ──────────────────────────────────────────────────────

/**
 * Minimal abstraction over git diff operations needed for workspace inspection.
 *
 * Separated from the full {@link GitOperations} interface because crash
 * recovery only needs diff commands, not workspace management operations.
 */
export interface GitDiffProvider {
  /**
   * Get the list of modified files relative to HEAD.
   * Equivalent to `git diff --name-only HEAD` in the worktree.
   *
   * @param worktreePath - Absolute path to the git worktree.
   * @returns Array of relative file paths that were modified.
   * @throws If the git command fails.
   */
  diffNameOnly(worktreePath: string): Promise<readonly string[]>;

  /**
   * Get the unified diff of all changes relative to HEAD.
   * Equivalent to `git diff HEAD` in the worktree.
   *
   * @param worktreePath - Absolute path to the git worktree.
   * @returns The unified diff output, or null if no changes.
   * @throws If the git command fails.
   */
  diff(worktreePath: string): Promise<string | null>;
}

// ─── Dependencies ───────────────────────────────────────────────────────────

/**
 * Dependencies injected into the workspace inspector adapter.
 */
export interface WorkspaceInspectorDependencies {
  /** Filesystem abstraction for reading files and directories. */
  readonly fs: FileSystem;
  /** Git diff provider for capturing workspace changes. */
  readonly git: GitDiffProvider;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a {@link WorkspaceInspectorPort} adapter backed by filesystem and git.
 *
 * The inspector reads workspace state during crash recovery to capture:
 * - Filesystem-persisted result packets (§9.8.2 fallback)
 * - Modified file lists via `git diff --name-only`
 * - Full unified diffs via `git diff`
 * - Output files from the workspace outputs directory
 *
 * @param deps - Filesystem and git dependencies.
 * @returns A WorkspaceInspectorPort implementation.
 *
 * @see docs/backlog/tasks/T072-partial-work-snapshot.md
 */
export function createWorkspaceInspector(
  deps: WorkspaceInspectorDependencies,
): WorkspaceInspectorPort {
  const { fs, git } = deps;

  return {
    async readResultPacket(workspacePath: string): Promise<string | null> {
      const packetPath = join(workspacePath, "outputs", RESULT_PACKET_FILENAME);
      const exists = await fs.exists(packetPath);
      if (!exists) {
        return null;
      }
      return await fs.readFile(packetPath);
    },

    async getModifiedFiles(worktreePath: string): Promise<readonly string[]> {
      return await git.diffNameOnly(worktreePath);
    },

    async getGitDiff(worktreePath: string): Promise<string | null> {
      return await git.diff(worktreePath);
    },

    async readOutputFiles(workspacePath: string): Promise<readonly WorkspaceOutputFile[]> {
      const outputsDir = join(workspacePath, "outputs");
      const exists = await fs.exists(outputsDir);
      if (!exists) {
        return [];
      }

      const entries = await fs.readdir(outputsDir);
      const files: WorkspaceOutputFile[] = [];

      for (const entry of entries) {
        if (entry.isDirectory) {
          continue;
        }
        const filePath = join(outputsDir, entry.name);
        const content = await fs.readFile(filePath);
        files.push({ name: entry.name, content });
      }

      return files;
    },
  };
}

// ─── Production Git Diff Provider ───────────────────────────────────────────

/**
 * Create a {@link GitDiffProvider} that executes real git commands.
 *
 * Uses `child_process.execFile` (not `exec`) to avoid shell interpretation,
 * preventing command injection. Follows the same safety pattern as
 * {@link createExecGitOperations}.
 *
 * @param execFileFn - Optional custom execFile function for testing.
 *   Defaults to `node:child_process.execFile` promisified.
 * @returns A GitDiffProvider backed by the git CLI.
 */
export function createExecGitDiffProvider(
  execFileFn?: (
    cmd: string,
    args: readonly string[],
    options: { cwd: string },
  ) => Promise<{ stdout: string }>,
): GitDiffProvider {
  const exec =
    execFileFn ??
    (async (cmd: string, args: readonly string[], options: { cwd: string }) => {
      const { execFile: execFileCb } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFileCb);
      return execFileAsync(cmd, [...args], { cwd: options.cwd });
    });

  return {
    async diffNameOnly(worktreePath: string): Promise<readonly string[]> {
      const { stdout } = await exec("git", ["diff", "--name-only", "HEAD"], {
        cwd: worktreePath,
      });
      const trimmed = stdout.trim();
      if (trimmed === "") {
        return [];
      }
      return trimmed.split("\n");
    },

    async diff(worktreePath: string): Promise<string | null> {
      const { stdout } = await exec("git", ["diff", "HEAD"], {
        cwd: worktreePath,
      });
      const trimmed = stdout.trim();
      return trimmed === "" ? null : trimmed;
    },
  };
}
