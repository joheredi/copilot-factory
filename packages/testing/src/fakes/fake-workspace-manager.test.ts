import { describe, it, expect } from "vitest";

import { FakeWorkspaceManager } from "./fake-workspace-manager.js";

/**
 * Tests for FakeWorkspaceManager — in-memory workspace provider.
 *
 * The WorkspaceProviderPort is used by the worker supervisor to create
 * isolated worktrees for each task. This fake enables integration tests
 * to verify workspace creation/cleanup flows without touching the filesystem.
 */
describe("FakeWorkspaceManager", () => {
  /**
   * Validates basic workspace creation with deterministic paths.
   * Integration tests assert on exact workspace paths to verify
   * correct wiring between supervisor and workspace manager.
   */
  it("creates a workspace with deterministic paths", async () => {
    const mgr = new FakeWorkspaceManager();
    const result = await mgr.createWorkspace("task-1", "/repo");

    expect(result.layout.rootPath).toBe("/fake-workspaces/task-1");
    expect(result.layout.worktreePath).toBe("/fake-workspaces/task-1/worktree");
    expect(result.layout.logsPath).toBe("/fake-workspaces/task-1/logs");
    expect(result.layout.outputsPath).toBe("/fake-workspaces/task-1/outputs");
    expect(result.branchName).toBe("factory/task-1");
    expect(result.reused).toBe(false);
  });

  /**
   * Validates that retry attempts produce distinct branch names.
   * The merge pipeline needs separate branches for rework attempts.
   */
  it("encodes attempt number in branch name", async () => {
    const mgr = new FakeWorkspaceManager();
    const result = await mgr.createWorkspace("task-1", "/repo", 2);

    expect(result.branchName).toBe("factory/task-1/r2");
  });

  /**
   * Validates workspace tracking for assertion in integration tests.
   * Tests verify that the supervisor created the expected workspaces.
   */
  it("tracks created workspaces", async () => {
    const mgr = new FakeWorkspaceManager();
    await mgr.createWorkspace("task-1", "/repo");
    await mgr.createWorkspace("task-2", "/repo", 1);

    expect(mgr.createdWorkspaces).toHaveLength(2);
    expect(mgr.createdWorkspaces[0]!.taskId).toBe("task-1");
    expect(mgr.createdWorkspaces[0]!.repoPath).toBe("/repo");
    expect(mgr.createdWorkspaces[1]!.taskId).toBe("task-2");
    expect(mgr.createdWorkspaces[1]!.attempt).toBe(1);
  });

  /**
   * Validates custom base path for tests that need workspace paths
   * under a specific directory structure.
   */
  it("supports custom base path", async () => {
    const mgr = new FakeWorkspaceManager({ basePath: "/custom" });
    const result = await mgr.createWorkspace("task-1", "/repo");

    expect(result.layout.rootPath).toBe("/custom/task-1");
  });

  /**
   * Validates error injection for testing workspace creation failures.
   * The supervisor must handle workspace creation errors gracefully.
   */
  it("throws configured createError", async () => {
    const error = new Error("Workspace creation failed");
    const mgr = new FakeWorkspaceManager({ createError: error });

    await expect(mgr.createWorkspace("task-1", "/repo")).rejects.toThrow(
      "Workspace creation failed",
    );
  });

  /**
   * Validates cleanup tracking for verifying workspace teardown.
   */
  it("tracks cleaned workspaces", async () => {
    const mgr = new FakeWorkspaceManager();
    await mgr.cleanupWorkspace("task-1");
    await mgr.cleanupWorkspace("task-2");

    expect(mgr.cleanedWorkspaces).toEqual(["task-1", "task-2"]);
  });

  /**
   * Validates cleanup error injection for testing failure paths.
   */
  it("throws configured cleanupError", async () => {
    const error = new Error("Cleanup failed");
    const mgr = new FakeWorkspaceManager({ cleanupError: error });

    await expect(mgr.cleanupWorkspace("task-1")).rejects.toThrow("Cleanup failed");
  });

  /**
   * Validates reset() clears all tracked state for test isolation.
   */
  it("resets all tracked state", async () => {
    const mgr = new FakeWorkspaceManager();
    await mgr.createWorkspace("task-1", "/repo");
    await mgr.cleanupWorkspace("task-2");
    mgr.reset();

    expect(mgr.createdWorkspaces).toHaveLength(0);
    expect(mgr.cleanedWorkspaces).toHaveLength(0);
  });
});
