import { describe, it, expect } from "vitest";
import { resolve } from "node:path";

import { createTestDatabase } from "./test-database.js";

/**
 * Tests for the in-memory test database helper.
 *
 * The test database is the foundation for all integration tests that
 * exercise repository implementations, transaction semantics, and
 * migration correctness. If this helper is broken, integration tests
 * produce false positives/negatives.
 */

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, "../../../../apps/control-plane/drizzle");

describe("createTestDatabase", () => {
  /**
   * Validates that an in-memory database is created and migrations applied.
   * A successful SELECT 1 confirms the connection is alive.
   */
  it("creates an in-memory database with migrations", () => {
    const conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    try {
      const result = conn.sqlite.prepare("SELECT 1 as value").get() as { value: number };
      expect(result.value).toBe(1);
    } finally {
      conn.close();
    }
  });

  /**
   * Validates that the schema includes expected tables from migrations.
   * This catches migration file path issues early.
   */
  it("has expected tables from migrations", () => {
    const conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    try {
      const tables = conn.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '%drizzle%' ORDER BY name",
        )
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain("project");
      expect(tableNames).toContain("task");
      expect(tableNames).toContain("worker_pool");
      expect(tableNames).toContain("task_lease");
      expect(tableNames).toContain("audit_event");
    } finally {
      conn.close();
    }
  });

  /**
   * Validates foreign key enforcement is enabled by default.
   * Without FK enforcement, referential integrity bugs slip through.
   */
  it("enforces foreign keys by default", () => {
    const conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    try {
      const fk = conn.sqlite.pragma("foreign_keys", { simple: true }) as number;
      expect(fk).toBe(1);
    } finally {
      conn.close();
    }
  });

  /**
   * Validates that each createTestDatabase call produces an isolated instance.
   * Data inserted in one connection must not appear in another.
   */
  it("creates isolated instances", () => {
    const conn1 = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const conn2 = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    try {
      // Insert data via raw sqlite in conn1
      conn1.sqlite
        .prepare("INSERT INTO project (project_id, name, owner) VALUES (?, ?, ?)")
        .run("iso-test-id", "iso-test-name", "iso-owner");

      const count1 = conn1.sqlite.prepare("SELECT count(*) as cnt FROM project").get() as {
        cnt: number;
      };
      const count2 = conn2.sqlite.prepare("SELECT count(*) as cnt FROM project").get() as {
        cnt: number;
      };

      expect(count1.cnt).toBe(1);
      expect(count2.cnt).toBe(0);
    } finally {
      conn1.close();
      conn2.close();
    }
  });

  /**
   * Validates writeTransaction with BEGIN IMMEDIATE semantics.
   */
  it("supports writeTransaction", () => {
    const conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    try {
      conn.writeTransaction(() => {
        conn.sqlite
          .prepare("INSERT INTO project (project_id, name, owner) VALUES (?, ?, ?)")
          .run("txn-test", "txn-project", "txn-owner");
      });

      const result = conn.sqlite
        .prepare("SELECT name FROM project WHERE project_id = ?")
        .get("txn-test") as { name: string } | undefined;
      expect(result?.name).toBe("txn-project");
    } finally {
      conn.close();
    }
  });

  /**
   * Validates that FK enforcement can be disabled for specific test scenarios.
   */
  it("allows disabling foreign keys", () => {
    const conn = createTestDatabase({
      migrationsFolder: MIGRATIONS_FOLDER,
      foreignKeys: false,
    });
    try {
      const fk = conn.sqlite.pragma("foreign_keys", { simple: true }) as number;
      expect(fk).toBe(0);
    } finally {
      conn.close();
    }
  });
});
