/**
 * Programmatic Drizzle ORM migration runner for the factory database.
 *
 * Runs all pending Drizzle migrations against a SQLite database, creating
 * the database file and parent directories if they don't exist. This module
 * is consumed by both `factory init` (first-time setup) and `factory start`
 * (apply any pending migrations before starting the server).
 *
 * Drizzle's `migrate()` function is inherently idempotent — it reads the
 * `__drizzle_migrations` journal table to determine which migrations have
 * already been applied and only runs new ones.
 *
 * @see {@link file://docs/backlog/tasks/T141-programmatic-migrations.md} for task context
 * @module
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Result of a migration run describing what happened.
 */
export interface MigrationResult {
  /**
   * Number of new migrations applied during this run.
   * Zero when the database was already up to date.
   */
  readonly applied: number;

  /**
   * `true` when no new migrations were needed — the database schema
   * was already at the latest version.
   */
  readonly alreadyUpToDate: boolean;
}

/**
 * Error thrown when a migration run fails due to an infrastructure or
 * schema problem. Wraps the underlying error with additional context
 * about the database path and migrations folder.
 */
export class MigrationError extends Error {
  /** The database path that was being migrated. */
  readonly dbPath: string;

  /** The migrations folder that was being read. */
  readonly migrationsFolder: string;

  /** The underlying error that caused the failure. */
  override readonly cause: unknown;

  constructor(message: string, dbPath: string, migrationsFolder: string, cause: unknown) {
    super(message);
    this.name = "MigrationError";
    this.dbPath = dbPath;
    this.migrationsFolder = migrationsFolder;
    this.cause = cause;
  }
}

/**
 * Counts the number of rows in the `__drizzle_migrations` journal table.
 *
 * Returns 0 if the table doesn't exist (first-run scenario before Drizzle
 * has created its journal).
 *
 * @param sqlite - An open better-sqlite3 database connection.
 * @returns The number of migration records in the journal.
 */
function countAppliedMigrations(sqlite: Database.Database): number {
  try {
    const row = sqlite.prepare("SELECT count(*) as count FROM __drizzle_migrations").get() as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  } catch {
    // Table doesn't exist yet — first run
    return 0;
  }
}

/**
 * Run all pending Drizzle ORM migrations against the given SQLite database.
 *
 * This function:
 * 1. Creates the database file's parent directory if it doesn't exist.
 * 2. Opens (or creates) the SQLite database with WAL mode and foreign keys.
 * 3. Applies any pending migrations from the specified folder.
 * 4. Reports how many migrations were newly applied.
 *
 * The database connection is always closed when the function returns,
 * whether it succeeds or throws.
 *
 * @param dbPath - Absolute path to the SQLite database file. Created if
 *   it doesn't exist. Parent directories are created recursively.
 * @param migrationsFolder - Absolute path to the directory containing
 *   Drizzle migration SQL files and the `meta/` journal directory.
 * @returns A {@link MigrationResult} describing what happened.
 * @throws {MigrationError} If the migration run fails for any reason
 *   (corrupt database, invalid migrations, permission denied, etc.).
 *
 * @example
 * ```typescript
 * import { runMigrations } from "./migrate.js";
 * import { getDbPath, getMigrationsDir } from "./paths.js";
 *
 * const result = await runMigrations(getDbPath(), getMigrationsDir());
 * if (result.alreadyUpToDate) {
 *   console.log("Database schema is up to date.");
 * } else {
 *   console.log(`Applied ${result.applied} migration(s).`);
 * }
 * ```
 */
export async function runMigrations(
  dbPath: string,
  migrationsFolder: string,
): Promise<MigrationResult> {
  if (!existsSync(migrationsFolder)) {
    throw new MigrationError(
      `Migrations folder does not exist: ${migrationsFolder}`,
      dbPath,
      migrationsFolder,
      new Error(`ENOENT: no such file or directory '${migrationsFolder}'`),
    );
  }

  // Ensure the parent directory of the database file exists so that
  // better-sqlite3 can create the .db file on first run.
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let sqlite: Database.Database | undefined;

  try {
    sqlite = new Database(dbPath);

    // Apply the same pragmas used by the control-plane connection factory
    // to ensure consistent database behaviour. See connection.ts.
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("foreign_keys = ON");

    const db = drizzle(sqlite);

    const countBefore = countAppliedMigrations(sqlite);
    migrate(db, { migrationsFolder });
    const countAfter = countAppliedMigrations(sqlite);

    const applied = countAfter - countBefore;

    return {
      applied,
      alreadyUpToDate: applied === 0,
    };
  } catch (error) {
    // If the error is already a MigrationError, re-throw as-is
    if (error instanceof MigrationError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new MigrationError(`Migration failed: ${message}`, dbPath, migrationsFolder, error);
  } finally {
    sqlite?.close();
  }
}
