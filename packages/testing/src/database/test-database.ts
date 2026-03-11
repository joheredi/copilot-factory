/**
 * In-memory SQLite test database setup and teardown.
 *
 * Provides a fast, isolated database for integration tests by creating
 * an in-memory SQLite instance and running Drizzle migrations against it.
 * Each test gets a fresh database with the full schema applied, ensuring
 * complete isolation between test cases.
 *
 * Uses the same WAL mode, foreign key enforcement, and write transaction
 * semantics as production to catch schema and constraint issues early.
 *
 * @module @factory/testing/database/test-database
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

/**
 * A test database connection with Drizzle ORM integration.
 *
 * Mirrors the production {@link DatabaseConnection} interface from the
 * control-plane, ensuring tests exercise the same code paths as production.
 */
export interface TestDatabaseConnection {
  /** Drizzle ORM query builder for type-safe SQL operations. */
  readonly db: BetterSQLite3Database;

  /** Underlying better-sqlite3 driver for raw SQL and pragma access. */
  readonly sqlite: Database.Database;

  /**
   * Close the database connection and release all resources.
   * Call this in `afterEach` or `afterAll` hooks to prevent resource leaks.
   */
  close(): void;

  /**
   * Execute a synchronous callback within a write transaction using
   * `BEGIN IMMEDIATE`, matching production locking semantics.
   *
   * @param fn - Synchronous function receiving the Drizzle db instance.
   * @returns The value returned by `fn`.
   * @throws Re-throws any error from `fn` after automatically rolling back.
   */
  writeTransaction<T>(fn: (db: BetterSQLite3Database) => T): T;
}

/**
 * Configuration for creating a test database.
 */
export interface TestDatabaseConfig {
  /**
   * Path to the directory containing Drizzle migration SQL files.
   * Typically `"apps/control-plane/drizzle"` relative to the repo root,
   * or an absolute path.
   */
  readonly migrationsFolder: string;

  /**
   * Enable foreign key constraint enforcement. Default: true.
   * Set to false only when testing specific FK violation scenarios.
   */
  readonly foreignKeys?: boolean;
}

/**
 * Create a fresh in-memory SQLite database with all migrations applied.
 *
 * Each call produces an isolated database instance — no state bleeds
 * between test cases. The database uses WAL mode and foreign key enforcement
 * to match production behavior.
 *
 * @param config - Database configuration with migrations folder path.
 * @returns A fully configured test database connection.
 *
 * @example
 * ```ts
 * import { createTestDatabase } from "@factory/testing";
 *
 * let db: TestDatabaseConnection;
 *
 * beforeEach(() => {
 *   db = createTestDatabase({
 *     migrationsFolder: "apps/control-plane/drizzle",
 *   });
 * });
 *
 * afterEach(() => {
 *   db.close();
 * });
 * ```
 */
export function createTestDatabase(config: TestDatabaseConfig): TestDatabaseConnection {
  const sqlite = new Database(":memory:");

  // Match production pragmas for consistent behavior
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");

  const foreignKeys = config.foreignKeys ?? true;
  sqlite.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);

  const db = drizzle(sqlite);

  // Apply all migrations to bring the schema up to date
  migrate(db, { migrationsFolder: config.migrationsFolder });

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

    writeTransaction<T>(fn: (db: BetterSQLite3Database) => T): T {
      const runner = sqlite.transaction(() => fn(db));
      return runner.immediate() as T;
    },
  };
}
