/**
 * Tests for the workspace inspector adapter.
 *
 * These tests validate the infrastructure adapter that reads workspace state
 * during crash recovery. The adapter must correctly:
 *
 * 1. Detect filesystem-persisted result packets in the outputs directory
 * 2. Return null when no result packet exists
 * 3. Capture modified file lists via git diff --name-only
 * 4. Capture unified diffs via git diff
 * 5. Read all output files from the workspace outputs directory
 * 6. Skip directories when reading output files
 * 7. Return empty arrays for missing directories
 *
 * All tests use fakes for filesystem and git operations to avoid real I/O.
 *
 * @see docs/backlog/tasks/T072-partial-work-snapshot.md
 * @module @factory/infrastructure/crash-recovery/workspace-inspector.test
 */

import { describe, it, expect } from "vitest";

import { createWorkspaceInspector, type GitDiffProvider } from "./workspace-inspector.js";
import type { FileSystem } from "../workspace/types.js";

// ─── Fake FileSystem ────────────────────────────────────────────────────────

/**
 * In-memory filesystem fake for testing workspace inspection without real I/O.
 * Stores file contents in a Map keyed by absolute path.
 */
function createFakeFileSystem(
  files: Record<string, string> = {},
  dirs: Record<string, Array<{ name: string; isDirectory: boolean }>> = {},
): FileSystem {
  const fileMap = new Map(Object.entries(files));

  return {
    async mkdir(_path: string, _options?: { recursive?: boolean }): Promise<void> {
      /* no-op for inspection tests */
    },
    async exists(path: string): Promise<boolean> {
      return fileMap.has(path) || path in dirs;
    },
    async writeFile(_path: string, _content: string): Promise<void> {
      /* no-op for inspection tests */
    },
    async readFile(path: string): Promise<string> {
      const content = fileMap.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return content;
    },
    async unlink(_path: string): Promise<void> {
      /* no-op */
    },
    async rename(_oldPath: string, _newPath: string): Promise<void> {
      /* no-op */
    },
    async readdir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
      return dirs[path] ?? [];
    },
    async rm(_path: string, _options?: { recursive?: boolean; force?: boolean }): Promise<void> {
      /* no-op */
    },
  };
}

// ─── Fake GitDiffProvider ───────────────────────────────────────────────────

/**
 * Configurable fake git diff provider for testing.
 */
function createFakeGitDiffProvider(
  overrides: Partial<{
    modifiedFiles: readonly string[];
    diff: string | null;
    diffNameOnlyError: Error;
    diffError: Error;
  }> = {},
): GitDiffProvider {
  return {
    async diffNameOnly(_worktreePath: string): Promise<readonly string[]> {
      if (overrides.diffNameOnlyError) {
        throw overrides.diffNameOnlyError;
      }
      return overrides.modifiedFiles ?? [];
    },
    async diff(_worktreePath: string): Promise<string | null> {
      if (overrides.diffError) {
        throw overrides.diffError;
      }
      return overrides.diff ?? null;
    },
  };
}

// ─── Test Constants ─────────────────────────────────────────────────────────

