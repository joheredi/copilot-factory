/**
 * Tests for the policies service.
 *
 * Verifies policy set CRUD operations using an in-memory SQLite
 * database with Drizzle migrations applied. Tests validate list
 * pagination, single retrieval, and partial updates.
 *
 * @module @factory/control-plane
 */
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { PoliciesService } from "./policies.service.js";
import { createPolicySetRepository } from "../infrastructure/repositories/policy-set.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

/** Path to Drizzle migration files. */
const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

/** Create an in-memory test database with all migrations applied. */
function createTestConnection(): DatabaseConnection {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return {
    db,
    sqlite,
    close: () => sqlite.close(),
    healthCheck: () => ({ ok: true, walMode: true, foreignKeys: true }),
    writeTransaction: <T>(fn: (d: typeof db) => T): T => {
      const runner = sqlite.transaction(() => fn(db));
      return runner.immediate() as T;
    },
  };
}

/** Insert a test policy set with sensible defaults. */
function seedPolicySet(db: ReturnType<typeof drizzle>, overrides: Record<string, unknown> = {}) {
  const repo = createPolicySetRepository(db);
  return repo.create({
    policySetId: randomUUID(),
    name: "default",
    version: "1.0.0",
    ...overrides,
  });
}

describe("PoliciesService", () => {
  let conn: DatabaseConnection;
  let service: PoliciesService;

  beforeEach(() => {
    conn = createTestConnection();
    service = new PoliciesService(conn);
  });

  /**
   * Validates that findAll returns an empty paginated result when there
   * are no policy sets. This is the baseline case.
   */
  it("should return empty results when no policy sets exist", () => {
    const result = service.findAll(1, 20);

    expect(result.data).toEqual([]);
    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  /**
   * Validates that findAll returns all policy sets with correct
   * pagination metadata.
   */
  it("should list policy sets with pagination", () => {
    seedPolicySet(conn.db, { name: "policy-1" });
    seedPolicySet(conn.db, { name: "policy-2" });
    seedPolicySet(conn.db, { name: "policy-3" });

    const page1 = service.findAll(1, 2);
    expect(page1.data).toHaveLength(2);
    expect(page1.meta.total).toBe(3);
    expect(page1.meta.totalPages).toBe(2);

    const page2 = service.findAll(2, 2);
    expect(page2.data).toHaveLength(1);
  });

  /**
   * Validates that findById returns a policy set when it exists.
   */
  it("should find a policy set by ID", () => {
    const created = seedPolicySet(conn.db, { name: "strict-review" });

    const result = service.findById(created.policySetId);

    expect(result).toBeDefined();
    expect(result!.name).toBe("strict-review");
  });

  /**
   * Validates that findById returns undefined for a non-existent ID.
   */
  it("should return undefined for non-existent policy set", () => {
    const result = service.findById("non-existent");

    expect(result).toBeUndefined();
  });

  /**
   * Validates that update partially modifies a policy set. Only the
   * provided fields should change; omitted fields remain unchanged.
   */
  it("should partially update a policy set", () => {
    const created = seedPolicySet(conn.db, {
      name: "default",
      version: "1.0.0",
      reviewPolicyJson: { required_reviewers: 2 },
    });

    const updated = service.update(created.policySetId, {
      name: "strict",
      version: "2.0.0",
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("strict");
    expect(updated!.version).toBe("2.0.0");
    // JSON fields should remain unchanged
    expect(updated!.reviewPolicyJson).toEqual({ required_reviewers: 2 });
  });

  /**
   * Validates that update returns undefined for a non-existent policy set.
   */
  it("should return undefined when updating non-existent policy set", () => {
    const result = service.update("non-existent", { name: "updated" });

    expect(result).toBeUndefined();
  });

  /**
   * Validates that update can modify JSON policy fields.
   * This is critical for operators changing policy configurations.
   */
  it("should update JSON policy fields", () => {
    const created = seedPolicySet(conn.db);

    const updated = service.update(created.policySetId, {
      schedulingPolicyJson: { priority_weight: 0.8 },
      securityPolicyJson: { allowed_commands: ["npm test"] },
    });

    expect(updated).toBeDefined();
    expect(updated!.schedulingPolicyJson).toEqual({ priority_weight: 0.8 });
    expect(updated!.securityPolicyJson).toEqual({ allowed_commands: ["npm test"] });
  });

  /**
   * Validates that update can set JSON fields to null, effectively
   * clearing the policy configuration for that category.
   */
  it("should set JSON fields to null when explicitly provided", () => {
    const created = seedPolicySet(conn.db, {
      reviewPolicyJson: { required_reviewers: 3 },
    });

    const updated = service.update(created.policySetId, {
      reviewPolicyJson: null,
    });

    expect(updated).toBeDefined();
    expect(updated!.reviewPolicyJson).toBeNull();
  });
});
