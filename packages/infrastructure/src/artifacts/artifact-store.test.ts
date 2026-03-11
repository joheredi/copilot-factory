/**
 * @module artifacts/artifact-store.test
 * Tests for the filesystem artifact store.
 *
 * **Why these tests matter:**
 * - Artifact storage is the foundation for all persistent outputs (packets,
 *   logs, validation results, reviews, merges). If writes silently corrupt
 *   data or produce incorrect paths, downstream consumers (retrieval, audit,
 *   review pipelines) will fail in hard-to-diagnose ways.
 * - The atomic write guarantee (write-to-tmp → rename) is critical for crash
 *   safety. Without it, a process crash mid-write would leave partial JSON
 *   files that break packet parsing.
 * - The directory layout must match §7.11 exactly because other services
 *   depend on the path conventions for artifact retrieval.
 * - All returned paths must be relative to the artifact root to ensure
 *   artifact_refs stored in the database are portable across deployments.
 *
 * @see docs/prd/007-technical-architecture.md §7.11 — Artifact Storage Layout
 * @see docs/backlog/tasks/T069-artifact-storage.md
 */

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";

import type { FileSystem } from "../workspace/types.js";

import {
  ArtifactStore,
  ArtifactStorageError,
  ArtifactNotFoundError,
  PathTraversalError,
  taskBasePath,
  packetPath,
  runLogPath,
  runOutputPath,
  runValidationPath,
  reviewArtifactPath,
  mergeArtifactPath,
  summaryPath,
} from "./artifact-store.js";

import type { ArtifactStoreConfig, ArtifactEntry } from "./artifact-store.js";

// ─── In-Memory Fake FileSystem ─────────────────────────────────────────────────

/**
 * In-memory fake filesystem for testing artifact storage.
 *
 * Tracks all file operations so tests can assert on directory creation,
 * file writes, renames, and reads without touching the real filesystem.
 * Supports simulating failures by injecting errors into specific operations.
 */
class FakeFileSystem implements FileSystem {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly writeLog: Array<{ path: string; content: string }> = [];
  readonly renameLog: Array<{ oldPath: string; newPath: string }> = [];

  /** Set to make specific operations throw. */
  writeError: Error | null = null;
  renameError: Error | null = null;
  readError: Error | null = null;

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.dirs.add(path);
    if (options?.recursive) {
      let parent = path;
      while (true) {
        const idx = parent.lastIndexOf("/");
        if (idx <= 0) break;
        parent = parent.slice(0, idx);
        this.dirs.add(parent);
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.writeError) {
      throw this.writeError;
    }
    this.writeLog.push({ path, content });
    this.files.set(path, content);
  }

  async readFile(path: string): Promise<string> {
    if (this.readError) {
      throw this.readError;
    }
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return content;
  }

