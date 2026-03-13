/**
 * Workspace cleanup service — scans for orphaned worktrees on startup and
 * removes those exceeding the retention period.
 *
 * Runs once during NestJS application bootstrap (after all modules are
 * initialized, before the server starts listening). It cross-references
 * workspace directories on disk against active leases in the database
 * to identify orphaned worktrees from crashed or abandoned workers.
 *
 * Cleanup rules:
 * - A worktree is "orphaned" if **no non-terminal lease** exists for its task ID.
 * - An orphaned worktree older than the retention period → auto-deleted.
 * - An orphaned worktree younger than the retention period → logged as pending.
 * - A worktree with any non-terminal lease → **never** deleted.
 *
 * This is a conservative cleanup mechanism. When in doubt, the worktree
 * is preserved. Errors on individual directories do not prevent processing
 * of the remaining directories.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T149-workspace-cleanup.md}
 * @see {@link file://packages/infrastructure/src/workspace/workspace-manager.ts} — workspace layout
 */
import { existsSync, readdirSync, statSync, rmSync, type Dirent, type Stats } from "node:fs";
import { join } from "node:path";

import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";

import { createLogger, type Logger } from "@factory/observability";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Default workspace retention period in days for orphaned worktrees.
 *
 * Orphaned worktrees (those without any non-terminal lease) are kept for
 * this many days before automatic deletion. This is longer than the
 * regular retention policy (24h) because orphans may contain useful
 * debugging context from crashed workers.
 */
export const DEFAULT_RETENTION_DAYS = 7;

/** Milliseconds per day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Terminal lease statuses from the domain layer.
 *
 * A lease in one of these states is "finished" — the workspace is no longer
 * needed by the worker. If ALL leases for a task are terminal (or no leases
 * exist), the worktree is considered orphaned.
 *
 * @see {@link file://packages/domain/src/enums.ts} — WorkerLeaseStatus
 */
const TERMINAL_LEASE_STATUSES = ["COMPLETING", "RECLAIMED"] as const;

// ─── Filesystem Abstraction ────────────────────────────────────────────────────

/**
 * Minimal filesystem interface used by the workspace cleanup service.
 *
 * Abstracted from Node.js `fs` to enable deterministic testing without
 * touching the real filesystem. Production code passes Node.js `fs` functions;
 * tests pass lightweight fakes.
 */
export interface CleanupFileSystem {
  /** Check whether a path exists. */
  existsSync(path: string): boolean;
  /** List directory entries with file-type information. */
  readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  /** Get file/directory metadata (specifically `mtimeMs`). */
  statSync(path: string): Stats;
  /** Recursively delete a directory tree. */
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}

/** Node.js `fs` functions bundled as a {@link CleanupFileSystem}. */
const NODE_FS: CleanupFileSystem = {
  existsSync,
  readdirSync,
  statSync,
  rmSync,
};

// ─── Configuration ─────────────────────────────────────────────────────────────

/**
 * Options for the workspace cleanup operation.
 *
 * All fields are optional and fall back to production defaults when omitted.
 * Exposed for testing: callers can inject a fake filesystem, custom paths,
 * or a pinned clock to make tests fully deterministic.
 */
export interface WorkspaceCleanupOptions {
  /** Root directory containing `{repoId}/{taskId}/` workspace trees. */
  readonly workspacesRoot?: string;
  /** Number of days to retain orphaned worktrees before deletion. */
  readonly retentionDays?: number;
  /** Current time — injected for deterministic testing. */
  readonly now?: Date;
  /** Filesystem operations — defaults to Node.js `fs`. */
  readonly fs?: CleanupFileSystem;
}

// ─── Result Types ──────────────────────────────────────────────────────────────

/**
 * Describes a single workspace directory that was evaluated during cleanup.
 */
export interface WorkspaceEntry {
  /** The repo-level directory name. */
  readonly repoId: string;
  /** The task-level directory name. */
  readonly taskId: string;
  /** Absolute path to the workspace directory. */
  readonly absolutePath: string;
  /** Last modification time of the workspace directory. */
  readonly mtime: Date;
}

/**
 * Describes an action taken (or skipped) for a single workspace.
 */
