/**
 * @module workspace/exec-git-operations
 * Production implementation of {@link GitOperations} using `child_process.execFile`.
 * Executes git CLI commands directly without shell interpretation for safety.
 *
 * @see docs/prd/007-technical-architecture.md §7.10 — Workspace Strategy
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import type { GitOperations, WorktreeEntry } from "./types.js";
import { GitOperationError } from "./errors.js";

const execFile = promisify(execFileCb);

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Execute a git command and return stdout.
 * All errors are wrapped in {@link GitOperationError} with full command context.
 *
 * @param args - Arguments to pass to git (e.g., ["status", "--porcelain"]).
 * @param cwd - Working directory for the git command.
 * @returns Standard output from git.
 * @throws {GitOperationError} If the git command exits with a non-zero code.
 */
async function git(args: readonly string[], cwd: string): Promise<string> {
  const command = `git ${args.join(" ")}`;
  try {
    const { stdout } = await execFile("git", [...args], { cwd });
    return stdout;
  } catch (error: unknown) {
    const err = error as { code?: number; stderr?: string };
    throw new GitOperationError(command, err.code ?? null, err.stderr ?? String(error));
  }
}

/**
 * Parse the porcelain output of `git worktree list --porcelain` into
 * structured {@link WorktreeEntry} objects.
 *
 * The porcelain format consists of blocks separated by blank lines:
 * ```
 * worktree /path/to/main
 * HEAD abc123
 * branch refs/heads/main
 *
 * worktree /path/to/worktree
 * HEAD def456
 * branch refs/heads/feature
 * ```
 *
 * @param output - Raw output from `git worktree list --porcelain`.
 * @returns Parsed array of worktree entries.
 */
export function parseWorktreeListOutput(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  if (!output.trim()) {
    return entries;
  }

  const blocks = output.trim().split("\n\n");

  for (const block of blocks) {
    if (!block.trim()) continue;

    const lines = block.trim().split("\n");
    let path = "";
    let head = "";
    let branch: string | null = null;
    let bare = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length);
      } else if (line === "bare") {
        bare = true;
      }
    }

    if (path) {
      entries.push({ path, head, branch, bare });
    }
  }

  return entries;
}

// ─── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a {@link GitOperations} implementation backed by the git CLI.
 *
 * Uses `execFile` (not `exec`) to avoid shell interpretation of arguments,
 * preventing command injection. Each operation maps directly to a git
 * subcommand with well-defined arguments.
 *
 * @returns A GitOperations instance that executes real git commands.
 */
export function createExecGitOperations(): GitOperations {
  return {
    async getDefaultBranch(repoPath: string): Promise<string> {
      const output = await git(["symbolic-ref", "--short", "HEAD"], repoPath);
      return output.trim();
    },

    async addWorktree(
      repoPath: string,
      worktreePath: string,
      branchName: string,
      startPoint: string,
    ): Promise<void> {
      await git(["worktree", "add", worktreePath, "-b", branchName, startPoint], repoPath);
    },

    async listWorktrees(repoPath: string): Promise<readonly WorktreeEntry[]> {
      const output = await git(["worktree", "list", "--porcelain"], repoPath);
      return parseWorktreeListOutput(output);
    },

    async branchExists(repoPath: string, branchName: string): Promise<boolean> {
      try {
        await git(["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], repoPath);
        return true;
      } catch {
        return false;
      }
    },

    async isCleanWorkingTree(worktreePath: string): Promise<boolean> {
      const output = await git(["status", "--porcelain"], worktreePath);
      return output.trim() === "";
    },

    async getCurrentBranch(worktreePath: string): Promise<string | null> {
      try {
        const output = await git(["symbolic-ref", "--short", "HEAD"], worktreePath);
        return output.trim();
      } catch {
        return null;
      }
    },
  };
}
