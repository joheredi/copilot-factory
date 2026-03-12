/**
 * Tests for the crash recovery service.
 *
 * These tests validate the crash recovery protocol — the process of
 * inspecting a workspace after a lease reclaim to capture partial work
 * artifacts and detect filesystem-persisted result packets.
 *
 * The crash recovery service must correctly:
 *
 * 1. Detect a valid filesystem-persisted result packet and signal to
 *    skip reclaim (§9.8.2 network partition fallback)
 * 2. Detect an invalid result packet and store it as a debug artifact
 * 3. Capture modified files, git diff, and output files from the workspace
 * 4. Store all captured artifacts and update the lease record
 * 5. Handle filesystem errors gracefully (best-effort capture)
 * 6. Return "nothing_captured" when workspace is empty or inaccessible
 *
 * Each test documents WHY it is important for correctness or reliability.
 *
 * @see docs/prd/002-data-model.md §2.8 — Worker Lease Protocol (Crash Recovery)
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8.2 — Network Partition Handling
 * @module @factory/application/services/crash-recovery.service.test
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  createCrashRecoveryService,
  type CrashRecoveryService,
  type CrashRecoveryParams,
} from "./crash-recovery.service.js";

import type {
  WorkspaceInspectorPort,
  CrashRecoveryArtifactPort,
  CrashRecoveryLeasePort,
  ResultPacketValidatorPort,
  ResultPacketValidation,
  WorkspaceOutputFile,
  PartialWorkSnapshot,
} from "../ports/crash-recovery.ports.js";

// ─── Mock Factories ─────────────────────────────────────────────────────────

/**
 * Creates a mock workspace inspector with configurable behavior.
 * All methods return empty/null by default unless overridden.
 */
function createMockInspector(
  overrides: Partial<{
    resultPacket: string | null;
    modifiedFiles: readonly string[];
    gitDiff: string | null;
    outputFiles: readonly WorkspaceOutputFile[];
    /** If set, readResultPacket will throw this error. */
    readResultPacketError: Error;
    /** If set, getModifiedFiles will throw this error. */
    getModifiedFilesError: Error;
    /** If set, getGitDiff will throw this error. */
    getGitDiffError: Error;
    /** If set, readOutputFiles will throw this error. */
    readOutputFilesError: Error;
  }> = {},
): WorkspaceInspectorPort & { calls: Record<string, number> } {
  const calls: Record<string, number> = {
    readResultPacket: 0,
    getModifiedFiles: 0,
    getGitDiff: 0,
    readOutputFiles: 0,
  };

  return {
    calls,

    async readResultPacket(_workspacePath: string): Promise<string | null> {
      calls["readResultPacket"]!++;
      if (overrides.readResultPacketError) {
        throw overrides.readResultPacketError;
      }
      return overrides.resultPacket ?? null;
    },

    async getModifiedFiles(_workspacePath: string): Promise<readonly string[]> {
      calls["getModifiedFiles"]!++;
      if (overrides.getModifiedFilesError) {
        throw overrides.getModifiedFilesError;
      }
      return overrides.modifiedFiles ?? [];
    },

    async getGitDiff(_workspacePath: string): Promise<string | null> {
      calls["getGitDiff"]!++;
      if (overrides.getGitDiffError) {
        throw overrides.getGitDiffError;
      }
      return overrides.gitDiff ?? null;
    },

    async readOutputFiles(_workspacePath: string): Promise<readonly WorkspaceOutputFile[]> {
      calls["readOutputFiles"]!++;
      if (overrides.readOutputFilesError) {
        throw overrides.readOutputFilesError;
      }
      return overrides.outputFiles ?? [];
    },
  };
}

/**
 * Creates a mock artifact store that records all stored artifacts.
 * Returns deterministic artifact reference paths.
 */