export interface WorkspaceCleanupAction {
  /** The evaluated workspace entry. */
  readonly entry: WorkspaceEntry;
  /** What happened to this workspace. */
  readonly outcome: "deleted" | "pending" | "active_lease" | "error";
  /** Days remaining until eligible for deletion (for "pending" outcomes). */
  readonly daysRemaining?: number;
  /** Approximate size in bytes freed (for "deleted" outcomes). */
  readonly freedBytes?: number;
  /** Error message (for "error" outcomes). */
  readonly errorMessage?: string;
}

/**
 * Summary of the entire workspace cleanup operation.
 */
export interface WorkspaceCleanupResult {
  /** Total number of workspace directories scanned. */
  readonly scannedCount: number;
  /** Number of worktrees deleted. */
  readonly deletedCount: number;
  /** Number of worktrees pending cleanup (within retention window). */
  readonly pendingCount: number;
  /** Number of worktrees skipped because they have active leases. */
  readonly activeLeaseCount: number;
  /** Number of worktrees that encountered errors during cleanup. */
  readonly errorCount: number;
  /** Approximate total bytes freed by deletions. */
  readonly totalFreedBytes: number;
  /** Per-workspace action details. */
  readonly actions: readonly WorkspaceCleanupAction[];
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Read the `WORKSPACES_ROOT` environment variable.
 *
 * Falls back to `./data/workspaces` (matching the infrastructure adapter
 * default) when the env var is not set.
 *
 * @returns Absolute or relative path to the workspaces root directory.
 * @see {@link file://apps/control-plane/src/automation/infrastructure-adapters.ts}
 */
function getWorkspacesRootFromEnv(): string {
  return process.env["WORKSPACES_ROOT"] ?? "./data/workspaces";
}

/**
 * Read the `WORKSPACE_RETENTION_DAYS` environment variable.
 *
 * Falls back to {@link DEFAULT_RETENTION_DAYS} when the env var is absent
 * or not a valid positive integer.
 *
 * @returns Number of days to retain orphaned worktrees.
 */
function getRetentionDaysFromEnv(): number {
  const envValue = process.env["WORKSPACE_RETENTION_DAYS"];
  if (envValue === undefined || envValue === "") {
    return DEFAULT_RETENTION_DAYS;
  }
  const parsed = parseInt(envValue, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return DEFAULT_RETENTION_DAYS;
  }
  return parsed;
}

/**
 * Estimate the total size of a directory tree in bytes.
 *
 * Walks the directory recursively, summing the `size` of each regular file.
 * Errors on individual entries are silently skipped — the estimate is
 * best-effort rather than exact.
 *
 * @param dirPath - Absolute path to the directory.
 * @param fs - Filesystem interface for testing.
 * @returns Approximate total size in bytes.
 */
function estimateDirectorySize(dirPath: string, fs: CleanupFileSystem): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += estimateDirectorySize(fullPath, fs);
        } else if (entry.isFile()) {
          total += fs.statSync(fullPath).size;
        }
      } catch {
        // Skip entries that can't be stat'd (e.g., broken symlinks).
      }
    }
  } catch {
    // Directory itself can't be read — return 0.
  }
  return total;
}

/**
 * Check whether a task has any non-terminal lease in the database.
 *
 * A task is considered "actively leased" if at least one lease exists with
 * a status that is NOT one of the terminal statuses (COMPLETING, RECLAIMED).
 * This includes leases in error states (TIMED_OUT, CRASHED) because those
 * may still be in the process of being reclaimed.
 *
 * @param conn - Database connection for the raw SQLite query.
 * @param taskId - The task identifier to check.
 * @returns `true` if any non-terminal lease exists.
 */
function hasActiveLeaseForTask(conn: DatabaseConnection, taskId: string): boolean {
  const placeholders = TERMINAL_LEASE_STATUSES.map(() => "?").join(", ");
  const row = conn.sqlite
    .prepare(
      `SELECT COUNT(*) as count FROM task_lease
       WHERE task_id = ?
       AND status NOT IN (${placeholders})`,
    )
    .get(taskId, ...TERMINAL_LEASE_STATUSES) as { count: number } | undefined;

  return (row?.count ?? 0) > 0;
}

/**
 * Scan the workspaces root for all `{repoId}/{taskId}/` directories.
 *
 * Iterates two levels deep: first listing repo directories, then listing
 * task directories within each repo. Only directories are considered;
 * regular files at either level are silently skipped.
 *
 * @param workspacesRoot - Absolute path to the workspaces root.
 * @param fs - Filesystem interface for testing.
 * @returns Flat list of workspace entries found on disk.
 */