const WORKSPACE_PATH = "/workspaces/repo-1/task-42";
const WORKTREE_PATH = "/workspaces/repo-1/task-42/worktree";
const OUTPUTS_DIR = "/workspaces/repo-1/task-42/outputs";
const RESULT_PACKET_PATH = "/workspaces/repo-1/task-42/outputs/result-packet.json";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("WorkspaceInspector", () => {
  describe("readResultPacket", () => {
    /**
     * Validates that the inspector detects a filesystem-persisted result packet.
     * This is the §9.8.2 network partition fallback — workers write results to
     * disk when they cannot reach the control plane.
     */
    it("returns content when result-packet.json exists in outputs directory", async () => {
      const packetContent = '{"packet_type":"dev_result_packet"}';
      const fs = createFakeFileSystem({
        [RESULT_PACKET_PATH]: packetContent,
      });
      const inspector = createWorkspaceInspector({
        fs,
        git: createFakeGitDiffProvider(),
      });

      const result = await inspector.readResultPacket(WORKSPACE_PATH);

      expect(result).toBe(packetContent);
    });

    /**
     * Validates that the inspector returns null when no result packet exists.
     * This is the common case — the worker did not write a fallback result.
     */
    it("returns null when result-packet.json does not exist", async () => {
      const fs = createFakeFileSystem({});
      const inspector = createWorkspaceInspector({
        fs,
        git: createFakeGitDiffProvider(),
      });

      const result = await inspector.readResultPacket(WORKSPACE_PATH);

      expect(result).toBeNull();
    });

    /**
     * Validates correct path construction: the result packet must be at
     * {workspacePath}/outputs/result-packet.json regardless of platform.
     */
    it("uses correct path construction for result packet", async () => {
      const paths: string[] = [];
      const fs = createFakeFileSystem({});
      const originalExists = fs.exists.bind(fs);
      fs.exists = async (path: string) => {
        paths.push(path);
        return originalExists(path);
      };

      const inspector = createWorkspaceInspector({
        fs,
        git: createFakeGitDiffProvider(),
      });
      await inspector.readResultPacket("/my/workspace");

      expect(paths).toContain("/my/workspace/outputs/result-packet.json");
    });
  });

  describe("getModifiedFiles", () => {
    /**
     * Validates that git diff --name-only output is correctly parsed into
     * an array of relative file paths.
     */
    it("returns modified files from git diff", async () => {
      const inspector = createWorkspaceInspector({
        fs: createFakeFileSystem(),
        git: createFakeGitDiffProvider({
          modifiedFiles: ["src/index.ts", "package.json"],
        }),
      });

      const result = await inspector.getModifiedFiles(WORKTREE_PATH);

      expect(result).toEqual(["src/index.ts", "package.json"]);
    });

    /**
     * Validates that an empty diff returns an empty array,
     * not an array with an empty string.
     */
    it("returns empty array when no files modified", async () => {
      const inspector = createWorkspaceInspector({
        fs: createFakeFileSystem(),
        git: createFakeGitDiffProvider({ modifiedFiles: [] }),
      });

      const result = await inspector.getModifiedFiles(WORKTREE_PATH);

      expect(result).toEqual([]);
    });
  });

  describe("getGitDiff", () => {
    /**
     * Validates that a full unified diff is returned as a string.
     * This diff is stored as an artifact for retry context.
     */
    it("returns unified diff when changes exist", async () => {
      const diffContent = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
+import { foo } from './foo';
 export function main() {}`;

      const inspector = createWorkspaceInspector({
        fs: createFakeFileSystem(),
        git: createFakeGitDiffProvider({ diff: diffContent }),
      });

      const result = await inspector.getGitDiff(WORKTREE_PATH);

      expect(result).toBe(diffContent);
    });

    /**
     * Validates that null is returned when the workspace has no changes.
     */
    it("returns null when no changes exist", async () => {
      const inspector = createWorkspaceInspector({
        fs: createFakeFileSystem(),
        git: createFakeGitDiffProvider({ diff: null }),
      });

      const result = await inspector.getGitDiff(WORKTREE_PATH);

      expect(result).toBeNull();
    });
  });

  describe("readOutputFiles", () => {
    /**
     * Validates that all files in the outputs directory are read and returned
     * with their names and contents. This captures partial work artifacts.
     */
    it("reads all files from outputs directory", async () => {
      const fs = createFakeFileSystem(
        {
          [`${OUTPUTS_DIR}/log.txt`]: "some log content",
          [`${OUTPUTS_DIR}/partial-result.json`]: '{"partial": true}',
        },
        {
          [OUTPUTS_DIR]: [
            { name: "log.txt", isDirectory: false },
            { name: "partial-result.json", isDirectory: false },
          ],
        },
      );

      const inspector = createWorkspaceInspector({
        fs,
        git: createFakeGitDiffProvider(),
      });

      const result = await inspector.readOutputFiles(WORKSPACE_PATH);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({ name: "log.txt", content: "some log content" });
      expect(result).toContainEqual({
        name: "partial-result.json",
        content: '{"partial": true}',
      });
    });

    /**
     * Validates that directories within outputs are skipped.
     * Only regular files should be captured.
     */
    it("skips directories in outputs", async () => {
      const fs = createFakeFileSystem(
        {
          [`${OUTPUTS_DIR}/file.txt`]: "content",
        },
        {
          [OUTPUTS_DIR]: [
            { name: "file.txt", isDirectory: false },
            { name: "subdir", isDirectory: true },
          ],
        },
      );

      const inspector = createWorkspaceInspector({
        fs,
        git: createFakeGitDiffProvider(),
      });

      const result = await inspector.readOutputFiles(WORKSPACE_PATH);

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("file.txt");
    });

    /**
     * Validates that a missing outputs directory returns an empty array
     * rather than throwing — the workspace may not have created outputs yet.
     */
    it("returns empty array when outputs directory does not exist", async () => {
      const fs = createFakeFileSystem({});

      const inspector = createWorkspaceInspector({
        fs,
        git: createFakeGitDiffProvider(),
      });

      const result = await inspector.readOutputFiles(WORKSPACE_PATH);

      expect(result).toEqual([]);
    });

    /**
     * Validates correct handling when outputs directory exists but is empty.
     */
    it("returns empty array when outputs directory is empty", async () => {
      const fs = createFakeFileSystem(
        {},
        {
          [OUTPUTS_DIR]: [],
        },
      );

      const inspector = createWorkspaceInspector({
        fs,
        git: createFakeGitDiffProvider(),
      });

      const result = await inspector.readOutputFiles(WORKSPACE_PATH);

      expect(result).toEqual([]);
    });
  });
});

describe("createExecGitDiffProvider", () => {
  /**
   * Validates that the production git diff provider correctly parses
   * `git diff --name-only HEAD` output into file path arrays.
   */
  it("parses git diff --name-only output into file paths", async () => {
    const { createExecGitDiffProvider } = await import("./workspace-inspector.js");
    const fakeExec = async (_cmd: string, args: readonly string[], _opts: { cwd: string }) => {
      if (args.includes("--name-only")) {
        return { stdout: "src/index.ts\npackage.json\n" };
      }
      return { stdout: "" };
    };

    const provider = createExecGitDiffProvider(fakeExec);
    const result = await provider.diffNameOnly("/workspace");

    expect(result).toEqual(["src/index.ts", "package.json"]);
  });

  /**
   * Validates that an empty diff output results in an empty array,
   * not an array containing an empty string.
   */
  it("returns empty array for empty diff output", async () => {
    const { createExecGitDiffProvider } = await import("./workspace-inspector.js");
    const fakeExec = async () => ({ stdout: "" });

    const provider = createExecGitDiffProvider(fakeExec);
    const result = await provider.diffNameOnly("/workspace");

    expect(result).toEqual([]);
  });

  /**
   * Validates that the unified diff is returned as-is when changes exist.
   */
  it("returns unified diff content", async () => {
    const { createExecGitDiffProvider } = await import("./workspace-inspector.js");
    const diffOutput = "diff --git a/file.ts b/file.ts\n+new line";
    const fakeExec = async () => ({ stdout: diffOutput + "\n" });

    const provider = createExecGitDiffProvider(fakeExec);
    const result = await provider.diff("/workspace");

    expect(result).toBe(diffOutput);
  });

  /**
   * Validates that null is returned when git diff produces no output
   * (clean working tree).
   */
  it("returns null for empty diff", async () => {
    const { createExecGitDiffProvider } = await import("./workspace-inspector.js");
    const fakeExec = async () => ({ stdout: "\n" });

    const provider = createExecGitDiffProvider(fakeExec);
    const result = await provider.diff("/workspace");

    expect(result).toBeNull();
  });
});
