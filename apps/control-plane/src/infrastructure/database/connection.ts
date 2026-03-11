/**
 * SQLite database connection factory for the control-plane service.
 *
 * Creates configured better-sqlite3 connections with Drizzle ORM integration,
 * WAL journal mode, and production-ready SQLite pragmas. All write operations
 * should use {@link DatabaseConnection.writeTransaction} to ensure BEGIN
 * IMMEDIATE locking semantics.
 *
 * @module
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Configuration for creating a SQLite database connection.
 * All boolean options default to `true` for production-ready behavior.
 */
export interface DatabaseConfig {
  /** Absolute or relative path to the SQLite database file. */
  readonly filePath: string;

  /**
   * Enable WAL (Write-Ahead Logging) journal mode.
   * WAL allows concurrent reads during writes and improves throughput.
   * @default true
   */
  readonly walMode?: boolean;

  /**
   * Milliseconds to wait when the database is locked before returning
   * SQLITE_BUSY.
   * @default 5000
   */
  readonly busyTimeout?: number;

  /**
   * Enable SQLite foreign key constraint enforcement.
   * Foreign keys are OFF by default in SQLite; enabling ensures referential
   * integrity across all tables.
   * @default true
   */
  readonly foreignKeys?: boolean;
}

/** Result of a database health check query. */
export interface HealthCheckResult {
  /** Whether the database responded to a SELECT 1 query. */
  readonly ok: boolean;
  /** Whether WAL journal mode is currently active. */
  readonly walMode: boolean;
  /** Whether foreign key enforcement is currently enabled. */
  readonly foreignKeys: boolean;
}

/**
 * A managed SQLite database connection combining Drizzle ORM with direct
 * better-sqlite3 access for pragma control and explicit transaction
 * management.
 */
export interface DatabaseConnection {
  /** Drizzle ORM query builder for type-safe SQL operations. */
  readonly db: BetterSQLite3Database;

  /** Underlying better-sqlite3 driver for raw SQL and pragma access. */
  readonly sqlite: Database.Database;

  /**
   * Close the database connection and release all resources.
   * After calling close(), no further operations should be performed.
   */
  close(): void;

  /**
   * Verify that the database is reachable and correctly configured.
   * Runs a `SELECT 1` probe and checks current pragma values.
   *
   * @throws If the database is unreachable or closed.
   */
  healthCheck(): HealthCheckResult;

  /**
   * Execute a synchronous callback within a write transaction using
   * `BEGIN IMMEDIATE`.
   *
   * IMMEDIATE acquires a reserved (write) lock at the start of the
   * transaction rather than deferring until the first write statement.
   * This prevents `SQLITE_BUSY` errors that occur when a deferred
   * transaction tries to promote from a shared read lock to a reserved
   * write lock while another connection holds a conflicting lock.
   *
   * All write operations in the control-plane should use this method.
   *
   * @param fn - Synchronous function receiving the Drizzle db instance.
   *   All Drizzle queries inside `fn` execute within the IMMEDIATE
   *   transaction.
   * @returns The value returned by `fn`.
   * @throws Re-throws any error from `fn` after automatically rolling back.
   *
   * @see https://www.sqlite.org/lang_transaction.html
   */
  writeTransaction<T>(fn: (db: BetterSQLite3Database) => T): T;
}

/**
 * Default configuration values for SQLite pragmas.
 * These represent production-ready defaults for a local-first application.
 */
const DEFAULTS = {
  walMode: true,
  busyTimeout: 5000,
  foreignKeys: true,
} as const;

/**
 * Create a configured SQLite database connection with production-ready
 * defaults.
 *
 * Applies the following SQLite pragmas:
 * - `journal_mode = WAL` — Write-Ahead Logging for concurrent reads
 * - `busy_timeout = 5000` — wait up to 5 s when the database is locked
 * - `foreign_keys = ON` — enforce foreign key referential integrity
 *
 * The parent directory of the database file is created automatically if it
 * does not exist.
 *
 * @param config - Database connection configuration.
 * @returns A fully configured {@link DatabaseConnection} ready for use.
 *
 * @example
 * ```typescript
 * const conn = createDatabaseConnection({ filePath: './data/factory.db' });
 * const health = conn.healthCheck();
 * console.log(health); // { ok: true, walMode: true, foreignKeys: true }
 *
 * conn.writeTransaction((db) => {
 *   db.run(sql`INSERT INTO tasks (title) VALUES ('my task')`);
 * });
 *
 * conn.close();
 * ```
 */
export function createDatabaseConnection(
  config: DatabaseConfig,
): DatabaseConnection {
  const filePath = resolve(config.filePath);

  // Ensure the parent directory exists so better-sqlite3 can create the file
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(filePath);

  // Apply SQLite pragmas for production-ready behavior.
  // Pragma order matters: journal_mode should be set first.
  const walMode = config.walMode ?? DEFAULTS.walMode;
  if (walMode) {
    sqlite.pragma("journal_mode = WAL");
  }

  const busyTimeout = config.busyTimeout ?? DEFAULTS.busyTimeout;
  sqlite.pragma(`busy_timeout = ${String(busyTimeout)}`);

  const foreignKeys = config.foreignKeys ?? DEFAULTS.foreignKeys;
  // Explicitly set foreign_keys in all cases — SQLite's compile-time default
  // may vary across builds, so always be explicit.
  sqlite.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);


  const db = drizzle(sqlite);

  return {
    get db() {
      return db;
    },
    get sqlite() {
      return sqlite;
    },

    close(): void {
      sqlite.close();
    },

    healthCheck(): HealthCheckResult {
      const currentJournalMode = sqlite.pragma("journal_mode", {
        simple: true,
      }) as string;
      const currentForeignKeys = sqlite.pragma("foreign_keys", {
        simple: true,
      }) as number;

      // Probe: execute a trivial query to verify the connection is alive
      sqlite.prepare("SELECT 1").get();

      return {
        ok: true,
        walMode: currentJournalMode === "wal",
        foreignKeys: currentForeignKeys === 1,
      };
    },

    writeTransaction<T>(fn: (db: BetterSQLite3Database) => T): T {
      // Use better-sqlite3's native transaction API which handles
      // BEGIN/COMMIT/ROLLBACK automatically, including proper cleanup
      // when the inner function throws. The .immediate() variant issues
      // BEGIN IMMEDIATE instead of the default BEGIN DEFERRED.
      const runner = sqlite.transaction(() => fn(db));
      return runner.immediate() as T;
    },
  };
}
