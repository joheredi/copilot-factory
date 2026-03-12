/**
 * Crash recovery service — captures partial work artifacts from a workspace
 * when a lease is reclaimed, and checks for filesystem-persisted result packets.
 *
 * This service implements the crash recovery protocol from PRD §2.8 and the
 * network partition handling from §9.8.2:
 *
 * 1. Checks the workspace for a filesystem-persisted result packet
 *    (workers may write results to disk when they cannot reach the control plane)
 * 2. If a valid result is found, returns it for normal processing — the reclaim
 *    can be avoided entirely
 * 3. If the result is found but invalid, stores it as an artifact for debugging
 * 4. Captures partial work: modified file list, git diff, output files
 * 5. Stores all captured artifacts via the artifact port
 * 6. Updates the lease record with partial artifact reference paths
 * 7. Returns a PartialWorkSnapshot for inclusion in the next TaskPacket's
 *    `context.prior_partial_work`
 *
 * All filesystem operations are best-effort: if a crash left the workspace
 * in an inconsistent state, capture what's available and don't fail on errors.
 *
 * @see docs/prd/002-data-model.md §2.8 — Worker Lease Protocol (Crash Recovery)
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8.2 — Network Partition Handling
 * @module @factory/application/services/crash-recovery.service
 */

import type {
  PartialWorkSnapshot,
  WorkspaceInspectorPort,
  CrashRecoveryArtifactPort,
  CrashRecoveryLeasePort,
  ResultPacketValidatorPort,
} from "../ports/crash-recovery.ports.js";

// ─── Service Input/Output Types ─────────────────────────────────────────────

/**
 * Parameters for performing crash recovery on a reclaimed lease's workspace.
 */
export interface CrashRecoveryParams {
  /** ID of the lease being reclaimed. */
  readonly leaseId: string;
  /** ID of the task associated with the lease. */
  readonly taskId: string;
  /** Repository ID for artifact path construction. */
  readonly repoId: string;
  /** Worker run ID for artifact path construction. */
  readonly runId: string;
  /** Absolute path to the workspace root directory. */
  readonly workspacePath: string;
  /** Absolute path to the workspace worktree directory (git checkout). */
  readonly worktreePath: string;
}

/**
 * Result of crash recovery — either a valid result packet was found
 * (and the reclaim should be reconsidered), or partial work was captured.
 *
 * - `result_found`: A valid, parseable result packet was found on the filesystem.
 *   The caller should process it normally instead of proceeding with reclaim.
 * - `partial_captured`: No valid result found; partial artifacts were captured
 *   and stored. The reclaim should proceed, and the snapshot should be included
 *   in the next retry's TaskPacket.
 * - `nothing_captured`: Workspace was empty or inaccessible. Reclaim proceeds
 *   without any partial work context.
 */
export type CrashRecoveryResult =
  | {
      readonly outcome: "result_found";
      /** The parsed result packet data. */
      readonly resultData: unknown;
    }
  | {
      readonly outcome: "partial_captured";
      /** The captured partial work snapshot. */
      readonly snapshot: PartialWorkSnapshot;
      /** All artifact reference paths stored during capture. */
      readonly artifactRefs: readonly string[];
    }
  | {
      readonly outcome: "nothing_captured";
    };

/**
 * Crash recovery service interface.
 *
 * Provides the `recoverFromCrash` operation that inspects a workspace
 * after a lease reclaim, captures partial work, and stores artifacts.
 */
export interface CrashRecoveryService {
  /**
   * Attempt to recover work from a crashed worker's workspace.
   *
   * This should be called before or during lease reclaim to check for
   * filesystem-persisted results and capture partial work artifacts.
   *
   * All filesystem operations are best-effort — errors during capture
   * are caught and logged, not propagated.
   *
   * @param params - Recovery parameters including workspace paths and IDs.
   * @returns The recovery result indicating what was found.
   */
  recoverFromCrash(params: CrashRecoveryParams): Promise<CrashRecoveryResult>;
}

// ─── Dependencies ───────────────────────────────────────────────────────────

/**
 * Dependencies injected into the crash recovery service.
 */
