/**
 * @module workspace/workspace-packet-mounter.test
 * Unit tests for WorkspacePacketMounter.
 *
 * Tests the workspace packet mounting logic using a mocked FileSystem.
 * This isolates the mounter's write-verify-cleanup orchestration from
 * actual filesystem operations.
 *
 * **Why these tests matter:**
 * - Workers depend on valid context files to execute correctly.
 *   Mounting invalid or incomplete files leads to silent worker failures.
 * - The cleanup-on-failure guarantee prevents workers from starting with
 *   partial context, which could cause incorrect behavior without errors.
 * - Verification (read-back + parse) catches silent write corruption or
 *   filesystem issues that wouldn't be caught by a write-only approach.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";

import {
  WorkspacePacketMounter,
  PacketMountError,
  TASK_PACKET_FILENAME,
  RUN_CONFIG_FILENAME,
  POLICY_SNAPSHOT_FILENAME,
} from "./workspace-packet-mounter.js";
import type { FileSystem } from "./types.js";
import type { MountPacketsInput } from "./workspace-packet-mounter.js";

// ─── Mock Factory ──────────────────────────────────────────────────────────────

/**
 * Create a mock FileSystem with all methods as vi.fn() stubs.
 * By default, writeFile succeeds and readFile returns valid JSON for
 * whatever was last "written" (tracked by the written map).
 */
function createMockFs(
  overrides: Partial<FileSystem> = {},
): FileSystem & { [K in keyof FileSystem]: ReturnType<typeof vi.fn> } {
  const written = new Map<string, string>();

  return {
    mkdir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    writeFile: vi.fn().mockImplementation(async (path: string, content: string) => {
      written.set(path, content);
    }),
    readFile: vi.fn().mockImplementation(async (path: string) => {
      const content = written.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file: ${path}`);
      }
      return content;
    }),
    unlink: vi.fn().mockImplementation(async (path: string) => {
      written.delete(path);
    }),
    rename: vi.fn().mockImplementation(async (oldPath: string, newPath: string) => {
      const content = written.get(oldPath);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file: ${oldPath}`);
      }
      written.delete(oldPath);
      written.set(newPath, content);
    }),
    ...overrides,
  } as FileSystem & { [K in keyof FileSystem]: ReturnType<typeof vi.fn> };
}

// ─── Test Data ─────────────────────────────────────────────────────────────────

const WORKSPACE_PATH = "/workspaces/repo-a/task-123";

const SAMPLE_TASK_PACKET: Record<string, unknown> = {
  packet_type: "task_packet",
  schema_version: "1.0",
  task_id: "task-123",
  task: {
    title: "Implement feature X",
    description: "Full description",
  },
};

const SAMPLE_RUN_CONFIG: Record<string, unknown> = {
  time_budget_seconds: 600,
  max_retries: 3,
  log_level: "info",
};

const SAMPLE_POLICY_SNAPSHOT: Record<string, unknown> = {
  command_policy: { allowed_commands: ["npm test", "npm run build"] },
  file_scope_policy: { allowed_paths: ["src/**"] },
};

