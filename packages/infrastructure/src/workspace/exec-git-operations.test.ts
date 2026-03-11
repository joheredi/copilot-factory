/**
 * @module workspace/exec-git-operations.test
 * Integration tests for the ExecGitOperations implementation.
 *
 * These tests create real temporary git repositories and exercise the actual
 * git CLI commands. This verifies that the command arguments, output parsing,
 * and error handling work correctly with real git.
 *
 * Each test gets a fresh temporary git repository via beforeEach/afterEach
 * to ensure isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import { createExecGitOperations, parseWorktreeListOutput } from "./exec-git-operations.js";
import { GitOperationError } from "./errors.js";
import type { GitOperations } from "./types.js";

const execFile = promisify(execFileCb);

// ─── Test Helpers ──────────────────────────────────────────────────────────────

/**
 * Run a git command in the given directory.
 * Used for test setup — not the code under test.
 */
async function gitCmd(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout.trim();
}

/**
 * Initialize a temporary git repository with an initial commit.
 * Returns the path to the repo root.
 */
async function createTempRepo(): Promise<string> {
  const repoPath = await mkdtemp(join(tmpdir(), "workspace-test-"));
  await gitCmd(["init", "--initial-branch=main"], repoPath);
  await gitCmd(["config", "user.email", "test@example.com"], repoPath);
  await gitCmd(["config", "user.name", "Test User"], repoPath);
  await writeFile(join(repoPath, "README.md"), "# Test Repo\n");
  await gitCmd(["add", "."], repoPath);
  await gitCmd(["commit", "-m", "initial commit"], repoPath);
  return repoPath;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("parseWorktreeListOutput", () => {
  /**
   * @why The parser must handle the standard porcelain format from
   * `git worktree list --porcelain`, extracting path, HEAD, branch, and bare status.
   */
  it("should parse a single worktree entry", () => {
    const output = [
      "worktree /path/to/main",
      "HEAD abc123def456",
      "branch refs/heads/main",
      "",
    ].join("\n");

    const entries = parseWorktreeListOutput(output);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      path: "/path/to/main",
      head: "abc123def456",
      branch: "refs/heads/main",
      bare: false,
    });
  });

  /**
   * @why Multiple worktrees are separated by blank lines in porcelain format.
   * The parser must correctly split and parse each block independently.
   */
  it("should parse multiple worktree entries", () => {
    const output = [
      "worktree /path/to/main",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /path/to/feature",
      "HEAD def456",
      "branch refs/heads/feature",
      "",
    ].join("\n");

    const entries = parseWorktreeListOutput(output);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.path).toBe("/path/to/main");
    expect(entries[1]!.path).toBe("/path/to/feature");
  });

  /**
   * @why A bare worktree entry uses "bare" instead of a branch line.
   * The parser must detect this and set bare=true, branch=null.
   */
  it("should parse bare worktree entries", () => {
    const output = ["worktree /path/to/bare", "HEAD abc123", "bare", ""].join("\n");

    const entries = parseWorktreeListOutput(output);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.bare).toBe(true);
    expect(entries[0]!.branch).toBeNull();
  });

  /**
   * @why Empty or whitespace-only output should produce an empty array,
   * not throw or return invalid entries.
   */
  it("should return empty array for empty output", () => {
    expect(parseWorktreeListOutput("")).toEqual([]);
    expect(parseWorktreeListOutput("   \n  ")).toEqual([]);
  });
});

