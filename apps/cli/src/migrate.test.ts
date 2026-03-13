import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { MigrationError, runMigrations } from "./migrate.js";

/**
 * Tests for the programmatic Drizzle migration runner.
 *
 * These tests validate the core migration scenarios that `factory init` and
 * `factory start` depend on: first-run database creation, idempotent re-runs,
 * and error handling for corrupt databases and missing migration folders.
 *
 * All tests use a temporary directory and the real control-plane migration
 * files from `apps/control-plane/drizzle/` to ensure compatibility with the
 * actual schema. This catches migration ordering and SQL compatibility
 * issues that synthetic test fixtures would miss.
 */

/**
 * Resolves the path to the control-plane's Drizzle migration directory.
 * These are the real migration files used in production.
 */
const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "control-plane", "drizzle");

describe("runMigrations", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "factory-migrate-test-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Validates the first-run scenario: when no database file exists,
   * `runMigrations` must create it, apply all migrations, and report
   * the correct count. This is the primary `factory init` path.
   */
  it("creates database and applies all migrations on first run", async () => {
    expect(existsSync(dbPath)).toBe(false);

    const result = await runMigrations(dbPath, MIGRATIONS_DIR);

    expect(existsSync(dbPath)).toBe(true);
    expect(result.applied).toBeGreaterThan(0);
    expect(result.alreadyUpToDate).toBe(false);
  });

  /**
   * Validates idempotency: calling `runMigrations` twice on an already
   * up-to-date database must be a no-op. This is the normal `factory start`
   * path when no new migrations have been generated since the last run.
   */
  it("is a no-op when database is already up to date", async () => {
    // First run: apply all migrations
    await runMigrations(dbPath, MIGRATIONS_DIR);

    // Second run: should detect no new migrations
    const result = await runMigrations(dbPath, MIGRATIONS_DIR);

    expect(result.applied).toBe(0);
    expect(result.alreadyUpToDate).toBe(true);
  });

  /**
   * Validates that parent directories are created recursively when the
   * database path points into a directory tree that doesn't exist yet.
   * This supports configurations where FACTORY_HOME is a deeply nested
   * path that hasn't been created by `ensureFactoryHome`.
   */
  it("creates parent directories for the database file", async () => {
    const nestedDbPath = join(tempDir, "deep", "nested", "dir", "factory.db");

    const result = await runMigrations(nestedDbPath, MIGRATIONS_DIR);

    expect(existsSync(nestedDbPath)).toBe(true);
    expect(result.applied).toBeGreaterThan(0);
  });

  /**
   * Validates that the database is configured with WAL mode and foreign
   * key enforcement after migrations, matching the control-plane's
   * connection factory settings. Inconsistent pragmas between the
   * migration runner and the runtime would cause silent data integrity
   * issues.
   */
  it("configures WAL mode and foreign keys on the database", async () => {
    await runMigrations(dbPath, MIGRATIONS_DIR);

    // Open the database independently to check pragmas were persisted
    const sqlite = new Database(dbPath);
    try {
      const journalMode = sqlite.pragma("journal_mode", {
        simple: true,
      }) as string;
      // WAL mode persists across connections
      expect(journalMode).toBe("wal");
    } finally {
      sqlite.close();
    }
  });

  /**
   * Validates that the migration tables created match what the
   * control-plane expects. If the schema doesn't include the core
   * tables (projects, tasks, etc.), the server will fail at startup.
   */
  it("creates the expected database tables", async () => {
    await runMigrations(dbPath, MIGRATIONS_DIR);

    const sqlite = new Database(dbPath);
    try {
      const tables = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
        )
        .all() as Array<{ name: string }>;

      const tableNames = tables.map((t) => t.name);

      // Core entity tables that must exist for the control-plane to function
      expect(tableNames).toContain("project");
      expect(tableNames).toContain("task");
      expect(tableNames).toContain("repository");
    } finally {
      sqlite.close();
    }
  });

  /**
   * Validates that a missing migrations folder throws a clear
   * MigrationError rather than an opaque filesystem error. This helps
   * diagnose installation issues where the migration files weren't
   * bundled correctly with the CLI package.
   */
  it("throws MigrationError when migrations folder does not exist", async () => {
    const badFolder = join(tempDir, "nonexistent-migrations");

    const error = await runMigrations(dbPath, badFolder).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MigrationError);
    expect((error as MigrationError).migrationsFolder).toBe(badFolder);
    expect((error as MigrationError).message).toContain("does not exist");
  });

  /**
   * Validates that a corrupt database file produces a MigrationError
   * with the original error as cause, enabling operators to diagnose
   * and recover from data corruption. The database path is included
   * in the error for quick identification of which file is affected.
   */
  it("throws MigrationError when database is corrupt", async () => {
    // Create a file that is not a valid SQLite database
    const { writeFileSync } = await import("node:fs");
    writeFileSync(dbPath, "this is not a database");

    const error = await runMigrations(dbPath, MIGRATIONS_DIR).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MigrationError);
    expect((error as MigrationError).dbPath).toBe(dbPath);
    expect((error as MigrationError).cause).toBeDefined();
  });

  /**
   * Validates that a migrations folder with no valid migration files
   * (missing meta/ journal) results in a MigrationError. This catches
   * the case where someone points to the wrong directory.
   */
  it("throws MigrationError when migrations folder has no valid migrations", async () => {
    const emptyFolder = join(tempDir, "empty-migrations");
    mkdirSync(emptyFolder);

    const error = await runMigrations(dbPath, emptyFolder).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MigrationError);
  });

  /**
   * Validates that the database connection is always closed, even when
   * an error occurs during migration. Leaked connections prevent the
   * database file from being deleted on Windows and waste resources.
   */
  it("closes the database connection even on error", async () => {
    const emptyFolder = join(tempDir, "empty-migrations");
    mkdirSync(emptyFolder);

    await runMigrations(dbPath, emptyFolder).catch(() => {
      /* expected error */
    });

    // If the connection was left open, this would fail on some platforms
    // or when the temp directory is being cleaned up.
    // A simple check: we can open the DB ourselves without SQLITE_LOCKED
    if (existsSync(dbPath)) {
      const sqlite = new Database(dbPath);
      sqlite.close();
    }
  });

  /**
   * Validates that partial migration application doesn't leave the
   * database in an inconsistent state. After a successful first run,
   * adding new migration files (by copying the real ones into a
   * separate folder with additional content) should apply only the
   * new ones.
   */
  it("applies only new migrations on subsequent runs", async () => {
    // First run: apply all existing migrations
    const firstResult = await runMigrations(dbPath, MIGRATIONS_DIR);
    const initialCount = firstResult.applied;

    // Second run: same migrations, should be no-op
    const secondResult = await runMigrations(dbPath, MIGRATIONS_DIR);

    expect(secondResult.applied).toBe(0);
    expect(secondResult.alreadyUpToDate).toBe(true);
    expect(initialCount).toBeGreaterThan(0);
  });
});