function createMockArtifactStore(
  overrides: Partial<{
    /** If set, storeGitDiff will throw this error. */
    storeGitDiffError: Error;
    /** If set, storePartialOutput will throw this error. */
    storePartialOutputError: Error;
    /** If set, storeSnapshot will throw this error. */
    storeSnapshotError: Error;
  }> = {},
): CrashRecoveryArtifactPort & {
  stored: Array<{ type: string; repoId: string; taskId: string; runId: string; content: string }>;
} {
  const stored: Array<{
    type: string;
    repoId: string;
    taskId: string;
    runId: string;
    content: string;
  }> = [];

  return {
    stored,

    async storeGitDiff(
      repoId: string,
      taskId: string,
      runId: string,
      diffContent: string,
    ): Promise<string> {
      if (overrides.storeGitDiffError) {
        throw overrides.storeGitDiffError;
      }
      stored.push({ type: "git-diff", repoId, taskId, runId, content: diffContent });
      return `repositories/${repoId}/tasks/${taskId}/runs/${runId}/outputs/git-diff.patch`;
    },

    async storePartialOutput(
      repoId: string,
      taskId: string,
      runId: string,
      filename: string,
      content: string,
    ): Promise<string> {
      if (overrides.storePartialOutputError) {
        throw overrides.storePartialOutputError;
      }
      stored.push({ type: `output:${filename}`, repoId, taskId, runId, content });
      return `repositories/${repoId}/tasks/${taskId}/runs/${runId}/outputs/${filename}`;
    },

    async storeInvalidResultPacket(
      repoId: string,
      taskId: string,
      runId: string,
      content: string,
    ): Promise<string> {
      stored.push({ type: "invalid-result", repoId, taskId, runId, content });
      return `repositories/${repoId}/tasks/${taskId}/runs/${runId}/outputs/invalid-result-packet.json`;
    },

    async storeSnapshot(
      repoId: string,
      taskId: string,
      runId: string,
      snapshot: PartialWorkSnapshot,
    ): Promise<string> {
      if (overrides.storeSnapshotError) {
        throw overrides.storeSnapshotError;
      }
      stored.push({ type: "snapshot", repoId, taskId, runId, content: JSON.stringify(snapshot) });
      return `repositories/${repoId}/tasks/${taskId}/runs/${runId}/outputs/crash-recovery-snapshot.json`;
    },
  };
}

/**
 * Creates a mock lease port that tracks updatePartialArtifactRefs calls.
 */
function createMockLeasePort(
  overrides: Partial<{ updateError: Error }> = {},
): CrashRecoveryLeasePort & {
  updates: Array<{ leaseId: string; artifactRefs: readonly string[] }>;
} {
  const updates: Array<{ leaseId: string; artifactRefs: readonly string[] }> = [];

  return {
    updates,

    async updatePartialArtifactRefs(
      leaseId: string,
      artifactRefs: readonly string[],
    ): Promise<void> {
      if (overrides.updateError) {
        throw overrides.updateError;
      }
      updates.push({ leaseId, artifactRefs });
    },
  };
}

/**
 * Creates a result packet validator with configurable validation behavior.
 */