function scanWorkspaceDirectories(workspacesRoot: string, fs: CleanupFileSystem): WorkspaceEntry[] {
  const entries: WorkspaceEntry[] = [];

  let repoDirs: Dirent[];
  try {
    repoDirs = fs.readdirSync(workspacesRoot, { withFileTypes: true });
  } catch {
    // Workspaces root doesn't exist or can't be read — nothing to scan.
    return entries;
  }

  for (const repoDir of repoDirs) {
    if (!repoDir.isDirectory()) {
      continue;
    }
    const repoPath = join(workspacesRoot, repoDir.name);

    let taskDirs: Dirent[];
    try {
      taskDirs = fs.readdirSync(repoPath, { withFileTypes: true });
    } catch {
      // Can't read this repo directory — skip it.
      continue;
    }

    for (const taskDir of taskDirs) {
      if (!taskDir.isDirectory()) {
        continue;
      }
      const absolutePath = join(repoPath, taskDir.name);
      try {
        const stats = fs.statSync(absolutePath);
        entries.push({
          repoId: repoDir.name,
          taskId: taskDir.name,
          absolutePath,
          mtime: new Date(stats.mtimeMs),
        });
      } catch {
        // Can't stat this directory — skip it.
      }
    }
  }

  return entries;
}

// ─── Service ───────────────────────────────────────────────────────────────────

/**
 * Cleans orphaned worktrees on application startup.
 *
 * Implements {@link OnApplicationBootstrap} so the cleanup runs after all
 * NestJS modules (including DatabaseModule) are fully initialized, but
 * before the server starts listening. This ensures the database is available
 * for lease lookups and that the cleanup happens early in the startup
 * sequence.
 *
 * The service is deliberately conservative:
 * - Any worktree with a non-terminal lease is preserved.
 * - Any worktree within the retention period is preserved.
 * - Errors on individual directories are isolated and logged.
 * - A complete failure of the cleanup never prevents the app from starting.
 */
@Injectable()
export class WorkspaceCleanupService implements OnApplicationBootstrap {
  private readonly logger: Logger = createLogger("workspace-cleanup");

