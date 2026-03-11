/**
 * @module workspace/workspace-manager.test
 * Unit tests for WorkspaceManager.
 *
 * Tests the workspace provisioning orchestration logic using mocked
 * GitOperations and FileSystem dependencies. This isolates the manager's
 * decision logic (branch naming, directory layout, retry reuse, error handling)
 * from actual git and filesystem operations.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";

import { WorkspaceManager } from "./workspace-manager.js";
import { WorkspaceBranchExistsError, WorkspaceDirtyError } from "./errors.js";
import type { GitOperations, FileSystem } from "./types.js";

// ─── Mock Factories ────────────────────────────────────────────────────────────

/**
 * Create a mock GitOperations where all methods are vi.fn() stubs.
 * Callers override specific methods per test scenario.
 */
function createMockGit(
  overrides: Partial<GitOperations> = {},
): GitOperations & { [K in keyof GitOperations]: ReturnType<typeof vi.fn> } {
  return {
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    addWorktree: vi.fn().mockResolvedValue(undefined),
    listWorktrees: vi.fn().mockResolvedValue([]),
    branchExists: vi.fn().mockResolvedValue(false),
    isCleanWorkingTree: vi.fn().mockResolvedValue(true),
    getCurrentBranch: vi.fn().mockResolvedValue("factory/T001"),
    ...overrides,
  } as GitOperations & {
    [K in keyof GitOperations]: ReturnType<typeof vi.fn>;
  };
}

/**
 * Create a mock FileSystem where mkdir and exists are vi.fn() stubs.
 */