function createSampleInput(): MountPacketsInput {
  return {
    taskPacket: SAMPLE_TASK_PACKET,
    runConfig: SAMPLE_RUN_CONFIG,
    policySnapshot: SAMPLE_POLICY_SNAPSHOT,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("WorkspacePacketMounter", () => {
  let mockFs: FileSystem & { [K in keyof FileSystem]: ReturnType<typeof vi.fn> };
  let mounter: WorkspacePacketMounter;

  beforeEach(() => {
    mockFs = createMockFs();
    mounter = new WorkspacePacketMounter(mockFs);
  });

  // ─── mountPackets: successful write ────────────────────────────────────────

  describe("mountPackets", () => {
    /**
     * Core happy path: all three files are written with correct content.
     * Validates that the mounter serializes data to pretty-printed JSON
     * and writes to the expected file paths in the workspace root.
     */
    it("writes all three JSON files to the workspace root", async () => {
      const result = await mounter.mountPackets(WORKSPACE_PATH, createSampleInput());

      // Verify all three files were written
      expect(mockFs.writeFile).toHaveBeenCalledTimes(3);

      // Verify task-packet.json
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        join(WORKSPACE_PATH, TASK_PACKET_FILENAME),
        JSON.stringify(SAMPLE_TASK_PACKET, null, 2),
      );

      // Verify run-config.json
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        join(WORKSPACE_PATH, RUN_CONFIG_FILENAME),
        JSON.stringify(SAMPLE_RUN_CONFIG, null, 2),
      );

      // Verify effective-policy-snapshot.json
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        join(WORKSPACE_PATH, POLICY_SNAPSHOT_FILENAME),
        JSON.stringify(SAMPLE_POLICY_SNAPSHOT, null, 2),
      );

      // Verify result paths
      expect(result.taskPacketPath).toBe(join(WORKSPACE_PATH, TASK_PACKET_FILENAME));
      expect(result.runConfigPath).toBe(join(WORKSPACE_PATH, RUN_CONFIG_FILENAME));
      expect(result.policySnapshotPath).toBe(join(WORKSPACE_PATH, POLICY_SNAPSHOT_FILENAME));
    });

    /**
     * Verification step: after writing, each file must be read back and
     * parsed as JSON. This catches silent write corruption.
     */
    it("verifies each file by reading back and parsing JSON", async () => {
      await mounter.mountPackets(WORKSPACE_PATH, createSampleInput());

      // readFile should be called once per file for verification
      expect(mockFs.readFile).toHaveBeenCalledTimes(3);
      expect(mockFs.readFile).toHaveBeenCalledWith(join(WORKSPACE_PATH, TASK_PACKET_FILENAME));
      expect(mockFs.readFile).toHaveBeenCalledWith(join(WORKSPACE_PATH, RUN_CONFIG_FILENAME));
      expect(mockFs.readFile).toHaveBeenCalledWith(join(WORKSPACE_PATH, POLICY_SNAPSHOT_FILENAME));
    });

    /**
     * Files are written in a deterministic order: task-packet, run-config,
     * then policy-snapshot. This matters for the cleanup guarantee.
     */
    it("writes files in deterministic order", async () => {
      const writeOrder: string[] = [];
      mockFs.writeFile.mockImplementation(async (path: string, content: string) => {
        writeOrder.push(path);
        // Store for readFile mock
        (mockFs as unknown as { _store: Map<string, string> })._store =
          (mockFs as unknown as { _store: Map<string, string> })._store ?? new Map();
        (mockFs as unknown as { _store: Map<string, string> })._store.set(path, content);
      });
      mockFs.readFile.mockImplementation(async (path: string) => {
        const store = (mockFs as unknown as { _store: Map<string, string> })._store;
        return store?.get(path) ?? "";
      });

      await mounter.mountPackets(WORKSPACE_PATH, createSampleInput());

      expect(writeOrder).toEqual([
        join(WORKSPACE_PATH, TASK_PACKET_FILENAME),
        join(WORKSPACE_PATH, RUN_CONFIG_FILENAME),
        join(WORKSPACE_PATH, POLICY_SNAPSHOT_FILENAME),
      ]);
    });

    /**
     * Content must be pretty-printed with 2-space indentation for
     * debuggability — operators and developers need to inspect these files.
     */
    it("serializes data with 2-space indentation", async () => {
      await mounter.mountPackets(WORKSPACE_PATH, createSampleInput());

      const writtenContent = mockFs.writeFile.mock.calls[0]![1] as string;
      expect(writtenContent).toBe(JSON.stringify(SAMPLE_TASK_PACKET, null, 2));
      // Verify it has newlines (pretty-printed, not compact)
      expect(writtenContent).toContain("\n");
    });
  });

  // ─── mountPackets: write failure cleanup ─────────────────────────────────

  describe("mountPackets — write failure cleanup", () => {
    /**
     * If the first file write fails, the current file path is still
     * passed to cleanup (best-effort), even though it wasn't fully written.
     */
    it("throws PacketMountError when the first file write fails", async () => {
      const writeError = new Error("disk full");
      mockFs.writeFile.mockRejectedValueOnce(writeError);

      await expect(mounter.mountPackets(WORKSPACE_PATH, createSampleInput())).rejects.toThrow(
        PacketMountError,
      );

      // The current file path is included in cleanup (best-effort)
      expect(mockFs.unlink).toHaveBeenCalledWith(join(WORKSPACE_PATH, TASK_PACKET_FILENAME));
    });

    /**
     * If the second file write fails, the first file must be cleaned up.
     * This tests the partial-cleanup guarantee.
     */
    it("cleans up first file when second file write fails", async () => {
      let callCount = 0;
      const written = new Map<string, string>();

      mockFs.writeFile.mockImplementation(async (path: string, content: string) => {
        callCount++;
        if (callCount === 2) {
          throw new Error("permission denied");
        }
        written.set(path, content);
      });
      mockFs.readFile.mockImplementation(async (path: string) => {
        const content = written.get(path);
        if (content === undefined) throw new Error("ENOENT");
        return content;
      });

      await expect(mounter.mountPackets(WORKSPACE_PATH, createSampleInput())).rejects.toThrow(
        PacketMountError,
      );

      // The first file (task-packet.json) should be cleaned up
      expect(mockFs.unlink).toHaveBeenCalledWith(join(WORKSPACE_PATH, TASK_PACKET_FILENAME));
    });

    /**
     * If the third file write fails, the first two files must be cleaned up.
     * This tests the full partial-cleanup guarantee.
     */
    it("cleans up first two files when third file write fails", async () => {
      let callCount = 0;
      const written = new Map<string, string>();

      mockFs.writeFile.mockImplementation(async (path: string, content: string) => {
        callCount++;
        if (callCount === 3) {
          throw new Error("io error");
        }
        written.set(path, content);
      });
      mockFs.readFile.mockImplementation(async (path: string) => {
        const content = written.get(path);
        if (content === undefined) throw new Error("ENOENT");
        return content;
      });

      await expect(mounter.mountPackets(WORKSPACE_PATH, createSampleInput())).rejects.toThrow(
        PacketMountError,
      );

      // Both previously written files and the failed file should be cleaned up
      expect(mockFs.unlink).toHaveBeenCalledWith(join(WORKSPACE_PATH, TASK_PACKET_FILENAME));
      expect(mockFs.unlink).toHaveBeenCalledWith(join(WORKSPACE_PATH, RUN_CONFIG_FILENAME));
      // Third file is also included in cleanup (best-effort, even though write failed)
      expect(mockFs.unlink).toHaveBeenCalledWith(join(WORKSPACE_PATH, POLICY_SNAPSHOT_FILENAME));
    });

    /**
     * The error must identify which file failed and include the workspace path
     * for diagnostics.
     */
    it("includes file name and workspace path in PacketMountError", async () => {
      mockFs.writeFile
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("bad write"));
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(SAMPLE_TASK_PACKET));

      try {
        await mounter.mountPackets(WORKSPACE_PATH, createSampleInput());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PacketMountError);
        const mountErr = err as PacketMountError;
        expect(mountErr.workspacePath).toBe(WORKSPACE_PATH);
        expect(mountErr.failedFile).toBe(RUN_CONFIG_FILENAME);
        expect(mountErr.cause).toBeInstanceOf(Error);
      }
    });
  });

  // ─── mountPackets: verification failure cleanup ──────────────────────────

  describe("mountPackets — verification failure cleanup", () => {
    /**
     * If readFile returns invalid JSON during verification, the file and
     * all previously written files should be cleaned up.
     * This tests that verification actually catches corruption.
     */
    it("cleans up when verification readBack returns invalid JSON", async () => {
      const written = new Map<string, string>();
      mockFs.writeFile.mockImplementation(async (path: string, content: string) => {
        written.set(path, content);
      });
      // First file: readBack returns garbage instead of valid JSON
      mockFs.readFile.mockResolvedValueOnce("not valid json {{{");

      await expect(mounter.mountPackets(WORKSPACE_PATH, createSampleInput())).rejects.toThrow(
        PacketMountError,
      );

      // The file that was written but failed verification should be cleaned up
      expect(mockFs.unlink).toHaveBeenCalledWith(join(WORKSPACE_PATH, TASK_PACKET_FILENAME));
    });

    /**
     * If readFile throws during verification (e.g., file vanished between
     * write and read), cleanup should still occur.
     */
    it("cleans up when verification readFile throws", async () => {
      const written = new Map<string, string>();
      mockFs.writeFile.mockImplementation(async (path: string, content: string) => {
        written.set(path, content);
      });
      mockFs.readFile.mockRejectedValueOnce(new Error("ENOENT: file vanished"));

      await expect(mounter.mountPackets(WORKSPACE_PATH, createSampleInput())).rejects.toThrow(
        PacketMountError,
      );

      expect(mockFs.unlink).toHaveBeenCalledWith(join(WORKSPACE_PATH, TASK_PACKET_FILENAME));
    });
  });

  // ─── mountPackets: cleanup resilience ────────────────────────────────────

  describe("mountPackets — cleanup resilience", () => {
    /**
     * If cleanup itself fails (e.g., unlink throws), the original mount
     * error should still propagate. Cleanup is best-effort.
     */
    it("propagates original error even when cleanup fails", async () => {
      const written = new Map<string, string>();
      mockFs.writeFile.mockImplementation(async (path: string, content: string) => {
        written.set(path, content);
      });
      // First file writes and verifies OK
      mockFs.readFile.mockImplementation(async (path: string) => {
        const content = written.get(path);
        if (content === undefined) throw new Error("ENOENT");
        return content;
      });
      // Second file write fails
      let writeCount = 0;
      mockFs.writeFile.mockImplementation(async (path: string, content: string) => {
        writeCount++;
        if (writeCount === 2) throw new Error("disk full");
        written.set(path, content);
      });
      // Cleanup fails too
      mockFs.unlink.mockRejectedValue(new Error("unlink failed"));

      await expect(mounter.mountPackets(WORKSPACE_PATH, createSampleInput())).rejects.toThrow(
        PacketMountError,
      );
    });
  });

  // ─── unmountPackets ──────────────────────────────────────────────────────

  describe("unmountPackets", () => {
    /**
     * Removes all three mounted files. Used during workspace teardown
     * or before re-mounting with updated data.
     */
    it("removes all three packet files", async () => {
      await mounter.unmountPackets(WORKSPACE_PATH);

      expect(mockFs.unlink).toHaveBeenCalledTimes(3);
      expect(mockFs.unlink).toHaveBeenCalledWith(join(WORKSPACE_PATH, TASK_PACKET_FILENAME));
      expect(mockFs.unlink).toHaveBeenCalledWith(join(WORKSPACE_PATH, RUN_CONFIG_FILENAME));
      expect(mockFs.unlink).toHaveBeenCalledWith(join(WORKSPACE_PATH, POLICY_SNAPSHOT_FILENAME));
    });

    /**
     * If files don't exist (already cleaned up), unmount should not throw.
     * This makes it safe to call idempotently.
     */
    it("does not throw when files do not exist", async () => {
      mockFs.unlink.mockRejectedValue(new Error("ENOENT"));

      // Should not throw
      await expect(mounter.unmountPackets(WORKSPACE_PATH)).resolves.toBeUndefined();
    });
  });

  // ─── PacketMountError ────────────────────────────────────────────────────

  describe("PacketMountError", () => {
    /**
     * Error must contain all diagnostic fields for troubleshooting
     * mount failures in production logs.
     */
    it("captures workspace path, failed file, and cause", () => {
      const cause = new Error("disk full");
      const err = new PacketMountError("/ws/task-1", "run-config.json", cause);

      expect(err.name).toBe("PacketMountError");
      expect(err.workspacePath).toBe("/ws/task-1");
      expect(err.failedFile).toBe("run-config.json");
      expect(err.cause).toBe(cause);
      expect(err.message).toContain("run-config.json");
      expect(err.message).toContain("/ws/task-1");
      expect(err.message).toContain("disk full");
    });

    /**
     * Non-Error causes (e.g., strings) should be handled gracefully.
     */
    it("handles non-Error cause", () => {
      const err = new PacketMountError("/ws/task-1", "run-config.json", "string error");

      expect(err.message).toContain("string error");
      expect(err.cause).toBe("string error");
    });
  });
});