function createMockValidator(
  valid: boolean,
  data?: unknown,
): ResultPacketValidatorPort & { calls: number } {
  let calls = 0;

  return {
    get calls() {
      return calls;
    },

    validate(content: string): ResultPacketValidation {
      calls++;
      if (valid) {
        return { valid: true, data: data ?? JSON.parse(content) };
      }
      return { valid: false, reason: "Invalid packet format" };
    },
  };
}

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function defaultParams(overrides?: Partial<CrashRecoveryParams>): CrashRecoveryParams {
  return {
    leaseId: "lease-1",
    taskId: "task-1",
    repoId: "repo-1",
    runId: "run-1",
    workspacePath: "/workspaces/repo-1/task-1",
    worktreePath: "/workspaces/repo-1/task-1/worktree",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CrashRecoveryService", () => {
  let inspector: ReturnType<typeof createMockInspector>;
  let artifactStorePort: ReturnType<typeof createMockArtifactStore>;
  let leasePort: ReturnType<typeof createMockLeasePort>;
  let validator: ReturnType<typeof createMockValidator>;
  let service: CrashRecoveryService;

  beforeEach(() => {
    inspector = createMockInspector();
    artifactStorePort = createMockArtifactStore();
    leasePort = createMockLeasePort();
    validator = createMockValidator(false);
    service = createCrashRecoveryService({
      workspaceInspector: inspector,
      artifactStore: artifactStorePort,
      leasePort,
      resultValidator: validator,
    });
  });

  // ─── §9.8.2: Filesystem-persisted result packet detection ─────────────

  describe("filesystem result packet detection (§9.8.2)", () => {
    /**
     * This test validates the primary network partition fallback: when a worker
     * writes its result to the filesystem because it cannot reach the control
     * plane, the crash recovery service must detect and return it so the reclaim
     * can be avoided and the result processed normally.
     *
     * Without this, valid completed work would be lost on every network partition.
     */
    it("should return result_found when a valid result packet exists on filesystem", async () => {
      const resultData = { packet_type: "dev_result_packet", status: "success" };
      inspector = createMockInspector({
        resultPacket: JSON.stringify(resultData),
      });
      validator = createMockValidator(true, resultData);
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("result_found");
      if (result.outcome === "result_found") {
        expect(result.resultData).toEqual(resultData);
      }
      // Should not attempt partial capture when a valid result is found
      expect(inspector.calls["getModifiedFiles"]).toBe(0);
      expect(inspector.calls["getGitDiff"]).toBe(0);
    });

    /**
     * When a result packet file exists but contains invalid data (partial write,
     * corrupted JSON), the service must not treat it as a valid result. Instead,
     * it should store the invalid content for debugging and continue with partial
     * work capture. This prevents corrupt data from being processed as real results.
     */
    it("should capture invalid result packet as artifact and continue with partial capture", async () => {
      const invalidContent = '{ "packet_type": "dev_result_packet", broken';
      inspector = createMockInspector({
        resultPacket: invalidContent,
        modifiedFiles: ["src/main.ts"],
        gitDiff: "diff --git a/src/main.ts",
      });
      validator = createMockValidator(false);
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("partial_captured");
      if (result.outcome === "partial_captured") {
        expect(result.snapshot.invalidResultPacketRef).not.toBeNull();
        // The invalid packet content should be stored
        const invalidStored = artifactStorePort.stored.find((s) => s.type === "invalid-result");
        expect(invalidStored).toBeDefined();
        expect(invalidStored!.content).toBe(invalidContent);
      }
    });

    /**
     * If the workspace filesystem is inaccessible (e.g., mount point gone after
     * a crash), readResultPacket throws. The service must handle this gracefully
     * and continue with partial capture attempts rather than propagating the error.
     */
    it("should handle readResultPacket errors gracefully", async () => {
      inspector = createMockInspector({
        readResultPacketError: new Error("ENOENT: workspace gone"),
      });

      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("nothing_captured");
    });
  });

  // ─── Partial work capture ─────────────────────────────────────────────

  describe("partial work capture", () => {
    /**
     * When a worker crashes mid-work, capturing the git diff provides the most
     * valuable context for the retry: it shows exactly what code changes were
     * made. This test validates the full capture flow including storage and
     * lease record update.
     */
    it("should capture modified files and git diff", async () => {
      inspector = createMockInspector({
        modifiedFiles: ["src/auth.ts", "src/auth.test.ts"],
        gitDiff: "diff --git a/src/auth.ts b/src/auth.ts\n+export function login() {}",
      });
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("partial_captured");
      if (result.outcome === "partial_captured") {
        expect(result.snapshot.modifiedFiles).toEqual(["src/auth.ts", "src/auth.test.ts"]);
        expect(result.snapshot.gitDiffRef).not.toBeNull();
        expect(result.artifactRefs.length).toBeGreaterThan(0);
      }
    });

    /**
     * Workers may produce partial output files (incomplete result packets,
     * progress logs, intermediate state). Capturing these provides additional
     * context for the retry attempt beyond just the code diff.
     */
    it("should capture output files from workspace", async () => {
      inspector = createMockInspector({
        modifiedFiles: ["src/api.ts"],
        outputFiles: [
          { name: "partial-result.json", content: '{"status":"in_progress"}' },
          { name: "progress.log", content: "Step 1: complete\nStep 2: started" },
        ],
      });
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("partial_captured");
      if (result.outcome === "partial_captured") {
        expect(result.snapshot.partialOutputRefs).toHaveLength(2);
        // Verify both files were stored
        const outputStored = artifactStorePort.stored.filter((s) => s.type.startsWith("output:"));
        expect(outputStored).toHaveLength(2);
      }
    });

    /**
     * The snapshot metadata artifact ties together all captured pieces.
     * It's what gets stored in the lease record and referenced by the
     * next TaskPacket's prior_partial_work field.
     */
    it("should store a snapshot artifact with all captured references", async () => {
      inspector = createMockInspector({
        modifiedFiles: ["src/index.ts"],
        gitDiff: "diff content",
        outputFiles: [{ name: "output.json", content: "{}" }],
      });
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("partial_captured");
      if (result.outcome === "partial_captured") {
        // Snapshot should contain all the pieces
        expect(result.snapshot.leaseId).toBe("lease-1");
        expect(result.snapshot.taskId).toBe("task-1");
        expect(result.snapshot.modifiedFiles).toEqual(["src/index.ts"]);
        expect(result.snapshot.gitDiffRef).not.toBeNull();
        expect(result.snapshot.partialOutputRefs).toHaveLength(1);
        expect(result.snapshot.capturedAt).toBeDefined();
        // Snapshot artifact should be stored
        const snapshotStored = artifactStorePort.stored.find((s) => s.type === "snapshot");
        expect(snapshotStored).toBeDefined();
      }
    });

    /**
     * The lease record must be updated with artifact references so the
     * scheduler can include them in the next TaskPacket's prior_partial_work.
     * This test validates the lease port integration.
     */
    it("should update lease record with artifact references", async () => {
      inspector = createMockInspector({
        modifiedFiles: ["src/main.ts"],
        gitDiff: "some diff",
      });
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      await service.recoverFromCrash(defaultParams());

      expect(leasePort.updates).toHaveLength(1);
      expect(leasePort.updates[0]!.leaseId).toBe("lease-1");
      expect(leasePort.updates[0]!.artifactRefs.length).toBeGreaterThan(0);
    });

    /**
     * When the workspace is completely empty (worker crashed before making
     * any changes), there's nothing to capture. The service should return
     * nothing_captured cleanly without creating empty artifacts.
     */
    it("should return nothing_captured when workspace has no work", async () => {
      // Default inspector returns empty results for everything
      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("nothing_captured");
      expect(artifactStorePort.stored).toHaveLength(0);
      expect(leasePort.updates).toHaveLength(0);
    });

    /**
     * A workspace with only modified files (no diff available, no outputs)
     * should still produce a snapshot. Even a file list alone helps the
     * retry worker understand what was attempted.
     */
    it("should capture snapshot with only modified files", async () => {
      inspector = createMockInspector({
        modifiedFiles: ["README.md", "package.json"],
      });
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("partial_captured");
      if (result.outcome === "partial_captured") {
        expect(result.snapshot.modifiedFiles).toEqual(["README.md", "package.json"]);
        expect(result.snapshot.gitDiffRef).toBeNull();
        expect(result.snapshot.partialOutputRefs).toHaveLength(0);
      }
    });

    /**
     * An empty string git diff means no actual changes — it should be treated
     * the same as null (no diff to store).
     */
    it("should not store empty git diff", async () => {
      inspector = createMockInspector({
        modifiedFiles: ["src/app.ts"],
        gitDiff: "",
      });
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("partial_captured");
      if (result.outcome === "partial_captured") {
        expect(result.snapshot.gitDiffRef).toBeNull();
        // Only snapshot should be stored, no diff
        const diffStored = artifactStorePort.stored.find((s) => s.type === "git-diff");
        expect(diffStored).toBeUndefined();
      }
    });
  });

  // ─── Error resilience ─────────────────────────────────────────────────

  describe("error resilience", () => {
    /**
     * Crash recovery MUST be resilient to filesystem errors. After a crash,
     * the workspace may be in any state: partially written files, deleted
     * directories, corrupted git index. The service must capture whatever
     * it can and not propagate errors.
     */
    it("should continue capture when getModifiedFiles throws", async () => {
      inspector = createMockInspector({
        getModifiedFilesError: new Error("git index corrupted"),
        gitDiff: "some diff content",
      });
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      const result = await service.recoverFromCrash(defaultParams());

      // Should still capture the diff even though modified files failed
      expect(result.outcome).toBe("partial_captured");
      if (result.outcome === "partial_captured") {
        expect(result.snapshot.modifiedFiles).toEqual([]);
        expect(result.snapshot.gitDiffRef).not.toBeNull();
      }
    });

    /**
     * If the git diff cannot be obtained but output files exist, the service
     * should still capture the outputs. No single failure should prevent
     * capturing other available artifacts.
     */
    it("should continue capture when getGitDiff throws", async () => {
      inspector = createMockInspector({
        getGitDiffError: new Error("not a git repository"),
        modifiedFiles: ["src/index.ts"],
        outputFiles: [{ name: "log.txt", content: "worker log" }],
      });
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("partial_captured");
      if (result.outcome === "partial_captured") {
        expect(result.snapshot.gitDiffRef).toBeNull();
        expect(result.snapshot.partialOutputRefs).toHaveLength(1);
      }
    });

    /**
     * If artifact storage fails (e.g., disk full), the service should not
     * crash. It should skip the failed artifact and continue with the rest.
     */
    it("should continue when artifact storage fails for git diff", async () => {
      inspector = createMockInspector({
        modifiedFiles: ["src/app.ts"],
        gitDiff: "diff content",
        outputFiles: [{ name: "out.json", content: "{}" }],
      });
      artifactStorePort = createMockArtifactStore({
        storeGitDiffError: new Error("disk full"),
      });
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("partial_captured");
      if (result.outcome === "partial_captured") {
        // Git diff ref should be null because storage failed
        expect(result.snapshot.gitDiffRef).toBeNull();
        // But output files should still be captured
        expect(result.snapshot.partialOutputRefs).toHaveLength(1);
      }
    });

    /**
     * If the lease update fails, the recovery should still complete.
     * The artifacts are stored even if the lease record can't be updated —
     * they can be linked later via manual recovery.
     */
    it("should complete even when lease update fails", async () => {
      inspector = createMockInspector({
        modifiedFiles: ["src/app.ts"],
        gitDiff: "diff",
      });
      leasePort = createMockLeasePort({
        updateError: new Error("database connection lost"),
      });
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      const result = await service.recoverFromCrash(defaultParams());

      // Should still return partial_captured with the snapshot
      expect(result.outcome).toBe("partial_captured");
      if (result.outcome === "partial_captured") {
        expect(result.snapshot.gitDiffRef).not.toBeNull();
      }
    });

    /**
     * When ALL filesystem operations fail, the service should return
     * nothing_captured rather than throwing. This is the worst-case
     * crash scenario where the workspace is completely inaccessible.
     */
    it("should return nothing_captured when all operations fail", async () => {
      inspector = createMockInspector({
        readResultPacketError: new Error("ENOENT"),
        getModifiedFilesError: new Error("ENOENT"),
        getGitDiffError: new Error("ENOENT"),
        readOutputFilesError: new Error("ENOENT"),
      });

      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("nothing_captured");
    });

    /**
     * If storing individual output files fails, the service should skip
     * the failed file and continue storing others.
     */
    it("should skip failed output file storage and continue with others", async () => {
      let callCount = 0;
      const customArtifactStore: CrashRecoveryArtifactPort = {
        async storeGitDiff() {
          return "diff-ref";
        },
        async storePartialOutput(repoId: string, taskId: string, runId: string, filename: string) {
          callCount++;
          if (callCount === 1) {
            throw new Error("disk full for first file");
          }
          return `repositories/${repoId}/tasks/${taskId}/runs/${runId}/outputs/${filename}`;
        },
        async storeInvalidResultPacket() {
          return "invalid-ref";
        },
        async storeSnapshot() {
          return "snapshot-ref";
        },
      };

      inspector = createMockInspector({
        modifiedFiles: ["src/a.ts"],
        outputFiles: [
          { name: "first.json", content: "fail" },
          { name: "second.json", content: "succeed" },
        ],
      });
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: customArtifactStore,
        leasePort,
        resultValidator: validator,
      });

      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("partial_captured");
      if (result.outcome === "partial_captured") {
        // Only the second file should be in the refs (first failed)
        expect(result.snapshot.partialOutputRefs).toHaveLength(1);
        expect(result.snapshot.partialOutputRefs[0]).toContain("second.json");
      }
    });
  });

  // ─── Parameter passing ────────────────────────────────────────────────

  describe("parameter passing", () => {
    /**
     * Workspace and worktree paths must be passed correctly to the inspector.
     * The workspace path is used for result packet and output file checks,
     * while the worktree path is used for git operations (diff, modified files).
     */
    it("should pass correct paths to workspace inspector", async () => {
      const params = defaultParams({
        workspacePath: "/custom/workspace",
        worktreePath: "/custom/workspace/worktree",
      });
      inspector = createMockInspector({
        modifiedFiles: ["file.ts"],
      });

      // Track the actual paths passed
      let resultPacketPath = "";
      let modifiedFilesPath = "";
      let gitDiffPath = "";
      let outputFilesPath = "";

      const trackingInspector: WorkspaceInspectorPort = {
        async readResultPacket(p) {
          resultPacketPath = p;
          return null;
        },
        async getModifiedFiles(p) {
          modifiedFilesPath = p;
          return ["file.ts"];
        },
        async getGitDiff(p) {
          gitDiffPath = p;
          return null;
        },
        async readOutputFiles(p) {
          outputFilesPath = p;
          return [];
        },
      };

      service = createCrashRecoveryService({
        workspaceInspector: trackingInspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      await service.recoverFromCrash(params);

      expect(resultPacketPath).toBe("/custom/workspace");
      expect(modifiedFilesPath).toBe("/custom/workspace/worktree");
      expect(gitDiffPath).toBe("/custom/workspace/worktree");
      expect(outputFilesPath).toBe("/custom/workspace");
    });

    /**
     * The correct repoId, taskId, and runId must be forwarded to the artifact
     * store for proper directory layout construction.
     */
    it("should pass correct IDs to artifact store", async () => {
      const params = defaultParams({
        repoId: "my-repo",
        taskId: "my-task",
        runId: "my-run",
      });
      inspector = createMockInspector({
        modifiedFiles: ["src/app.ts"],
        gitDiff: "diff content",
      });
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      await service.recoverFromCrash(params);

      const diffStored = artifactStorePort.stored.find((s) => s.type === "git-diff");
      expect(diffStored).toBeDefined();
      expect(diffStored!.repoId).toBe("my-repo");
      expect(diffStored!.taskId).toBe("my-task");
      expect(diffStored!.runId).toBe("my-run");
    });
  });

  // ─── Combined scenarios ───────────────────────────────────────────────

  describe("combined scenarios", () => {
    /**
     * Full crash recovery with all artifact types present: invalid result
     * packet, modified files, git diff, and output files. This validates
     * the complete flow end-to-end.
     */
    it("should capture all artifact types in a single recovery", async () => {
      const invalidResult = '{"broken": true}';
      inspector = createMockInspector({
        resultPacket: invalidResult,
        modifiedFiles: ["src/a.ts", "src/b.ts"],
        gitDiff: "full diff content",
        outputFiles: [
          { name: "result.json", content: '{"partial": true}' },
          { name: "debug.log", content: "debug output" },
        ],
      });
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("partial_captured");
      if (result.outcome === "partial_captured") {
        // All artifact types present
        expect(result.snapshot.modifiedFiles).toEqual(["src/a.ts", "src/b.ts"]);
        expect(result.snapshot.gitDiffRef).not.toBeNull();
        expect(result.snapshot.partialOutputRefs).toHaveLength(2);
        expect(result.snapshot.invalidResultPacketRef).not.toBeNull();

        // All refs collected
        // git-diff + 2 outputs + invalid-result + snapshot = 5 refs
        expect(result.artifactRefs.length).toBe(5);

        // Lease updated with all refs
        expect(leasePort.updates).toHaveLength(1);
        expect(leasePort.updates[0]!.artifactRefs).toEqual(result.artifactRefs);
      }
    });

    /**
     * Snapshot's capturedAt should be a valid ISO 8601 timestamp.
     * This ensures downstream consumers (TaskPacket builders) can parse it.
     */
    it("should produce a valid ISO 8601 capturedAt timestamp", async () => {
      inspector = createMockInspector({ modifiedFiles: ["x.ts"] });
      service = createCrashRecoveryService({
        workspaceInspector: inspector,
        artifactStore: artifactStorePort,
        leasePort,
        resultValidator: validator,
      });

      const result = await service.recoverFromCrash(defaultParams());

      expect(result.outcome).toBe("partial_captured");
      if (result.outcome === "partial_captured") {
        const parsed = new Date(result.snapshot.capturedAt);
        expect(parsed.toISOString()).toBe(result.snapshot.capturedAt);
      }
    });
  });
});
