/**
 * Tests for the crash recovery artifact adapter.
 *
 * These tests validate the infrastructure adapter that stores crash recovery
 * artifacts using the {@link ArtifactStore}. The adapter must correctly:
 *
 * 1. Store git diffs at the correct §7.11 path under runs/{runId}/outputs/
 * 2. Store partial output files preserving the original filename
 * 3. Store invalid result packets as debug artifacts
 * 4. Store crash recovery snapshot metadata as JSON
 * 5. Return relative artifact reference paths from all operations
 *
 * Tests use a real ArtifactStore backed by a fake in-memory filesystem,
 * matching the testing pattern used in artifact-store.test.ts.
 *
 * @see docs/backlog/tasks/T072-partial-work-snapshot.md
 * @module @factory/infrastructure/crash-recovery/crash-recovery-artifact-adapter.test
 */

import { describe, it, expect, beforeEach } from "vitest";

import { createCrashRecoveryArtifactAdapter } from "./crash-recovery-artifact-adapter.js";
import { ArtifactStore, runOutputPath } from "../artifacts/artifact-store.js";
import type { FileSystem } from "../workspace/types.js";
import type { PartialWorkSnapshot } from "@factory/application";

// ─── In-Memory Fake FileSystem ──────────────────────────────────────────────

/**
 * Creates an in-memory filesystem for testing artifact storage without real I/O.
 * Tracks all written files so tests can verify content.
 */