function createMockFs(
  overrides: Partial<FileSystem> = {},
): FileSystem & { [K in keyof FileSystem]: ReturnType<typeof vi.fn> } {
  return {
    mkdir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    unlink: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as FileSystem & { [K in keyof FileSystem]: ReturnType<typeof vi.fn> };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("WorkspaceManager", () => {
  const WORKSPACES_ROOT = "/workspaces";
  const REPO_PATH = "/repos/my-project";
  const TASK_ID = "T001";

  let mockGit: ReturnType<typeof createMockGit>;
  let mockFs: ReturnType<typeof createMockFs>;
  let manager: WorkspaceManager;

  beforeEach(() => {
    mockGit = createMockGit();
    mockFs = createMockFs();
    manager = new WorkspaceManager(mockGit, mockFs, WORKSPACES_ROOT);
  });

  // ─── computeBranchName ───────────────────────────────────────────────────

  describe("computeBranchName", () => {
    /**
     * @why First-attempt tasks must use `factory/{taskId}` to follow the
     * branch naming convention defined in the workspace strategy (§7.10).
     */
    it("should return factory/{taskId} for first attempt", () => {
      expect(manager.computeBranchName("T001")).toBe("factory/T001");
    });

    /**
     * @why Retry attempts must append /r{N} to distinguish retry branches
     * from the original and from each other.
     */
    it("should return factory/{taskId}/r{attempt} for retries", () => {
      expect(manager.computeBranchName("T001", 1)).toBe("factory/T001/r1");
      expect(manager.computeBranchName("T001", 3)).toBe("factory/T001/r3");
    });

    /**
     * @why attempt=0 should be treated as first attempt (not a retry).
     */
    it("should treat attempt=0 as first attempt", () => {
      expect(manager.computeBranchName("T001", 0)).toBe("factory/T001");
    });

    /**
     * @why Negative attempt numbers are nonsensical and should not trigger
     * retry naming.
     */
    it("should treat negative attempt as first attempt", () => {
      expect(manager.computeBranchName("T001", -1)).toBe("factory/T001");
    });
  });

  // ─── computeLayout ──────────────────────────────────────────────────────

  describe("computeLayout", () => {
    /**
     * @why The workspace layout must follow the §7.10 directory structure:
     * {workspacesRoot}/{repoId}/{taskId}/ with worktree/, logs/, outputs/.
     */
    it("should compute correct directory layout", () => {
      const layout = manager.computeLayout("my-project", "T001");
      const root = join(WORKSPACES_ROOT, "my-project", "T001");

      expect(layout.rootPath).toBe(root);
      expect(layout.worktreePath).toBe(join(root, "worktree"));
      expect(layout.logsPath).toBe(join(root, "logs"));
      expect(layout.outputsPath).toBe(join(root, "outputs"));
    });
  });

  // ─── createWorkspace — first attempt ─────────────────────────────────────

  describe("createWorkspace — first attempt", () => {
    /**
     * @why A new workspace must create the worktree at the correct path with
     * the factory/{taskId} branch, and create logs/ and outputs/ directories.
     */
    it("should create a new workspace with correct layout and branch", async () => {
      const result = await manager.createWorkspace({
        taskId: TASK_ID,
        repoPath: REPO_PATH,
      });

      expect(result.branchName).toBe("factory/T001");
      expect(result.reused).toBe(false);
      expect(result.layout.rootPath).toBe(join(WORKSPACES_ROOT, "my-project", "T001"));
      expect(result.layout.worktreePath).toBe(
        join(WORKSPACES_ROOT, "my-project", "T001", "worktree"),
      );
    });

    /**
     * @why The git worktree add command must receive the correct arguments:
     * worktree path, new branch name, and the base branch to start from.
     */
    it("should call git addWorktree with correct arguments", async () => {
      await manager.createWorkspace({
        taskId: TASK_ID,
        repoPath: REPO_PATH,
      });

      expect(mockGit.addWorktree).toHaveBeenCalledWith(
        REPO_PATH,
        join(WORKSPACES_ROOT, "my-project", "T001", "worktree"),
        "factory/T001",
        "main",
      );
    });

    /**
     * @why When no baseBranch is provided, the manager must detect the
     * repository's default branch via getDefaultBranch.
     */
    it("should detect default branch when baseBranch is omitted", async () => {
      mockGit.getDefaultBranch.mockResolvedValue("develop");

      const result = await manager.createWorkspace({
        taskId: TASK_ID,
        repoPath: REPO_PATH,
      });

      expect(mockGit.getDefaultBranch).toHaveBeenCalledWith(REPO_PATH);
      expect(mockGit.addWorktree).toHaveBeenCalledWith(
        REPO_PATH,
        expect.any(String),
        "factory/T001",
        "develop",
      );
      expect(result.branchName).toBe("factory/T001");
    });

    /**
     * @why An explicit baseBranch should be used directly without
     * calling getDefaultBranch.
     */
    it("should use explicit baseBranch when provided", async () => {
      await manager.createWorkspace({
        taskId: TASK_ID,
        repoPath: REPO_PATH,
        baseBranch: "release/v2",
      });

      expect(mockGit.getDefaultBranch).not.toHaveBeenCalled();
      expect(mockGit.addWorktree).toHaveBeenCalledWith(
        REPO_PATH,
        expect.any(String),
        "factory/T001",
        "release/v2",
      );
    });

    /**
     * @why The repoId in the workspace path defaults to the basename of
     * repoPath, allowing multiple repos under the same workspaces root.
     */
    it("should default repoId to basename of repoPath", async () => {
      const result = await manager.createWorkspace({
        taskId: TASK_ID,
        repoPath: "/repos/some-repo",
      });

      expect(result.layout.rootPath).toBe(join(WORKSPACES_ROOT, "some-repo", "T001"));
    });

    /**
     * @why An explicit repoId overrides the basename default, useful when
     * multiple repos share the same directory name.
     */
    it("should use explicit repoId when provided", async () => {
      const result = await manager.createWorkspace({
        taskId: TASK_ID,
        repoPath: REPO_PATH,
        repoId: "custom-id",
      });

      expect(result.layout.rootPath).toBe(join(WORKSPACES_ROOT, "custom-id", "T001"));
    });

    /**
     * @why The logs/ and outputs/ directories must be created before the
     * worktree to ensure the directory structure is ready for the worker.
     */
    it("should create root, logs, and outputs directories", async () => {
      await manager.createWorkspace({
        taskId: TASK_ID,
        repoPath: REPO_PATH,
      });

      const root = join(WORKSPACES_ROOT, "my-project", "T001");
      expect(mockFs.mkdir).toHaveBeenCalledWith(root, { recursive: true });
      expect(mockFs.mkdir).toHaveBeenCalledWith(join(root, "logs"), {
        recursive: true,
      });
      expect(mockFs.mkdir).toHaveBeenCalledWith(join(root, "outputs"), {
        recursive: true,
      });
    });

    /**
     * @why If the branch already exists, the manager must throw a clear error
     * rather than letting git fail with an opaque message.
     */
    it("should throw WorkspaceBranchExistsError if branch exists", async () => {
      mockGit.branchExists.mockResolvedValue(true);

      try {
        await manager.createWorkspace({
          taskId: TASK_ID,
          repoPath: REPO_PATH,
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkspaceBranchExistsError);
        const e = error as WorkspaceBranchExistsError;
        expect(e.branchName).toBe("factory/T001");
        expect(e.taskId).toBe("T001");
      }
    });
  });

  // ─── createWorkspace — retry attempt ─────────────────────────────────────

  describe("createWorkspace — retry attempt", () => {
    /**
     * @why When retrying and the existing workspace is clean, the manager
     * must reuse it to avoid unnecessary worktree creation overhead.
     */
    it("should reuse clean existing workspace on retry", async () => {
      mockFs.exists.mockResolvedValue(true);
      mockGit.isCleanWorkingTree.mockResolvedValue(true);
      mockGit.getCurrentBranch.mockResolvedValue("factory/T001");

      const result = await manager.createWorkspace({
        taskId: TASK_ID,
        repoPath: REPO_PATH,
        attempt: 1,
      });

      expect(result.reused).toBe(true);
      expect(result.branchName).toBe("factory/T001");
      expect(mockGit.addWorktree).not.toHaveBeenCalled();
    });

    /**
     * @why When the existing workspace has uncommitted changes, the manager
     * must throw WorkspaceDirtyError so the caller can decide how to handle
     * it (e.g., clean up or escalate).
     */
    it("should throw WorkspaceDirtyError if existing workspace is dirty", async () => {
      mockFs.exists.mockResolvedValue(true);
      mockGit.isCleanWorkingTree.mockResolvedValue(false);

      try {
        await manager.createWorkspace({
          taskId: TASK_ID,
          repoPath: REPO_PATH,
          attempt: 1,
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkspaceDirtyError);
        const e = error as WorkspaceDirtyError;
        expect(e.taskId).toBe("T001");
      }
    });

    /**
     * @why When no existing workspace is found on retry, a new worktree
     * must be created with the retry branch suffix /r{attempt}.
     */
    it("should create new workspace with retry branch if no existing workspace", async () => {
      mockFs.exists.mockResolvedValue(false);

      const result = await manager.createWorkspace({
        taskId: TASK_ID,
        repoPath: REPO_PATH,
        attempt: 2,
      });

      expect(result.reused).toBe(false);
      expect(result.branchName).toBe("factory/T001/r2");
      expect(mockGit.addWorktree).toHaveBeenCalledWith(
        REPO_PATH,
        expect.any(String),
        "factory/T001/r2",
        "main",
      );
    });

    /**
     * @why When reusing a workspace in detached HEAD state, the branch
     * name should fall back to "HEAD" to indicate the detached state.
     */
    it("should handle detached HEAD in reused workspace", async () => {
      mockFs.exists.mockResolvedValue(true);
      mockGit.isCleanWorkingTree.mockResolvedValue(true);
      mockGit.getCurrentBranch.mockResolvedValue(null);

      const result = await manager.createWorkspace({
        taskId: TASK_ID,
        repoPath: REPO_PATH,
        attempt: 1,
      });

      expect(result.reused).toBe(true);
      expect(result.branchName).toBe("HEAD");
    });
  });
});
