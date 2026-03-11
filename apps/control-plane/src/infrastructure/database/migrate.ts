/**
 * Programmatic migration runner for the control-plane database.
 *
 * Provides a function to apply pending Drizzle ORM migrations against a
 * SQLite database. Used both by the `db:migrate` CLI script and for
 * programmatic migration during application startup.
 *
 * @module
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Configuration for the programmatic migration runner. */
export interface MigrateConfig {
  /** Absolute or relative path to the SQLite database file. */
  readonly dbPath: string;

  /**
   * Path to the directory containing Drizzle migration SQL files.
   * This is the `out` directory configured in `drizzle.config.ts`.
   */
  readonly migrationsFolder: string;
}

/**
 * Apply all pending migrations to the SQLite database.
 *
 * Opens a temporary connection with WAL mode and foreign keys enabled,
 * runs all unapplied migrations in order, then closes the connection.
 * The parent directory of the database file is created if it does not exist.
 *
 * @param config - Migration configuration with DB path and migrations folder.
 * @throws If any migration fails to apply.
 *
 * @example
 * ```typescript
 * runMigrations({
 *   dbPath: './data/factory.db',
 *   migrationsFolder: './drizzle',
 * });
 * ```
 */
export function runMigrations(config: MigrateConfig): void {
  const filePath = resolve(config.dbPath);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite);

  try {
    migrate(db, { migrationsFolder: resolve(config.migrationsFolder) });
  } finally {
    sqlite.close();
  }
}