  /** Injected database connection for lease queries. */
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection) {}

  /**
   * NestJS lifecycle hook — called after all modules are initialized.
   *
   * Runs the workspace cleanup and logs a summary. Errors are caught and
   * logged rather than propagated, ensuring that a cleanup failure never
   * prevents the application from starting.
   */
  onApplicationBootstrap(): void {
    try {
      const result = this.cleanOrphanedWorkspaces();
      this.logCleanupSummary(result);
    } catch (error: unknown) {
      this.logger.warn("Workspace cleanup scan failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Scan workspace directories and clean up orphaned worktrees.
   *
   * For each `{repoId}/{taskId}/` directory under the workspaces root:
   * 1. Queries the database for non-terminal leases for the task.
   * 2. If an active lease exists → skip (preserve the worktree).
   * 3. If no active lease and mtime exceeds retention → delete.
   * 4. If no active lease and mtime within retention → log as pending.
   *
   * @param options - Override defaults for testing. All fields optional.
   * @returns Summary of all cleanup actions taken.
   */
  cleanOrphanedWorkspaces(options?: WorkspaceCleanupOptions): WorkspaceCleanupResult {
    const fs = options?.fs ?? NODE_FS;
    const workspacesRoot = options?.workspacesRoot ?? getWorkspacesRootFromEnv();
    const retentionDays = options?.retentionDays ?? getRetentionDaysFromEnv();
    const now = options?.now ?? new Date();

    const retentionMs = retentionDays * MS_PER_DAY;
    const actions: WorkspaceCleanupAction[] = [];

    // Bail early if the workspaces root doesn't exist.
    if (!fs.existsSync(workspacesRoot)) {
      return {
        scannedCount: 0,
        deletedCount: 0,
        pendingCount: 0,
        activeLeaseCount: 0,
        errorCount: 0,
        totalFreedBytes: 0,
        actions: [],
      };
    }

    // Scan all workspace directories on disk.
    const entries = scanWorkspaceDirectories(workspacesRoot, fs);

    for (const entry of entries) {
      try {
        // Check if the task has any active (non-terminal) lease.
        if (hasActiveLeaseForTask(this.conn, entry.taskId)) {
          actions.push({ entry, outcome: "active_lease" });
          continue;
        }

        // No active lease — check the retention period.
        const ageMs = now.getTime() - entry.mtime.getTime();

        if (ageMs >= retentionMs) {
          // Older than retention → estimate size, then delete.
          const freedBytes = estimateDirectorySize(entry.absolutePath, fs);
          fs.rmSync(entry.absolutePath, { recursive: true, force: true });
          actions.push({ entry, outcome: "deleted", freedBytes });
        } else {
          // Within retention → log as pending cleanup.
          const daysRemaining = Math.ceil((retentionMs - ageMs) / MS_PER_DAY);
          actions.push({ entry, outcome: "pending", daysRemaining });
        }
      } catch (error: unknown) {
        actions.push({
          entry,
          outcome: "error",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Clean up empty repo-level directories left behind after deletions.
    this.cleanEmptyRepoDirectories(workspacesRoot, fs);

    // Compute summary counts.
    const deletedCount = actions.filter((a) => a.outcome === "deleted").length;
    const pendingCount = actions.filter((a) => a.outcome === "pending").length;
    const activeLeaseCount = actions.filter((a) => a.outcome === "active_lease").length;
    const errorCount = actions.filter((a) => a.outcome === "error").length;
    const totalFreedBytes = actions
      .filter((a) => a.outcome === "deleted")
      .reduce((sum, a) => sum + (a.freedBytes ?? 0), 0);

    return {
      scannedCount: entries.length,
      deletedCount,
      pendingCount,
      activeLeaseCount,
      errorCount,
      totalFreedBytes,
      actions,
    };
  }

  /**
   * Remove repo-level directories that are now empty after workspace deletions.
   *
   * After deleting orphaned task directories, the parent `{repoId}/` directory
   * may be empty. This method scans the workspaces root and removes any empty
   * repo directories to keep the filesystem tidy.
   */
  private cleanEmptyRepoDirectories(workspacesRoot: string, fs: CleanupFileSystem): void {
    try {
      const repoDirs = fs.readdirSync(workspacesRoot, { withFileTypes: true });
      for (const repoDir of repoDirs) {
        if (!repoDir.isDirectory()) {
          continue;
        }
        const repoPath = join(workspacesRoot, repoDir.name);
        try {
          const contents = fs.readdirSync(repoPath, { withFileTypes: true });
          if (contents.length === 0) {
            fs.rmSync(repoPath, { recursive: true, force: true });
          }
        } catch {
          // Ignore errors when checking/removing empty directories.
        }
      }
    } catch {
      // Ignore errors scanning the root — not critical.
    }
  }

  /**
   * Log a structured summary of the cleanup operation.
   *
   * Uses INFO level for clean/successful runs and WARN level when errors
   * occurred during cleanup. Individual pending worktrees are logged at
   * DEBUG level to avoid cluttering the startup output.
   */
  private logCleanupSummary(result: WorkspaceCleanupResult): void {
    if (result.scannedCount === 0) {
      this.logger.info("Workspace cleanup: no worktrees found");
      return;
    }

    // Log pending worktrees individually at info level.
    for (const action of result.actions) {
      if (action.outcome === "pending") {
        this.logger.info(
          `Orphaned worktree pending cleanup in ${String(action.daysRemaining)} day(s): ` +
            `${action.entry.repoId}/${action.entry.taskId}`,
        );
      }
    }

    // Log errors individually at warn level.
    for (const action of result.actions) {
      if (action.outcome === "error") {
        this.logger.warn(
          `Failed to clean worktree ${action.entry.repoId}/${action.entry.taskId}: ` +
            `${action.errorMessage ?? "unknown error"}`,
        );
      }
    }

    const freedMb = (result.totalFreedBytes / (1024 * 1024)).toFixed(1);
    const summary =
      `Workspace cleanup complete: scanned ${String(result.scannedCount)}, ` +
      `deleted ${String(result.deletedCount)} (freed ~${freedMb} MB), ` +
      `pending ${String(result.pendingCount)}, ` +
      `active ${String(result.activeLeaseCount)}, ` +
      `errors ${String(result.errorCount)}`;

    if (result.errorCount > 0) {
      this.logger.warn(summary);
    } else {
      this.logger.info(summary);
    }
  }
}