  async unlink(path: string): Promise<void> {
    this.files.delete(path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.renameError) {
      throw this.renameError;
    }
    const content = this.files.get(oldPath);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, rename '${oldPath}'`);
    }
    this.renameLog.push({ oldPath, newPath });
    this.files.delete(oldPath);
    this.files.set(newPath, content);
  }

  async readdir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
    if (this.readError) {
      throw this.readError;
    }
    const prefix = path.endsWith("/") ? path : path + "/";
    const entries = new Map<string, boolean>();

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        const slashIndex = rest.indexOf("/");
        if (slashIndex === -1) {
          entries.set(rest, false);
        } else {
          entries.set(rest.slice(0, slashIndex), true);
        }
      }
    }

    for (const dirPath of this.dirs) {
      if (dirPath.startsWith(prefix)) {
        const rest = dirPath.slice(prefix.length);
        const slashIndex = rest.indexOf("/");
        if (slashIndex === -1 && rest.length > 0) {
          entries.set(rest, true);
        } else if (slashIndex > 0) {
          entries.set(rest.slice(0, slashIndex), true);
        }
      }
    }

    return Array.from(entries.entries())
      .map(([name, isDirectory]) => ({ name, isDirectory }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

// ─── Test Constants ────────────────────────────────────────────────────────────

const ARTIFACT_ROOT = "/data/artifacts";
const REPO_ID = "repo-abc";
const TASK_ID = "T042";
const RUN_ID = "run-001";
const REVIEW_CYCLE_ID = "rc-001";

function createStore(fakeFs: FakeFileSystem): ArtifactStore {
  const config: ArtifactStoreConfig = { artifactRoot: ARTIFACT_ROOT };
  return new ArtifactStore(config, fakeFs);
}

// ─── Path Builder Tests ────────────────────────────────────────────────────────

describe("path builders", () => {
  /**
   * Validates that all path builder functions produce the exact directory layout
   * specified in §7.11. These paths are conventions that multiple services depend on.
   */

  it("taskBasePath produces repositories/{repoId}/tasks/{taskId}", () => {
    expect(taskBasePath("repo-1", "T001")).toBe(join("repositories", "repo-1", "tasks", "T001"));
  });

  it("packetPath produces packets/{packetType}-{packetId}.json", () => {
    const result = packetPath("repo-1", "T001", "dev_result_packet", "run-abc");
    expect(result).toBe(
      join("repositories", "repo-1", "tasks", "T001", "packets", "dev_result_packet-run-abc.json"),
    );
  });

  it("runLogPath produces runs/{runId}/logs/{logName}.log", () => {
    const result = runLogPath("repo-1", "T001", "run-1", "stdout");
    expect(result).toBe(
      join("repositories", "repo-1", "tasks", "T001", "runs", "run-1", "logs", "stdout.log"),
    );
  });

  it("runOutputPath produces runs/{runId}/outputs/{filename}", () => {
    const result = runOutputPath("repo-1", "T001", "run-1", "result.json");
    expect(result).toBe(
      join("repositories", "repo-1", "tasks", "T001", "runs", "run-1", "outputs", "result.json"),
    );
  });

  it("runValidationPath produces runs/{runId}/validation/{filename}", () => {
    const result = runValidationPath("repo-1", "T001", "run-1", "check-results.json");
    expect(result).toBe(
      join(
        "repositories",
        "repo-1",
        "tasks",
        "T001",
        "runs",
        "run-1",
        "validation",
        "check-results.json",
      ),
    );
  });

  it("reviewArtifactPath produces reviews/{reviewCycleId}/{filename}", () => {
    const result = reviewArtifactPath("repo-1", "T001", "rc-1", "specialist-review.json");
    expect(result).toBe(
      join("repositories", "repo-1", "tasks", "T001", "reviews", "rc-1", "specialist-review.json"),
    );
  });

  it("mergeArtifactPath produces merges/{filename}", () => {
    const result = mergeArtifactPath("repo-1", "T001", "merge-result.json");
    expect(result).toBe(
      join("repositories", "repo-1", "tasks", "T001", "merges", "merge-result.json"),
    );
  });

  it("summaryPath produces summaries/{filename}", () => {
    const result = summaryPath("repo-1", "T001", "final-summary.md");
    expect(result).toBe(
      join("repositories", "repo-1", "tasks", "T001", "summaries", "final-summary.md"),
    );
  });
});

// ─── ArtifactStore Tests ───────────────────────────────────────────────────────

describe("ArtifactStore", () => {
  let fakeFs: FakeFileSystem;
  let store: ArtifactStore;

  beforeEach(() => {
    fakeFs = new FakeFileSystem();
    store = createStore(fakeFs);
  });

  // ─── storeArtifact ─────────────────────────────────────────────────────────

  describe("storeArtifact", () => {
    /**
     * Tests the core write path that all other store operations delegate to.
     * Validates atomic write semantics, directory creation, and error handling.
     */

    it("writes content atomically via tmp file and rename", async () => {
      const relPath = "repositories/r1/tasks/t1/packets/test.json";
      await store.storeArtifact(relPath, '{"hello":"world"}');

      // The rename log shows the atomic write pattern
      expect(fakeFs.renameLog).toHaveLength(1);
      expect(fakeFs.renameLog[0]!.oldPath).toBe(join(ARTIFACT_ROOT, relPath) + ".tmp");
      expect(fakeFs.renameLog[0]!.newPath).toBe(join(ARTIFACT_ROOT, relPath));

      // The final file exists (tmp was renamed)
      expect(fakeFs.files.has(join(ARTIFACT_ROOT, relPath))).toBe(true);
      // The tmp file was removed by the rename
      expect(fakeFs.files.has(join(ARTIFACT_ROOT, relPath) + ".tmp")).toBe(false);
    });

    it("creates parent directories recursively before writing", async () => {
      const relPath = "repositories/r1/tasks/t1/packets/test.json";
      await store.storeArtifact(relPath, "content");

      const expectedDir = join(ARTIFACT_ROOT, "repositories", "r1", "tasks", "t1", "packets");
      expect(fakeFs.dirs.has(expectedDir)).toBe(true);
    });

    it("returns the relative path (not absolute) for use as artifact_ref", async () => {
      const relPath = "repositories/r1/tasks/t1/summaries/report.md";
      const result = await store.storeArtifact(relPath, "# Report");

      expect(result).toBe(relPath);
      // Verify it's relative — does not start with the artifact root
      expect(result.startsWith("/")).toBe(false);
    });

    it("throws ArtifactStorageError when write fails", async () => {
      fakeFs.writeError = new Error("ENOSPC: no space left on device");

      await expect(store.storeArtifact("some/path.txt", "content")).rejects.toThrow(
        ArtifactStorageError,
      );
    });

    it("throws ArtifactStorageError when rename fails", async () => {
      fakeFs.renameError = new Error("EXDEV: cross-device link");

      await expect(store.storeArtifact("some/path.txt", "content")).rejects.toThrow(
        ArtifactStorageError,
      );
    });

    it("cleans up tmp file when rename fails", async () => {
      fakeFs.renameError = new Error("EXDEV: cross-device link");

      await expect(store.storeArtifact("some/path.txt", "content")).rejects.toThrow(
        ArtifactStorageError,
      );

      // The tmp file should have been cleaned up
      const tmpPath = join(ARTIFACT_ROOT, "some/path.txt") + ".tmp";
      expect(fakeFs.files.has(tmpPath)).toBe(false);
    });

    it("preserves the original error as the cause", async () => {
      const originalError = new Error("disk on fire");
      fakeFs.writeError = originalError;

      try {
        await store.storeArtifact("x.txt", "data");
        expect.fail("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ArtifactStorageError);
        expect((err as ArtifactStorageError).cause).toBe(originalError);
        expect((err as ArtifactStorageError).artifactPath).toBe("x.txt");
      }
    });
  });

  // ─── storeJSON ─────────────────────────────────────────────────────────────

  describe("storeJSON", () => {
    /**
     * Tests JSON serialization and storage. JSON artifacts are the primary
     * format for packets and structured data in the factory.
     */

    it("serializes objects as pretty-printed JSON with 2-space indent", async () => {
      const data = { packet_type: "test", value: 42 };
      await store.storeJSON("test.json", data);

      const absPath = join(ARTIFACT_ROOT, "test.json");
      const content = fakeFs.files.get(absPath)!;
      expect(content).toBe(JSON.stringify(data, null, 2));
    });

    it("handles arrays and nested objects", async () => {
      const data = { items: [{ id: 1 }, { id: 2 }], meta: { count: 2 } };
      await store.storeJSON("nested.json", data);

      const absPath = join(ARTIFACT_ROOT, "nested.json");
      const parsed = JSON.parse(fakeFs.files.get(absPath)!);
      expect(parsed).toEqual(data);
    });

    it("returns the relative path", async () => {
      const result = await store.storeJSON("data/file.json", { ok: true });
      expect(result).toBe("data/file.json");
    });
  });

  // ─── storePacket ───────────────────────────────────────────────────────────

  describe("storePacket", () => {
    /**
     * Tests the typed packet storage helper. Packets are the core data exchange
     * format between workers and the control plane.
     */

    it("stores packet at the correct §7.11 path", async () => {
      const packet = { packet_type: "dev_result_packet", schema_version: "1.0" };
      const result = await store.storePacket(REPO_ID, TASK_ID, "dev_result_packet", RUN_ID, packet);

      expect(result).toBe(packetPath(REPO_ID, TASK_ID, "dev_result_packet", RUN_ID));
      const absPath = join(ARTIFACT_ROOT, result);
      expect(fakeFs.files.has(absPath)).toBe(true);
    });

    it("persists the packet as valid JSON", async () => {
      const packet = { packet_type: "review_packet", verdict: "approved" };
      const result = await store.storePacket(REPO_ID, TASK_ID, "review_packet", "rc-1", packet);

      const absPath = join(ARTIFACT_ROOT, result);
      const stored = JSON.parse(fakeFs.files.get(absPath)!);
      expect(stored).toEqual(packet);
    });
  });

  // ─── storeLog ──────────────────────────────────────────────────────────────

  describe("storeLog", () => {
    /**
     * Tests log file storage. Logs are raw text (not JSON) and must be stored
     * in the runs/{runId}/logs/ subdirectory per §7.11.
     */

    it("stores log at runs/{runId}/logs/{logName}.log", async () => {
      const logContent = "2024-01-01T00:00:00Z INFO Starting worker\n";
      const result = await store.storeLog(REPO_ID, TASK_ID, RUN_ID, "stdout", logContent);

      expect(result).toBe(runLogPath(REPO_ID, TASK_ID, RUN_ID, "stdout"));
      const absPath = join(ARTIFACT_ROOT, result);
      expect(fakeFs.files.get(absPath)).toBe(logContent);
    });
  });

  // ─── storeValidationResult ─────────────────────────────────────────────────

  describe("storeValidationResult", () => {
    /**
     * Tests validation result storage. Validation results are JSON artifacts
     * stored per-run in the validation/ subdirectory.
     */

    it("stores result at runs/{runId}/validation/{validationRunId}.json", async () => {
      const result = { status: "passed", checks: [] };
      const path = await store.storeValidationResult(REPO_ID, TASK_ID, RUN_ID, "vr-001", result);

      expect(path).toBe(runValidationPath(REPO_ID, TASK_ID, RUN_ID, "vr-001.json"));
      const absPath = join(ARTIFACT_ROOT, path);
      expect(JSON.parse(fakeFs.files.get(absPath)!)).toEqual(result);
    });
  });

  // ─── storeReviewArtifact ───────────────────────────────────────────────────

  describe("storeReviewArtifact", () => {
    /**
     * Tests review artifact storage in the reviews/{reviewCycleId}/ subdirectory.
     */

    it("stores artifact in reviews/{reviewCycleId}/", async () => {
      const result = await store.storeReviewArtifact(
        REPO_ID,
        TASK_ID,
        REVIEW_CYCLE_ID,
        "specialist-feedback.json",
        '{"verdict":"approved"}',
      );

      expect(result).toBe(
        reviewArtifactPath(REPO_ID, TASK_ID, REVIEW_CYCLE_ID, "specialist-feedback.json"),
      );
    });
  });

  // ─── storeMergeArtifact ────────────────────────────────────────────────────

  describe("storeMergeArtifact", () => {
    /**
     * Tests merge artifact storage in the merges/ subdirectory.
     */

    it("stores artifact in merges/", async () => {
      const result = await store.storeMergeArtifact(
        REPO_ID,
        TASK_ID,
        "merge-result.json",
        '{"status":"success"}',
      );

      expect(result).toBe(mergeArtifactPath(REPO_ID, TASK_ID, "merge-result.json"));
    });
  });

  // ─── storeSummary ──────────────────────────────────────────────────────────

  describe("storeSummary", () => {
    /**
     * Tests summary storage in the summaries/ subdirectory.
     */

    it("stores summary in summaries/", async () => {
      const result = await store.storeSummary(
        REPO_ID,
        TASK_ID,
        "completion-summary.md",
        "# Task Complete\nAll tests passed.",
      );

      expect(result).toBe(summaryPath(REPO_ID, TASK_ID, "completion-summary.md"));
      const absPath = join(ARTIFACT_ROOT, result);
      expect(fakeFs.files.get(absPath)).toBe("# Task Complete\nAll tests passed.");
    });
  });

  // ─── exists ────────────────────────────────────────────────────────────────

  describe("exists", () => {
    /**
     * Tests artifact existence checks. Used by ArtifactExistencePort to
     * verify that artifact_refs in packets point to real files.
     */

    it("returns true for an existing artifact", async () => {
      await store.storeArtifact("test/file.txt", "content");
      expect(await store.exists("test/file.txt")).toBe(true);
    });

    it("returns false for a non-existent artifact", async () => {
      expect(await store.exists("does/not/exist.txt")).toBe(false);
    });
  });

  // ─── readArtifact ──────────────────────────────────────────────────────────

  describe("readArtifact", () => {
    /**
     * Tests artifact reading. Used for retrieval and by downstream services
     * that need to load previously stored artifacts.
     */

    it("returns the content of a stored artifact", async () => {
      await store.storeArtifact("test.txt", "hello world");
      const content = await store.readArtifact("test.txt");
      expect(content).toBe("hello world");
    });

    it("throws ArtifactNotFoundError for missing artifacts", async () => {
      await expect(store.readArtifact("missing.txt")).rejects.toThrow(ArtifactNotFoundError);
    });

    it("throws ArtifactStorageError on filesystem read errors", async () => {
      // Store first, then simulate read error
      await store.storeArtifact("test.txt", "content");
      fakeFs.readError = new Error("EIO: i/o error");

      await expect(store.readArtifact("test.txt")).rejects.toThrow(ArtifactStorageError);
    });
  });

  // ─── readJSON ──────────────────────────────────────────────────────────────

  describe("readJSON", () => {
    /**
     * Tests JSON artifact reading and parsing. Critical for packet retrieval.
     */

    it("returns parsed JSON for a valid JSON artifact", async () => {
      const data = { packet_type: "test", count: 5 };
      await store.storeJSON("data.json", data);

      const result = await store.readJSON("data.json");
      expect(result).toEqual(data);
    });

    it("throws ArtifactStorageError for invalid JSON content", async () => {
      await store.storeArtifact("bad.json", "not-json{{{");

      await expect(store.readJSON("bad.json")).rejects.toThrow(ArtifactStorageError);
    });

    it("throws ArtifactNotFoundError for missing files", async () => {
      await expect(store.readJSON("nope.json")).rejects.toThrow(ArtifactNotFoundError);
    });
  });

  // ─── resolveAbsolutePath / toRelativePath ──────────────────────────────────

  describe("path resolution", () => {
    /**
     * Tests bidirectional path conversion between relative artifact_refs
     * and absolute filesystem paths.
     */

    it("resolveAbsolutePath joins artifact root with relative path", () => {
      const abs = store.resolveAbsolutePath("repositories/r1/tasks/t1/packets/test.json");
      expect(abs).toBe(join(ARTIFACT_ROOT, "repositories/r1/tasks/t1/packets/test.json"));
    });

    it("toRelativePath strips the artifact root prefix", () => {
      const abs = join(ARTIFACT_ROOT, "repositories/r1/tasks/t1/packets/test.json");
      const rel = store.toRelativePath(abs);
      expect(rel).toBe(join("repositories", "r1", "tasks", "t1", "packets", "test.json"));
    });

    it("round-trips correctly", () => {
      const original = "repositories/r1/tasks/t1/logs/stdout.log";
      const abs = store.resolveAbsolutePath(original);
      const backToRel = store.toRelativePath(abs);
      expect(backToRel).toBe(original);
    });
  });

  // ─── Directory creation idempotency ────────────────────────────────────────

  describe("directory creation idempotency", () => {
    /**
     * Tests that storing multiple artifacts in the same directory doesn't
     * fail due to "directory already exists" errors. This is important for
     * concurrent writes and multi-artifact storage.
     */

    it("stores multiple artifacts in the same directory without errors", async () => {
      await store.storePacket(REPO_ID, TASK_ID, "dev_result_packet", "run-1", { v: 1 });
      await store.storePacket(REPO_ID, TASK_ID, "review_packet", "rc-1", { v: 2 });

      // Both should exist
      const path1 = packetPath(REPO_ID, TASK_ID, "dev_result_packet", "run-1");
      const path2 = packetPath(REPO_ID, TASK_ID, "review_packet", "rc-1");
      expect(await store.exists(path1)).toBe(true);
      expect(await store.exists(path2)).toBe(true);
    });

    it("stores multiple logs for the same run without errors", async () => {
      await store.storeLog(REPO_ID, TASK_ID, RUN_ID, "stdout", "stdout content");
      await store.storeLog(REPO_ID, TASK_ID, RUN_ID, "stderr", "stderr content");

      expect(await store.exists(runLogPath(REPO_ID, TASK_ID, RUN_ID, "stdout"))).toBe(true);
      expect(await store.exists(runLogPath(REPO_ID, TASK_ID, RUN_ID, "stderr"))).toBe(true);
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    /**
     * Tests boundary conditions and unusual inputs.
     */

    it("handles empty string content", async () => {
      const path = await store.storeArtifact("empty.txt", "");
      const content = await store.readArtifact(path);
      expect(content).toBe("");
    });

    it("handles large content", async () => {
      const largeContent = "x".repeat(1_000_000);
      const path = await store.storeArtifact("large.bin", largeContent);
      const content = await store.readArtifact(path);
      expect(content.length).toBe(1_000_000);
    });

    it("handles special characters in identifiers", async () => {
      const result = await store.storePacket(
        "repo-with-dashes",
        "T001-special",
        "dev_result_packet",
        "run-abc-123",
        { test: true },
      );
      expect(result).toContain("repo-with-dashes");
      expect(result).toContain("T001-special");
      expect(await store.exists(result)).toBe(true);
    });

    it("handles null and undefined values in JSON", async () => {
      const data = { value: null, optional: undefined };
      await store.storeJSON("nullish.json", data);
      const parsed = await store.readJSON("nullish.json");
      // undefined is stripped by JSON.stringify
      expect(parsed).toEqual({ value: null });
    });
  });

  // ─── getArtifact ───────────────────────────────────────────────────────────

  describe("getArtifact", () => {
    /**
     * Tests retrieving artifact content by entity reference path.
     * This is the primary retrieval method used by the API and UI.
     * It returns null for missing artifacts instead of throwing,
     * which enables graceful degradation in callers.
     */

    it("returns content of an existing artifact by ref within a task", async () => {
      const packet = { packet_type: "dev_result_packet", status: "success" };
      await store.storePacket(REPO_ID, TASK_ID, "dev_result_packet", RUN_ID, packet);

      const content = await store.getArtifact(
        REPO_ID,
        TASK_ID,
        `packets/dev_result_packet-${RUN_ID}.json`,
      );
      expect(content).not.toBeNull();
      expect(JSON.parse(content!)).toEqual(packet);
    });

    it("returns null for a non-existent artifact (graceful handling)", async () => {
      const result = await store.getArtifact(REPO_ID, TASK_ID, "packets/nonexistent.json");
      expect(result).toBeNull();
    });

    it("returns null when task directory does not exist", async () => {
      const result = await store.getArtifact("no-repo", "no-task", "packets/test.json");
      expect(result).toBeNull();
    });

    it("retrieves log artifacts by ref", async () => {
      await store.storeLog(REPO_ID, TASK_ID, RUN_ID, "stdout", "log line 1\nlog line 2");

      const content = await store.getArtifact(REPO_ID, TASK_ID, `runs/${RUN_ID}/logs/stdout.log`);
      expect(content).toBe("log line 1\nlog line 2");
    });

    it("retrieves review artifacts by ref", async () => {
      await store.storeReviewArtifact(
        REPO_ID,
        TASK_ID,
        REVIEW_CYCLE_ID,
        "feedback.json",
        '{"verdict":"approved"}',
      );

      const content = await store.getArtifact(
        REPO_ID,
        TASK_ID,
        `reviews/${REVIEW_CYCLE_ID}/feedback.json`,
      );
      expect(content).toBe('{"verdict":"approved"}');
    });

    it("throws PathTraversalError for traversal attempts", async () => {
      await expect(
        store.getArtifact(REPO_ID, TASK_ID, "../../../../../etc/passwd"),
      ).rejects.toThrow(PathTraversalError);
    });

    it("throws PathTraversalError for absolute path injection", async () => {
      await expect(
        store.getArtifact(REPO_ID, TASK_ID, "../../../../../../outside"),
      ).rejects.toThrow(PathTraversalError);
    });

    it("throws ArtifactStorageError on filesystem read errors", async () => {
      await store.storeArtifact(
        join("repositories", REPO_ID, "tasks", TASK_ID, "packets", "test.json"),
        "content",
      );
      fakeFs.readError = new Error("EIO: i/o error");

      await expect(store.getArtifact(REPO_ID, TASK_ID, "packets/test.json")).rejects.toThrow(
        ArtifactStorageError,
      );
    });
  });

  // ─── getJSONArtifact ───────────────────────────────────────────────────────

  describe("getJSONArtifact", () => {
    /**
     * Tests JSON artifact retrieval with parsing. This is the most common
     * retrieval pattern since packets and validation results are all JSON.
     * Returns null for missing artifacts and throws on parse errors.
     */

    it("returns parsed JSON for an existing packet", async () => {
      const packet = { packet_type: "dev_result_packet", schema_version: "1.0", status: "success" };
      await store.storePacket(REPO_ID, TASK_ID, "dev_result_packet", RUN_ID, packet);

      const result = await store.getJSONArtifact<typeof packet>(
        REPO_ID,
        TASK_ID,
        `packets/dev_result_packet-${RUN_ID}.json`,
      );
      expect(result).toEqual(packet);
    });

    it("returns null for non-existent artifacts", async () => {
      const result = await store.getJSONArtifact(REPO_ID, TASK_ID, "packets/missing.json");
      expect(result).toBeNull();
    });

    it("preserves schema_version field for version-aware consumers", async () => {
      const packet = { schema_version: "2.1", packet_type: "test", data: [1, 2, 3] };
      await store.storePacket(REPO_ID, TASK_ID, "test", "p1", packet);

      const result = await store.getJSONArtifact<typeof packet>(
        REPO_ID,
        TASK_ID,
        "packets/test-p1.json",
      );
      expect(result).not.toBeNull();
      expect(result!.schema_version).toBe("2.1");
    });

    it("throws ArtifactStorageError for invalid JSON content", async () => {
      await store.storeArtifact(
        join("repositories", REPO_ID, "tasks", TASK_ID, "packets", "bad.json"),
        "not valid json{{{",
      );

      await expect(store.getJSONArtifact(REPO_ID, TASK_ID, "packets/bad.json")).rejects.toThrow(
        ArtifactStorageError,
      );
    });

    it("throws PathTraversalError for traversal attempts", async () => {
      await expect(
        store.getJSONArtifact(REPO_ID, TASK_ID, "../../../../../secrets.json"),
      ).rejects.toThrow(PathTraversalError);
    });
  });

  // ─── listArtifacts ─────────────────────────────────────────────────────────

  describe("listArtifacts", () => {
    /**
     * Tests listing all artifacts for a task. The listing walks the directory
     * tree recursively and returns a flat array of entries. This is critical
     * for the API and UI to show artifact trees for a task.
     * Returns an empty array for non-existent tasks (graceful handling).
     */

    it("returns empty array for a task with no artifacts", async () => {
      const entries = await store.listArtifacts("no-repo", "no-task");
      expect(entries).toEqual([]);
    });

    it("lists all artifacts in a task directory tree", async () => {
      await store.storePacket(REPO_ID, TASK_ID, "dev_result_packet", RUN_ID, { v: 1 });
      await store.storeLog(REPO_ID, TASK_ID, RUN_ID, "stdout", "log content");
      await store.storeSummary(REPO_ID, TASK_ID, "final.md", "# Summary");

      const entries = await store.listArtifacts(REPO_ID, TASK_ID);

      const fileEntries = entries.filter((e: ArtifactEntry) => e.type === "file");
      const dirEntries = entries.filter((e: ArtifactEntry) => e.type === "directory");

      expect(fileEntries.length).toBeGreaterThanOrEqual(3);
      expect(dirEntries.length).toBeGreaterThanOrEqual(1);

      // Verify specific files exist in the listing
      const paths = entries.map((e: ArtifactEntry) => e.relativePath);
      expect(paths).toContain(packetPath(REPO_ID, TASK_ID, "dev_result_packet", RUN_ID));
      expect(paths).toContain(runLogPath(REPO_ID, TASK_ID, RUN_ID, "stdout"));
      expect(paths).toContain(summaryPath(REPO_ID, TASK_ID, "final.md"));
    });

    it("includes both files and directories in results", async () => {
      await store.storePacket(REPO_ID, TASK_ID, "test", "p1", { data: true });

      const entries = await store.listArtifacts(REPO_ID, TASK_ID);
      const types = new Set(entries.map((e: ArtifactEntry) => e.type));
      expect(types.has("file")).toBe(true);
      expect(types.has("directory")).toBe(true);
    });

    it("entry relativePaths are usable with readArtifact", async () => {
      await store.storePacket(REPO_ID, TASK_ID, "dev_result_packet", RUN_ID, { check: true });

      const entries = await store.listArtifacts(REPO_ID, TASK_ID);
      const jsonFiles = entries.filter(
        (e: ArtifactEntry) => e.type === "file" && e.name.endsWith(".json"),
      );
      expect(jsonFiles.length).toBeGreaterThan(0);

      // Every file entry's relativePath should be readable
      for (const entry of jsonFiles) {
        const content = await store.readArtifact(entry.relativePath);
        expect(content).toBeTruthy();
      }
    });

    it("throws ArtifactStorageError on filesystem errors during listing", async () => {
      // Store something so the dir exists
      await store.storePacket(REPO_ID, TASK_ID, "test", "p1", {});
      fakeFs.readError = new Error("EIO: i/o error");

      await expect(store.listArtifacts(REPO_ID, TASK_ID)).rejects.toThrow(ArtifactStorageError);
    });
  });

  // ─── listRunArtifacts ──────────────────────────────────────────────────────

  describe("listRunArtifacts", () => {
    /**
     * Tests listing artifacts for a specific run within a task. This scopes
     * the listing to runs/{runId}/ and only returns artifacts from that run.
     * Used by the UI to show logs/outputs/validation for a specific worker run.
     */

    it("returns empty array for a non-existent run", async () => {
      const entries = await store.listRunArtifacts(REPO_ID, TASK_ID, "no-such-run");
      expect(entries).toEqual([]);
    });

    it("lists only artifacts for the specified run", async () => {
      // Store artifacts in two different runs
      await store.storeLog(REPO_ID, TASK_ID, "run-001", "stdout", "run 1 output");
      await store.storeLog(REPO_ID, TASK_ID, "run-002", "stdout", "run 2 output");

      const run1Entries = await store.listRunArtifacts(REPO_ID, TASK_ID, "run-001");
      const run1Paths = run1Entries.map((e: ArtifactEntry) => e.relativePath);

      // Should contain run-001 artifacts
      expect(run1Paths).toContain(runLogPath(REPO_ID, TASK_ID, "run-001", "stdout"));
      // Should NOT contain run-002 artifacts
      const hasRun2 = run1Paths.some((p: string) => p.includes("run-002"));
      expect(hasRun2).toBe(false);
    });

    it("includes logs, outputs, and validation results", async () => {
      await store.storeLog(REPO_ID, TASK_ID, RUN_ID, "stdout", "output");
      await store.storeValidationResult(REPO_ID, TASK_ID, RUN_ID, "vr-001", { passed: true });

      const entries = await store.listRunArtifacts(REPO_ID, TASK_ID, RUN_ID);
      const paths = entries.map((e: ArtifactEntry) => e.relativePath);

      expect(paths).toContain(runLogPath(REPO_ID, TASK_ID, RUN_ID, "stdout"));
      expect(paths).toContain(runValidationPath(REPO_ID, TASK_ID, RUN_ID, "vr-001.json"));
    });

    it("throws ArtifactStorageError on filesystem errors during listing", async () => {
      await store.storeLog(REPO_ID, TASK_ID, RUN_ID, "stdout", "data");
      fakeFs.readError = new Error("permission denied");

      await expect(store.listRunArtifacts(REPO_ID, TASK_ID, RUN_ID)).rejects.toThrow(
        ArtifactStorageError,
      );
    });
  });

  // ─── Path traversal security ───────────────────────────────────────────────

  describe("path traversal security", () => {
    /**
     * Tests that directory traversal attacks are blocked. This is critical
     * security validation — without it, a malicious artifactRef could read
     * arbitrary files on the filesystem.
     */

    it("blocks simple parent traversal", async () => {
      await expect(
        store.getArtifact(REPO_ID, TASK_ID, "../../../../../etc/passwd"),
      ).rejects.toThrow(PathTraversalError);
    });

    it("blocks deeply nested traversal", async () => {
      await expect(
        store.getArtifact(REPO_ID, TASK_ID, "../../../../../../root/.ssh/id_rsa"),
      ).rejects.toThrow(PathTraversalError);
    });

    it("allows legitimate nested paths", async () => {
      await store.storeLog(REPO_ID, TASK_ID, RUN_ID, "stdout", "safe content");

      // This should NOT throw — it's a legitimate nested path
      const content = await store.getArtifact(REPO_ID, TASK_ID, `runs/${RUN_ID}/logs/stdout.log`);
      expect(content).toBe("safe content");
    });

    it("PathTraversalError includes the offending path", async () => {
      try {
        await store.getArtifact(REPO_ID, TASK_ID, "../../../../../evil");
        expect.fail("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PathTraversalError);
        expect((err as PathTraversalError).artifactPath).toContain("evil");
      }
    });
  });
});
