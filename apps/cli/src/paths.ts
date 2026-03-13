/**
 * Global data directory path resolution for the Autonomous Software Factory.
 *
 * This module centralizes all path resolution for the factory's global data
 * directory. The default location is `~/.copilot-factory/`, overridable via
 * the `FACTORY_HOME` environment variable.
 *
 * Every service that needs to locate factory data (database, worktrees,
 * artifacts, migrations) should use these helpers to ensure consistent
 * path resolution across the CLI, control plane, and worker runtime.
 *
 * @module paths
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Default directory name under the user's home directory. */
const DEFAULT_DIR_NAME = ".copilot-factory";

/**
 * Subdirectories created by {@link ensureFactoryHome} inside the factory
 * home directory.
 */
const SUBDIRS = ["workspaces", "artifacts"] as const;

/**
 * Returns the absolute path to the factory's global data directory.
 *
 * Resolution order:
 * 1. `FACTORY_HOME` environment variable (if set and non-empty)
 * 2. `~/.copilot-factory/` (using `os.homedir()` for cross-platform support)
 *
 * @returns Absolute path to the factory home directory.
 */
export function getFactoryHome(): string {
  const envHome = process.env["FACTORY_HOME"];
  if (envHome) {
    return envHome;
  }
  return join(homedir(), DEFAULT_DIR_NAME);
}

/**
 * Returns the absolute path to the factory's SQLite database file.
 *
 * @returns `{factoryHome}/factory.db`
 */
export function getDbPath(): string {
  return join(getFactoryHome(), "factory.db");
}

/**
 * Returns the absolute path to the root directory for git worktrees.
 *
 * Each task gets an isolated worktree under this directory, following
 * the layout `{workspacesRoot}/{repoId}/{taskId}/`.
 *
 * @returns `{factoryHome}/workspaces/`
 */
export function getWorkspacesRoot(): string {
  return join(getFactoryHome(), "workspaces");
}

/**
 * Returns the absolute path to the root directory for task artifacts.
 *
 * Artifacts include packets, run logs, review results, and merge
 * outputs, stored in the structure defined by §7.11 of the technical
 * architecture.
 *
 * @returns `{factoryHome}/artifacts/`
 */
export function getArtifactsRoot(): string {
  return join(getFactoryHome(), "artifacts");
}

/**
 * Returns the absolute path to the Drizzle migration files directory.
 *
 * When running from the installed CLI package, migrations are resolved
 * relative to this module's location inside the package. The path points
 * to the directory containing SQL migration files and the Drizzle journal.
 *
 * @returns `{factoryHome}/drizzle/`
 */
export function getMigrationsDir(): string {
  return join(getFactoryHome(), "drizzle");
}

/**
 * Creates the factory home directory and all standard subdirectories
 * if they do not already exist.
 *
 * This function is idempotent — calling it multiple times is safe and
 * will not modify existing directories or their contents.
 *
 * Created structure:
 * ```
 * {factoryHome}/
 * ├── workspaces/
 * └── artifacts/
 * ```
 *
 * The database file and drizzle directory are created on demand by
 * their respective consumers (better-sqlite3 and drizzle-kit).
 */
export function ensureFactoryHome(): void {
  const home = getFactoryHome();

  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true });
  }

  for (const subdir of SUBDIRS) {
    const fullPath = join(home, subdir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
    }
  }
}