function createInMemoryFs(): FileSystem & { files: Map<string, string> } {
  const files = new Map<string, string>();
  const directories = new Set<string>();

  return {
    files,

    async mkdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
      directories.add(path);
    },

    async exists(path: string): Promise<boolean> {
      return files.has(path) || directories.has(path);
    },

    async writeFile(path: string, content: string): Promise<void> {
      files.set(path, content);
    },

    async readFile(path: string): Promise<string> {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return content;
    },

    async unlink(path: string): Promise<void> {
      files.delete(path);
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      const content = files.get(oldPath);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file '${oldPath}'`);
      }
      files.set(newPath, content);
      files.delete(oldPath);
    },

    async readdir(_path: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
      return [];
    },

    async rm(path: string, _options?: { recursive?: boolean; force?: boolean }): Promise<void> {
      files.delete(path);
    },
  };
}

// ─── Test Constants ─────────────────────────────────────────────────────────

const ARTIFACT_ROOT = "/artifacts";
const REPO_ID = "repo-abc";
const TASK_ID = "task-42";
const RUN_ID = "run-001";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CrashRecoveryArtifactAdapter", () => {
  let fs: ReturnType<typeof createInMemoryFs>;
  let store: ArtifactStore;
  let adapter: ReturnType<typeof createCrashRecoveryArtifactAdapter>;

  beforeEach(() => {
    fs = createInMemoryFs();
    store = new ArtifactStore({ artifactRoot: ARTIFACT_ROOT }, fs);
    adapter = createCrashRecoveryArtifactAdapter(store);
  });

  describe("storeGitDiff", () => {
    /**
     * Validates that git diffs are stored at the correct path under the §7.11
     * artifact layout: runs/{runId}/outputs/git-diff.patch.
     * The returned path must be relative to the artifact root.
     */
    it("stores git diff at correct path and returns relative ref", async () => {
      const diffContent = "diff --git a/file.ts b/file.ts\n+new line";

      const ref = await adapter.storeGitDiff(REPO_ID, TASK_ID, RUN_ID, diffContent);

      const expectedPath = runOutputPath(REPO_ID, TASK_ID, RUN_ID, "git-diff.patch");
      expect(ref).toBe(expectedPath);

      // Verify content was stored
      const stored = await store.readArtifact(ref);
      expect(stored).toBe(diffContent);
    });

    /**
     * Validates that large diffs are stored correctly without truncation.
     */
    it("handles large diffs without truncation", async () => {
      const largeDiff = "diff --git a/big.ts b/big.ts\n" + "+line\n".repeat(10000);

      const ref = await adapter.storeGitDiff(REPO_ID, TASK_ID, RUN_ID, largeDiff);
      const stored = await store.readArtifact(ref);

      expect(stored).toBe(largeDiff);
    });
  });

  describe("storePartialOutput", () => {
    /**
     * Validates that partial output files preserve the original filename
     * in the artifact path: runs/{runId}/outputs/{filename}.
     */
    it("stores output file with original filename", async () => {
      const ref = await adapter.storePartialOutput(
        REPO_ID,
        TASK_ID,
        RUN_ID,
        "execution.log",
        "log content here",
      );

      const expectedPath = runOutputPath(REPO_ID, TASK_ID, RUN_ID, "execution.log");
      expect(ref).toBe(expectedPath);

      const stored = await store.readArtifact(ref);
      expect(stored).toBe("log content here");
    });

    /**
     * Validates that multiple output files can be stored for the same run,
     * each with their own filename.
     */
    it("stores multiple output files independently", async () => {
      const ref1 = await adapter.storePartialOutput(
        REPO_ID,
        TASK_ID,
        RUN_ID,
        "stdout.log",
        "stdout content",
      );
      const ref2 = await adapter.storePartialOutput(
        REPO_ID,
        TASK_ID,
        RUN_ID,
        "stderr.log",
        "stderr content",
      );

      expect(ref1).not.toBe(ref2);
      expect(await store.readArtifact(ref1)).toBe("stdout content");
      expect(await store.readArtifact(ref2)).toBe("stderr content");
    });
  });

  describe("storeInvalidResultPacket", () => {
    /**
     * Validates that invalid result packets are stored as debug artifacts.
     * These are found on the filesystem but failed Zod validation — storing
     * them helps debug what the worker actually produced.
     */
    it("stores invalid result packet for debugging", async () => {
      const invalidContent = '{"packet_type":"wrong","garbage":true}';

      const ref = await adapter.storeInvalidResultPacket(REPO_ID, TASK_ID, RUN_ID, invalidContent);

      const expectedPath = runOutputPath(REPO_ID, TASK_ID, RUN_ID, "invalid-result-packet.json");
      expect(ref).toBe(expectedPath);

      const stored = await store.readArtifact(ref);
      expect(stored).toBe(invalidContent);
    });
  });

  describe("storeSnapshot", () => {
    /**
     * Validates that the crash recovery snapshot is stored as pretty-printed
     * JSON with all fields preserved. This snapshot is the metadata document
     * that ties together all the partial work artifacts.
     */
    it("stores snapshot as JSON with all fields preserved", async () => {
      const snapshot: PartialWorkSnapshot = {
        capturedAt: "2025-01-15T10:30:00.000Z",
        leaseId: "lease-abc",
        taskId: TASK_ID,
        modifiedFiles: ["src/index.ts", "package.json"],
        gitDiffRef: `repositories/${REPO_ID}/tasks/${TASK_ID}/runs/${RUN_ID}/outputs/git-diff.patch`,
        partialOutputRefs: [
          `repositories/${REPO_ID}/tasks/${TASK_ID}/runs/${RUN_ID}/outputs/stdout.log`,
        ],
        invalidResultPacketRef: null,
      };

      const ref = await adapter.storeSnapshot(REPO_ID, TASK_ID, RUN_ID, snapshot);

      const expectedPath = runOutputPath(REPO_ID, TASK_ID, RUN_ID, "crash-recovery-snapshot.json");
      expect(ref).toBe(expectedPath);

      const stored = await store.readJSON<PartialWorkSnapshot>(ref);
      expect(stored).toEqual(snapshot);
    });

    /**
     * Validates that a minimal snapshot (nothing captured except timestamp)
     * is stored correctly. This happens when the workspace was accessible
     * but contained no useful artifacts.
     */
    it("stores minimal snapshot with empty arrays", async () => {
      const snapshot: PartialWorkSnapshot = {
        capturedAt: "2025-01-15T10:30:00.000Z",
        leaseId: "lease-xyz",
        taskId: TASK_ID,
        modifiedFiles: [],
        gitDiffRef: null,
        partialOutputRefs: [],
        invalidResultPacketRef: null,
      };

      const ref = await adapter.storeSnapshot(REPO_ID, TASK_ID, RUN_ID, snapshot);
      const stored = await store.readJSON<PartialWorkSnapshot>(ref);

      expect(stored).toEqual(snapshot);
    });
  });
});
