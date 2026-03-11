/**
 * @module artifacts/artifact-store
 * Filesystem-based artifact storage with the structured directory layout from §7.11.
 *
 * Artifacts are stored under a configurable root directory with the following
 * hierarchy:
 *
 * ```text
 * {artifactRoot}/repositories/{repoId}/tasks/{taskId}/
 *   packets/{packetType}-{id}.json
 *   runs/{runId}/logs/{logName}.log
 *   runs/{runId}/outputs/{filename}
 *   runs/{runId}/validation/{filename}
 *   reviews/{reviewCycleId}/{filename}
 *   merges/{filename}
 *   summaries/{filename}
 * ```
 *
 * All writes are atomic: content is written to a `.tmp` sibling file, then
 * renamed into the final path. On POSIX filesystems `rename(2)` on the same
 * volume is an atomic operation, so readers never observe partial files.
 *
 * All returned paths are **relative** to the artifact root so they can be
 * stored as `artifact_refs` in entities without coupling to the deployment layout.
 *
 * @see docs/prd/007-technical-architecture.md §7.11 — Artifact Storage Layout
 * @see docs/backlog/tasks/T069-artifact-storage.md
 */

import { join, dirname, relative, resolve, normalize } from "node:path";

import type { FileSystem } from "../workspace/types.js";

// ─── Configuration ─────────────────────────────────────────────────────────────

/**
 * Configuration for the filesystem artifact store.
 */
export interface ArtifactStoreConfig {
  /**
   * Absolute path to the root directory where all artifacts are stored.
   * The directory is created on first write if it does not exist.
   */
  readonly artifactRoot: string;
}

// ─── Errors ────────────────────────────────────────────────────────────────────

/**
 * Thrown when an artifact storage operation fails.
 * Captures the artifact path and the underlying filesystem error.
 */
export class ArtifactStorageError extends Error {
  /** Relative artifact path that was being written or read. */
  readonly artifactPath: string;
  /** The underlying error that caused the failure. */
  override readonly cause: unknown;

