/**
 * Infrastructure adapter implementing {@link CrashRecoveryArtifactPort} for crash recovery.
 *
 * Delegates artifact storage to the {@link ArtifactStore} using the §7.11
 * directory layout. Each method maps a crash recovery artifact type to the
 * appropriate path under `runs/{runId}/outputs/` within the task's artifact
 * tree.
 *
 * @see docs/prd/007-technical-architecture.md §7.11 — Artifact Storage Layout
 * @see docs/backlog/tasks/T072-partial-work-snapshot.md
 * @module @factory/infrastructure/crash-recovery/crash-recovery-artifact-adapter
 */

import type { ArtifactStore } from "../artifacts/artifact-store.js";
import { runOutputPath } from "../artifacts/artifact-store.js";
import type { CrashRecoveryArtifactPort, PartialWorkSnapshot } from "@factory/application";

// ─── Well-Known Filenames ───────────────────────────────────────────────────

/** Filename for the stored git diff artifact. */
const GIT_DIFF_FILENAME = "git-diff.patch";

/** Filename for the stored crash recovery snapshot metadata. */
const SNAPSHOT_FILENAME = "crash-recovery-snapshot.json";

/** Filename for an invalid result packet found on the filesystem. */
const INVALID_RESULT_FILENAME = "invalid-result-packet.json";

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a {@link CrashRecoveryArtifactPort} adapter backed by an {@link ArtifactStore}.
 *
 * Stores crash recovery artifacts under the standard §7.11 layout:
 * ```text
 * repositories/{repoId}/tasks/{taskId}/runs/{runId}/outputs/
 *   git-diff.patch
 *   crash-recovery-snapshot.json
 *   invalid-result-packet.json
 *   {original-output-filename}
 * ```
 *
 * All writes are atomic (via ArtifactStore's .tmp → rename pattern).
 * All returned paths are relative to the artifact root.
 *
 * @param artifactStore - The artifact store to delegate storage to.
 * @returns A CrashRecoveryArtifactPort implementation.
 *
 * @see docs/backlog/tasks/T072-partial-work-snapshot.md
 */
export function createCrashRecoveryArtifactAdapter(
  artifactStore: ArtifactStore,
): CrashRecoveryArtifactPort {
  return {
    async storeGitDiff(
      repoId: string,
      taskId: string,
      runId: string,
      diffContent: string,
    ): Promise<string> {
      const path = runOutputPath(repoId, taskId, runId, GIT_DIFF_FILENAME);
      return await artifactStore.storeArtifact(path, diffContent);
    },

    async storePartialOutput(
      repoId: string,
      taskId: string,
      runId: string,
      filename: string,
      content: string,
    ): Promise<string> {
      const path = runOutputPath(repoId, taskId, runId, filename);
      return await artifactStore.storeArtifact(path, content);
    },

    async storeInvalidResultPacket(
      repoId: string,
      taskId: string,
      runId: string,
      content: string,
    ): Promise<string> {
      const path = runOutputPath(repoId, taskId, runId, INVALID_RESULT_FILENAME);
      return await artifactStore.storeArtifact(path, content);
    },

    async storeSnapshot(
      repoId: string,
      taskId: string,
      runId: string,
      snapshot: PartialWorkSnapshot,
    ): Promise<string> {
      const path = runOutputPath(repoId, taskId, runId, SNAPSHOT_FILENAME);
      return await artifactStore.storeJSON(path, snapshot);
    },
  };
}