export interface CrashRecoveryDependencies {
  /** Inspects workspace filesystem for result packets and partial work. */
  readonly workspaceInspector: WorkspaceInspectorPort;
  /** Stores captured artifacts (diffs, outputs, snapshots). */
  readonly artifactStore: CrashRecoveryArtifactPort;
  /** Updates lease records with artifact references. */
  readonly leasePort: CrashRecoveryLeasePort;
  /** Validates raw content as a result packet. */
  readonly resultValidator: ResultPacketValidatorPort;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a crash recovery service with injected dependencies.
 *
 * @param deps - All required dependencies for workspace inspection and artifact capture.
 * @returns A CrashRecoveryService instance.
 *
 * @see docs/prd/002-data-model.md §2.8 — Crash Recovery
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8.2 — Network Partition Handling
 */
export function createCrashRecoveryService(deps: CrashRecoveryDependencies): CrashRecoveryService {
  const { workspaceInspector, artifactStore, leasePort, resultValidator } = deps;

  return {
    async recoverFromCrash(params: CrashRecoveryParams): Promise<CrashRecoveryResult> {
      const { leaseId, taskId, repoId, runId, workspacePath, worktreePath } = params;

      // ── Step 1: Check for filesystem-persisted result packet (§9.8.2) ──
      const resultPacketContent = await safeAsync(
        () => workspaceInspector.readResultPacket(workspacePath),
        null,
      );

      if (resultPacketContent !== null) {
        const validation = resultValidator.validate(resultPacketContent);

        if (validation.valid) {
          // Valid result found — caller should process normally, not reclaim
          return { outcome: "result_found", resultData: validation.data };
        }

        // Invalid result — store it for debugging, then continue with partial capture
      }

      // ── Step 2: Capture partial work artifacts ────────────────────────
      const artifactRefs: string[] = [];

      // 2a: Capture modified files list
      const modifiedFiles = await safeAsync(
        () => workspaceInspector.getModifiedFiles(worktreePath),
        [] as readonly string[],
      );

      // 2b: Capture git diff
      let gitDiffRef: string | null = null;
      const gitDiff = await safeAsync(() => workspaceInspector.getGitDiff(worktreePath), null);

      if (gitDiff !== null && gitDiff.length > 0) {
        gitDiffRef = await safeAsync(
          () => artifactStore.storeGitDiff(repoId, taskId, runId, gitDiff),
          null,
        );
        if (gitDiffRef !== null) {
          artifactRefs.push(gitDiffRef);
        }
      }

      // 2c: Capture output files
      const partialOutputRefs: string[] = [];
      const outputFiles = await safeAsync(
        () => workspaceInspector.readOutputFiles(workspacePath),
        [] as readonly import("../ports/crash-recovery.ports.js").WorkspaceOutputFile[],
      );

      for (const file of outputFiles) {
        const ref = await safeAsync(
          () => artifactStore.storePartialOutput(repoId, taskId, runId, file.name, file.content),
          null,
        );
        if (ref !== null) {
          partialOutputRefs.push(ref);
          artifactRefs.push(ref);
        }
      }

      // 2d: Store invalid result packet if one was found
      let invalidResultPacketRef: string | null = null;
      if (resultPacketContent !== null) {
        invalidResultPacketRef = await safeAsync(
          () => artifactStore.storeInvalidResultPacket(repoId, taskId, runId, resultPacketContent),
          null,
        );
        if (invalidResultPacketRef !== null) {
          artifactRefs.push(invalidResultPacketRef);
        }
      }

      // ── Step 3: Check if anything was captured ────────────────────────
      const hasAnyWork =
        modifiedFiles.length > 0 ||
        gitDiffRef !== null ||
        partialOutputRefs.length > 0 ||
        invalidResultPacketRef !== null;

      if (!hasAnyWork) {
        return { outcome: "nothing_captured" };
      }

      // ── Step 4: Build and store the snapshot ──────────────────────────
      const snapshot: PartialWorkSnapshot = {
        capturedAt: new Date().toISOString(),
        leaseId,
        taskId,
        modifiedFiles: [...modifiedFiles],
        gitDiffRef,
        partialOutputRefs,
        invalidResultPacketRef,
      };

      const snapshotRef = await safeAsync(
        () => artifactStore.storeSnapshot(repoId, taskId, runId, snapshot),
        null,
      );
      if (snapshotRef !== null) {
        artifactRefs.push(snapshotRef);
      }

      // ── Step 5: Update the lease with artifact references ─────────────
      await safeAsync(() => leasePort.updatePartialArtifactRefs(leaseId, artifactRefs), undefined);

      return {
        outcome: "partial_captured",
        snapshot,
        artifactRefs,
      };
    },
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Execute an async operation with best-effort error handling.
 *
 * Crash recovery must not fail due to filesystem inconsistencies.
 * If any operation fails, we return the fallback value and continue
 * capturing whatever we can.
 *
 * @param fn - The async operation to attempt.
 * @param fallback - Value to return if the operation throws.
 * @returns The operation result, or the fallback on error.
 */
async function safeAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
