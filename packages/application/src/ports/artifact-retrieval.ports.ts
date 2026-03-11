/**
 * Artifact retrieval ports — interfaces for reading and listing stored artifacts.
 *
 * These ports abstract the filesystem-based artifact storage from application
 * services that need to retrieve artifacts for the UI, API, or internal pipelines.
 *
 * @see docs/prd/007-technical-architecture.md §7.6 — Artifact Module
 * @see docs/prd/007-technical-architecture.md §7.11 — Artifact Storage Layout
 * @see docs/backlog/tasks/T070-artifact-retrieval.md
 * @module @factory/application/ports/artifact-retrieval.ports
 */

// ─── Artifact Entry ──────────────────────────────────────────────────────────

/**
 * Represents a single entry in an artifact directory listing.
 */
export interface ArtifactEntryDto {
  /** Path relative to the artifact root. Can be used as an artifact_ref. */
  readonly relativePath: string;
  /** The filename (leaf name) of the entry. */
  readonly name: string;
  /** Whether this entry is a file or a directory. */
  readonly type: "file" | "directory";
}

// ─── Artifact Retrieval Port ─────────────────────────────────────────────────

/**
 * Port for retrieving artifacts from the artifact store.
 *
 * Application services use this port to access stored artifacts without
 * depending on the filesystem-based infrastructure implementation.
 *
 * All retrieval methods handle missing artifacts gracefully by returning
 * `null` (for single-item reads) or empty arrays (for listings) rather
 * than throwing.
 *
 * @see docs/backlog/tasks/T070-artifact-retrieval.md
 */
export interface ArtifactRetrievalPort {
  /**
   * Retrieve raw artifact content by reference path within a task.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param artifactRef - Relative reference within the task's artifact directory
   *   (e.g., `packets/dev_result_packet-run-001.json`).
   * @returns The artifact content as a string, or `null` if not found.
   */
  getArtifact(repoId: string, taskId: string, artifactRef: string): Promise<string | null>;

  /**
   * Retrieve and parse a JSON artifact by reference path within a task.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param artifactRef - Relative reference within the task's artifact directory.
   * @returns The parsed JSON value, or `null` if not found.
   */
  getJSONArtifact<T = unknown>(
    repoId: string,
    taskId: string,
    artifactRef: string,
  ): Promise<T | null>;

  /**
   * List all artifacts for a task.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @returns Array of artifact entries describing the directory tree.
   */
  listArtifacts(repoId: string, taskId: string): Promise<ArtifactEntryDto[]>;

  /**
   * List artifacts for a specific run within a task.
   *
   * @param repoId - Repository identifier.
   * @param taskId - Task identifier.
   * @param runId - Worker run identifier.
   * @returns Array of artifact entries for the run.
   */
  listRunArtifacts(repoId: string, taskId: string, runId: string): Promise<ArtifactEntryDto[]>;
}