  constructor(artifactPath: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Artifact storage failed for "${artifactPath}": ${msg}`);
    this.name = "ArtifactStorageError";
    this.artifactPath = artifactPath;
    this.cause = cause;
  }
}

/**
 * Thrown when an artifact cannot be found at the expected path.
 */
export class ArtifactNotFoundError extends Error {
  /** Relative artifact path that was not found. */
  readonly artifactPath: string;

  constructor(artifactPath: string) {
    super(`Artifact not found: "${artifactPath}"`);
    this.name = "ArtifactNotFoundError";
    this.artifactPath = artifactPath;
  }
}

/**
 * Thrown when an artifact path attempts to escape the artifact root via
 * directory traversal (e.g., `../../etc/passwd`).
 *
 * This is a security error — callers should never construct paths that
 * leave the artifact root boundary.
 */
export class PathTraversalError extends Error {
  /** The offending relative path that attempted traversal. */
  readonly artifactPath: string;

  constructor(artifactPath: string) {
    super(`Path traversal detected: "${artifactPath}" escapes the artifact root`);
    this.name = "PathTraversalError";
    this.artifactPath = artifactPath;
  }
}

// ─── Artifact Entry ────────────────────────────────────────────────────────────

/**
 * Represents a single entry in an artifact directory listing.
 *
 * Used by {@link ArtifactStore.listArtifacts} and {@link ArtifactStore.listRunArtifacts}
 * to describe the contents of an artifact directory tree.
 */
export interface ArtifactEntry {
  /** Path relative to the artifact root. Can be used directly with readArtifact/readJSON. */
  readonly relativePath: string;
  /** The filename (leaf name) of the entry. */
  readonly name: string;
  /** Whether this entry is a file or a directory. */
  readonly type: "file" | "directory";
}

// ─── Path Builders ─────────────────────────────────────────────────────────────

/**
 * Build the relative base path for a task's artifact directory.
 *
 * @param repoId - Repository identifier.
 * @param taskId - Task identifier.
 * @returns Relative path: `repositories/{repoId}/tasks/{taskId}`
 */
export function taskBasePath(repoId: string, taskId: string): string {
  return join("repositories", repoId, "tasks", taskId);
}

/**
 * Build the relative path for a packet artifact.
 *
 * @param repoId - Repository identifier.
 * @param taskId - Task identifier.
 * @param packetType - Packet type discriminator (e.g., "dev_result_packet").
 * @param packetId - Unique packet identifier (e.g., run ID or review cycle ID).
 * @returns Relative path: `repositories/{repoId}/tasks/{taskId}/packets/{packetType}-{packetId}.json`
 */
export function packetPath(
  repoId: string,
  taskId: string,
  packetType: string,
  packetId: string,
): string {
  return join(taskBasePath(repoId, taskId), "packets", `${packetType}-${packetId}.json`);
}

/**
 * Build the relative path for a run log file.
 *
 * @param repoId - Repository identifier.
 * @param taskId - Task identifier.
 * @param runId - Worker run identifier.
 * @param logName - Log file name (without extension). `.log` is appended automatically.
 * @returns Relative path: `repositories/{repoId}/tasks/{taskId}/runs/{runId}/logs/{logName}.log`
 */
export function runLogPath(repoId: string, taskId: string, runId: string, logName: string): string {
  return join(taskBasePath(repoId, taskId), "runs", runId, "logs", `${logName}.log`);
}

/**
 * Build the relative path for a run output file.
 *
 * @param repoId - Repository identifier.
 * @param taskId - Task identifier.
 * @param runId - Worker run identifier.
 * @param filename - Output filename (with extension).
 * @returns Relative path: `repositories/{repoId}/tasks/{taskId}/runs/{runId}/outputs/{filename}`
 */
export function runOutputPath(
  repoId: string,
  taskId: string,
  runId: string,
  filename: string,
): string {
  return join(taskBasePath(repoId, taskId), "runs", runId, "outputs", filename);
}

/**
 * Build the relative path for a run validation result.
 *
 * @param repoId - Repository identifier.
 * @param taskId - Task identifier.
 * @param runId - Worker run identifier.
 * @param filename - Validation result filename (with extension).
 * @returns Relative path: `repositories/{repoId}/tasks/{taskId}/runs/{runId}/validation/{filename}`
 */
export function runValidationPath(
  repoId: string,
  taskId: string,
  runId: string,
  filename: string,
): string {
  return join(taskBasePath(repoId, taskId), "runs", runId, "validation", filename);
}

/**
 * Build the relative path for a review cycle artifact.
 *
 * @param repoId - Repository identifier.
 * @param taskId - Task identifier.
 * @param reviewCycleId - Review cycle identifier.
 * @param filename - Artifact filename (with extension).
 * @returns Relative path: `repositories/{repoId}/tasks/{taskId}/reviews/{reviewCycleId}/{filename}`
 */
export function reviewArtifactPath(
  repoId: string,
  taskId: string,
  reviewCycleId: string,
  filename: string,
): string {
  return join(taskBasePath(repoId, taskId), "reviews", reviewCycleId, filename);
}

/**
 * Build the relative path for a merge artifact.
 *
 * @param repoId - Repository identifier.
 * @param taskId - Task identifier.
 * @param filename - Merge artifact filename (with extension).
 * @returns Relative path: `repositories/{repoId}/tasks/{taskId}/merges/{filename}`
 */
export function mergeArtifactPath(repoId: string, taskId: string, filename: string): string {
  return join(taskBasePath(repoId, taskId), "merges", filename);
}

/**
 * Build the relative path for a summary artifact.
 *
 * @param repoId - Repository identifier.
 * @param taskId - Task identifier.
 * @param filename - Summary filename (with extension).
 * @returns Relative path: `repositories/{repoId}/tasks/{taskId}/summaries/{filename}`
 */
export function summaryPath(repoId: string, taskId: string, filename: string): string {
  return join(taskBasePath(repoId, taskId), "summaries", filename);
}

// ─── Artifact Store ────────────────────────────────────────────────────────────

/**
 * Filesystem-based artifact store with atomic writes and structured directory layout.
 *
 * Provides two families of operations:
 * - **Generic:** {@link storeArtifact} / {@link storeJSON} accept any relative path.
 * - **Typed helpers:** {@link storePacket}, {@link storeLog}, {@link storeValidationResult},
 *   {@link storeReviewArtifact}, {@link storeMergeArtifact}, {@link storeSummary} build
 *   the correct relative path from domain identifiers.
 *
 * All write operations are atomic: content is written to a temporary file
 * (`{path}.tmp`), then renamed to the final path. Readers never see partial files.
 *
 * @see docs/prd/007-technical-architecture.md §7.11 — Artifact Storage Layout
 */
export class ArtifactStore {
  private readonly fs: FileSystem;
  private readonly artifactRoot: string;

  /**
   * @param config - Storage configuration (artifact root path).
   * @param fs - Filesystem abstraction for I/O operations.
   */
  constructor(config: ArtifactStoreConfig, fs: FileSystem) {
    this.artifactRoot = config.artifactRoot;
    this.fs = fs;
  }

  // ─── Generic Operations ────────────────────────────────────────────────────

  /**
   * Store raw string content at the given relative path.
   *
   * Creates parent directories as needed. The write is atomic:
   * content is written to `{path}.tmp` then renamed to the final location.
   *
   * @param relativePath - Path relative to the artifact root.
   * @param content - String content to persist.
   * @returns The relative path where the artifact was stored (same as input).
   * @throws {ArtifactStorageError} If the write or rename fails.
   */
  async storeArtifact(relativePath: string, content: string): Promise<string> {
    const absPath = join(this.artifactRoot, relativePath);
    const tmpPath = `${absPath}.tmp`;

    try {
      await this.fs.mkdir(dirname(absPath), { recursive: true });
      await this.fs.writeFile(tmpPath, content);
      await this.fs.rename(tmpPath, absPath);
    } catch (err: unknown) {
      // Best-effort cleanup of the temp file on failure
      try {
        await this.fs.unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
      throw new ArtifactStorageError(relativePath, err);
    }

    return relativePath;
  }

  /**
   * Serialize a value as pretty-printed JSON and store it at the given relative path.
   *
   * Uses 2-space indentation for readability and debuggability.
   *
   * @param relativePath - Path relative to the artifact root (should end in `.json`).
   * @param data - JSON-serializable value to persist.
   * @returns The relative path where the artifact was stored.
   * @throws {ArtifactStorageError} If serialization or write fails.
   */
  async storeJSON(relativePath: string, data: unknown): Promise<string> {
    const json = JSON.stringify(data, null, 2);
    return this.storeArtifact(relativePath, json);
  }

  // ─── Typed Helpers ─────────────────────────────────────────────────────────

  /**
   * Store a schema-valid packet as a JSON artifact in the `packets/` subdirectory.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param packetType - Packet type discriminator (e.g., "dev_result_packet").
   * @param packetId - Unique packet identifier.
   * @param packet - The packet object to serialize.
   * @returns Relative path: `repositories/{repoId}/tasks/{taskId}/packets/{packetType}-{packetId}.json`
   */
  async storePacket(
    repoId: string,
    taskId: string,
    packetType: string,
    packetId: string,
    packet: unknown,
  ): Promise<string> {
    return this.storeJSON(packetPath(repoId, taskId, packetType, packetId), packet);
  }

  /**
   * Store a log file in the `runs/{runId}/logs/` subdirectory.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param runId - Worker run identifier.
   * @param logName - Log name (without `.log` extension).
   * @param content - Log content.
   * @returns Relative path to the stored log file.
   */
  async storeLog(
    repoId: string,
    taskId: string,
    runId: string,
    logName: string,
    content: string,
  ): Promise<string> {
    return this.storeArtifact(runLogPath(repoId, taskId, runId, logName), content);
  }

  /**
   * Store a validation result in the `runs/{runId}/validation/` subdirectory.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param runId - Worker run identifier.
   * @param validationRunId - Unique validation run identifier (used as filename).
   * @param result - Validation result object to serialize as JSON.
   * @returns Relative path to the stored validation result.
   */
  async storeValidationResult(
    repoId: string,
    taskId: string,
    runId: string,
    validationRunId: string,
    result: unknown,
  ): Promise<string> {
    const filePath = runValidationPath(repoId, taskId, runId, `${validationRunId}.json`);
    return this.storeJSON(filePath, result);
  }

  /**
   * Store a review artifact in the `reviews/{reviewCycleId}/` subdirectory.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param reviewCycleId - Review cycle identifier.
   * @param filename - Artifact filename (with extension).
   * @param content - Artifact content.
   * @returns Relative path to the stored artifact.
   */
  async storeReviewArtifact(
    repoId: string,
    taskId: string,
    reviewCycleId: string,
    filename: string,
    content: string,
  ): Promise<string> {
    return this.storeArtifact(reviewArtifactPath(repoId, taskId, reviewCycleId, filename), content);
  }

  /**
   * Store a merge artifact in the `merges/` subdirectory.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param filename - Artifact filename (with extension).
   * @param content - Artifact content.
   * @returns Relative path to the stored artifact.
   */
  async storeMergeArtifact(
    repoId: string,
    taskId: string,
    filename: string,
    content: string,
  ): Promise<string> {
    return this.storeArtifact(mergeArtifactPath(repoId, taskId, filename), content);
  }

  /**
   * Store a summary artifact in the `summaries/` subdirectory.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param filename - Summary filename (with extension).
   * @param content - Summary content.
   * @returns Relative path to the stored artifact.
   */
  async storeSummary(
    repoId: string,
    taskId: string,
    filename: string,
    content: string,
  ): Promise<string> {
    return this.storeArtifact(summaryPath(repoId, taskId, filename), content);
  }

  // ─── Read Operations ───────────────────────────────────────────────────────

  /**
   * Check whether an artifact exists at the given relative path.
   *
   * @param relativePath - Path relative to the artifact root.
   * @returns True if the artifact exists and is readable.
   */
  async exists(relativePath: string): Promise<boolean> {
    const absPath = join(this.artifactRoot, relativePath);
    return this.fs.exists(absPath);
  }

  /**
   * Read the raw string content of an artifact.
   *
   * @param relativePath - Path relative to the artifact root.
   * @returns The artifact content as a UTF-8 string.
   * @throws {ArtifactNotFoundError} If the artifact does not exist.
   * @throws {ArtifactStorageError} If reading fails for another reason.
   */
  async readArtifact(relativePath: string): Promise<string> {
    const absPath = join(this.artifactRoot, relativePath);
    const fileExists = await this.fs.exists(absPath);
    if (!fileExists) {
      throw new ArtifactNotFoundError(relativePath);
    }
    try {
      return await this.fs.readFile(absPath);
    } catch (err: unknown) {
      throw new ArtifactStorageError(relativePath, err);
    }
  }

  /**
   * Read and parse a JSON artifact.
   *
   * @param relativePath - Path relative to the artifact root (should be a `.json` file).
   * @returns The parsed JSON value.
   * @throws {ArtifactNotFoundError} If the artifact does not exist.
   * @throws {ArtifactStorageError} If reading or parsing fails.
   */
  async readJSON<T = unknown>(relativePath: string): Promise<T> {
    const content = await this.readArtifact(relativePath);
    try {
      return JSON.parse(content) as T;
    } catch (err: unknown) {
      throw new ArtifactStorageError(relativePath, err);
    }
  }

  /**
   * Resolve a relative artifact path to its absolute filesystem path.
   * Useful for external systems that need the full path.
   *
   * @param relativePath - Path relative to the artifact root.
   * @returns Absolute filesystem path.
   */
  resolveAbsolutePath(relativePath: string): string {
    return join(this.artifactRoot, relativePath);
  }

  /**
   * Convert an absolute path back to a relative artifact reference.
   * Returns the portion of the path after the artifact root.
   *
   * @param absolutePath - Absolute filesystem path within the artifact root.
   * @returns Relative path suitable for use as an artifact_ref.
   */
  toRelativePath(absolutePath: string): string {
    return relative(this.artifactRoot, absolutePath);
  }

  // ─── Retrieval Operations ──────────────────────────────────────────────────

  /**
   * Validate that a relative path does not escape the artifact root.
   *
   * Resolves the path against the artifact root and verifies the resulting
   * absolute path is still within the root directory. This prevents directory
   * traversal attacks (e.g., `../../etc/passwd`).
   *
   * @param relativePath - Relative path to validate.
   * @throws {PathTraversalError} If the resolved path escapes the artifact root.
   */
  private validatePath(relativePath: string): void {
    const normalized = normalize(relativePath);
    const absPath = resolve(this.artifactRoot, normalized);
    const normalizedRoot = resolve(this.artifactRoot);
    if (!absPath.startsWith(normalizedRoot + "/") && absPath !== normalizedRoot) {
      throw new PathTraversalError(relativePath);
    }
  }

  /**
   * Retrieve an artifact's raw content by entity reference path.
   *
   * Resolves the artifact reference to the correct location within the task's
   * artifact directory. Returns `null` if the artifact does not exist, rather
   * than throwing, to support graceful degradation in callers.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param artifactRef - Relative reference within the task's artifact directory
   *   (e.g., `packets/dev_result_packet-run-001.json` or `runs/run-001/logs/stdout.log`).
   * @returns The artifact content as a string, or `null` if not found.
   * @throws {PathTraversalError} If the resolved path escapes the artifact root.
   * @throws {ArtifactStorageError} If reading fails for a reason other than "not found".
   *
   * @see docs/backlog/tasks/T070-artifact-retrieval.md
   */
  async getArtifact(repoId: string, taskId: string, artifactRef: string): Promise<string | null> {
    const relativePath = join(taskBasePath(repoId, taskId), artifactRef);
    this.validatePath(relativePath);

    const absPath = join(this.artifactRoot, relativePath);
    const fileExists = await this.fs.exists(absPath);
    if (!fileExists) {
      return null;
    }

    try {
      return await this.fs.readFile(absPath);
    } catch (err: unknown) {
      throw new ArtifactStorageError(relativePath, err);
    }
  }

  /**
   * Retrieve and parse a JSON artifact by entity reference path.
   *
   * Combines {@link getArtifact} with JSON parsing and optional schema version
   * handling. Returns `null` if the artifact does not exist.
   *
   * For schema version handling: if the parsed JSON contains a `schema_version`
   * field, it is preserved as-is. Callers can inspect the version to apply
   * migration logic if needed.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param artifactRef - Relative reference within the task's artifact directory
   *   (e.g., `packets/dev_result_packet-run-001.json`).
   * @returns The parsed JSON value, or `null` if not found.
   * @throws {PathTraversalError} If the resolved path escapes the artifact root.
   * @throws {ArtifactStorageError} If reading or parsing fails.
   *
   * @see docs/backlog/tasks/T070-artifact-retrieval.md
   */
  async getJSONArtifact<T = unknown>(
    repoId: string,
    taskId: string,
    artifactRef: string,
  ): Promise<T | null> {
    const content = await this.getArtifact(repoId, taskId, artifactRef);
    if (content === null) {
      return null;
    }

    const relativePath = join(taskBasePath(repoId, taskId), artifactRef);
    try {
      return JSON.parse(content) as T;
    } catch (err: unknown) {
      throw new ArtifactStorageError(relativePath, err);
    }
  }

  /**
   * List all artifacts for a task as a flat list of entries.
   *
   * Recursively walks the task's artifact directory and returns every file
   * and directory found. Returns an empty array if the task directory does
   * not exist (graceful handling for tasks that have no artifacts yet).
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @returns Array of {@link ArtifactEntry} objects describing the directory tree.
   * @throws {ArtifactStorageError} If reading the directory tree fails.
   *
   * @see docs/backlog/tasks/T070-artifact-retrieval.md
   */
  async listArtifacts(repoId: string, taskId: string): Promise<ArtifactEntry[]> {
    const basePath = taskBasePath(repoId, taskId);
    const absBase = join(this.artifactRoot, basePath);

    const dirExists = await this.fs.exists(absBase);
    if (!dirExists) {
      return [];
    }

    try {
      return await this.walkDirectory(absBase, basePath);
    } catch (err: unknown) {
      throw new ArtifactStorageError(basePath, err);
    }
  }

  /**
   * List artifacts for a specific run within a task.
   *
   * Returns all files and directories under `runs/{runId}/` (logs, outputs,
   * validation results). Returns an empty array if the run directory does
   * not exist.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param runId - Worker run identifier.
   * @returns Array of {@link ArtifactEntry} objects for the run.
   * @throws {ArtifactStorageError} If reading the directory tree fails.
   *
   * @see docs/backlog/tasks/T070-artifact-retrieval.md
   */
  async listRunArtifacts(repoId: string, taskId: string, runId: string): Promise<ArtifactEntry[]> {
    const basePath = join(taskBasePath(repoId, taskId), "runs", runId);
    const absBase = join(this.artifactRoot, basePath);

    const dirExists = await this.fs.exists(absBase);
    if (!dirExists) {
      return [];
    }

    try {
      return await this.walkDirectory(absBase, basePath);
    } catch (err: unknown) {
      throw new ArtifactStorageError(basePath, err);
    }
  }

  /**
   * Recursively walk a directory and collect all entries.
   *
   * @param absDir - Absolute path to the directory to walk.
   * @param relativeBase - Relative path from the artifact root to this directory.
   * @returns Flat array of all entries (files and directories) found.
   */
  private async walkDirectory(absDir: string, relativeBase: string): Promise<ArtifactEntry[]> {
    const entries = await this.fs.readdir(absDir);
    const results: ArtifactEntry[] = [];

    for (const entry of entries) {
      const entryRelPath = join(relativeBase, entry.name);

      if (entry.isDirectory) {
        results.push({
          relativePath: entryRelPath,
          name: entry.name,
          type: "directory",
        });
        const children = await this.walkDirectory(join(absDir, entry.name), entryRelPath);
        results.push(...children);
      } else {
        results.push({
          relativePath: entryRelPath,
          name: entry.name,
          type: "file",
        });
      }
    }

    return results;
  }
}