describe("ExecGitOperations", () => {
  let repoPath: string;
  let git: GitOperations;

  beforeEach(async () => {
    repoPath = await createTempRepo();
    git = createExecGitOperations();
  });

  afterEach(async () => {
    // Clean up worktrees before removing the repo to avoid git lock issues
    try {
      const { stdout } = await execFile("git", ["worktree", "list", "--porcelain"], {
        cwd: repoPath,
      });
      const lines = stdout.split("\n");
      for (const line of lines) {
        if (line.startsWith("worktree ") && !line.endsWith(repoPath)) {
          const wtPath = line.slice("worktree ".length);
          if (wtPath !== repoPath) {
            await execFile("git", ["worktree", "remove", wtPath, "--force"], {
              cwd: repoPath,
            }).catch(() => {
              /* ignore cleanup errors */
            });
          }
        }
      }
    } catch {
      /* ignore */
    }
    await rm(repoPath, { recursive: true, force: true });
  });

  // ─── getDefaultBranch ──────────────────────────────────────────────────

  /**
   * @why getDefaultBranch must return the current HEAD branch name, which is
   * used as the start point for new worktree branches when no baseBranch
   * is specified.
   */
  it("should return the current branch name", async () => {
    const branch = await git.getDefaultBranch(repoPath);
    expect(branch).toBe("main");
  });

  /**
   * @why If the repository path is invalid, getDefaultBranch must throw
   * a GitOperationError rather than an opaque child_process error.
   */
  it("should throw GitOperationError for invalid repo path", async () => {
    try {
      await git.getDefaultBranch("/nonexistent/path");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(GitOperationError);
    }
  });

  // ─── branchExists ─────────────────────────────────────────────────────

  /**
   * @why branchExists is used to detect conflicting branch names before
   * creating a worktree. It must correctly identify existing branches.
   */
  it("should detect existing branches", async () => {
    expect(await git.branchExists(repoPath, "main")).toBe(true);
  });

  /**
   * @why branchExists must return false for branches that don't exist,
   * without throwing an error.
   */
  it("should return false for non-existing branches", async () => {
    expect(await git.branchExists(repoPath, "nonexistent")).toBe(false);
  });

  // ─── addWorktree ──────────────────────────────────────────────────────

  /**
   * @why addWorktree must create a new worktree directory with a new branch
   * checked out, which is the core operation for workspace provisioning.
   */
  it("should create a worktree with a new branch", async () => {
    const wtPath = join(repoPath, "worktrees", "task-1");
    await git.addWorktree(repoPath, wtPath, "factory/T001", "main");

    // Verify the branch was created
    expect(await git.branchExists(repoPath, "factory/T001")).toBe(true);

    // Verify the worktree directory exists and has the correct branch
    const branch = await git.getCurrentBranch(wtPath);
    expect(branch).toBe("factory/T001");
  });

  // ─── listWorktrees ────────────────────────────────────────────────────

  /**
   * @why listWorktrees must return at least the main worktree. After adding
   * a second worktree, both should appear in the list.
   */
  it("should list all worktrees including added ones", async () => {
    const initial = await git.listWorktrees(repoPath);
    expect(initial.length).toBeGreaterThanOrEqual(1);

    const wtPath = join(repoPath, "worktrees", "task-2");
    await git.addWorktree(repoPath, wtPath, "factory/T002", "main");

    const updated = await git.listWorktrees(repoPath);
    expect(updated.length).toBe(initial.length + 1);

    const addedEntry = updated.find((e) => e.path === wtPath);
    expect(addedEntry).toBeDefined();
    expect(addedEntry!.branch).toBe("refs/heads/factory/T002");
  });

  // ─── isCleanWorkingTree ───────────────────────────────────────────────

  /**
   * @why A freshly created worktree with no modifications must be detected
   * as clean, enabling workspace reuse on retry.
   */
  it("should report clean worktree as clean", async () => {
    const wtPath = join(repoPath, "worktrees", "task-3");
    await git.addWorktree(repoPath, wtPath, "factory/T003", "main");

    expect(await git.isCleanWorkingTree(wtPath)).toBe(true);
  });

  /**
   * @why A worktree with uncommitted changes must be detected as dirty,
   * preventing reuse of a workspace in an inconsistent state.
   */
  it("should report dirty worktree as dirty", async () => {
    const wtPath = join(repoPath, "worktrees", "task-4");
    await git.addWorktree(repoPath, wtPath, "factory/T004", "main");

    // Create an untracked file to make the worktree dirty
    await writeFile(join(wtPath, "dirty.txt"), "uncommitted change\n");

    expect(await git.isCleanWorkingTree(wtPath)).toBe(false);
  });

  // ─── getCurrentBranch ─────────────────────────────────────────────────

  /**
   * @why getCurrentBranch must return the short branch name for a worktree,
   * used when reporting which branch a reused workspace is on.
   */
  it("should return the current branch name of a worktree", async () => {
    const wtPath = join(repoPath, "worktrees", "task-5");
    await git.addWorktree(repoPath, wtPath, "factory/T005", "main");

    const branch = await git.getCurrentBranch(wtPath);
    expect(branch).toBe("factory/T005");
  });

  /**
   * @why In detached HEAD state, getCurrentBranch must return null rather
   * than throwing, so the caller can handle this gracefully.
   */
  it("should return null for detached HEAD", async () => {
    const wtPath = join(repoPath, "worktrees", "task-6");
    await git.addWorktree(repoPath, wtPath, "factory/T006", "main");

    // Detach HEAD by checking out a specific commit
    const head = await gitCmd(["rev-parse", "HEAD"], wtPath);
    await gitCmd(["checkout", head], wtPath);

    const branch = await git.getCurrentBranch(wtPath);
    expect(branch).toBeNull();
  });
});
