/**
 * Tests for the projects service.
 *
 * Uses an in-memory SQLite database with Drizzle migrations to verify
 * CRUD operations against real SQL. Each test gets a fresh database
 * to ensure isolation.
 *
 * @module @factory/control-plane
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ConflictException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectsService } from "./projects.service.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

/** Path to Drizzle migration files. */
const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

/**
 * Creates an in-memory database connection with all migrations applied.
 * Uses better-sqlite3 directly to avoid path resolution issues with `:memory:`.
 */
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

describe("ProjectsService", () => {
  let conn: DatabaseConnection;
  let service: ProjectsService;

  beforeEach(() => {
    conn = createTestConnection();
    service = new ProjectsService(conn);
  });

  afterEach(() => {
    conn.close();
  });

  /**
   * Validates that a project can be created and assigned a UUID.
   */
  it("should create a project", () => {
    const project = service.create({ name: "My Project", owner: "alice" });

    expect(project.projectId).toBeDefined();
    expect(project.name).toBe("My Project");
    expect(project.owner).toBe("alice");
  });

  /**
   * Validates that duplicate project names throw ConflictException.
   */
  it("should throw ConflictException for duplicate names", () => {
    service.create({ name: "Unique", owner: "alice" });

    expect(() => service.create({ name: "Unique", owner: "bob" })).toThrow(ConflictException);
  });

  /**
   * Validates paginated listing returns correct metadata.
   */
  it("should list projects with pagination", () => {
    service.create({ name: "P1", owner: "alice" });
    service.create({ name: "P2", owner: "alice" });
    service.create({ name: "P3", owner: "alice" });

    const result = service.findAll(1, 2);

    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(3);
    expect(result.meta.totalPages).toBe(2);
    expect(result.meta.page).toBe(1);
  });

  /**
   * Validates that findById returns the correct project.
   */
  it("should find a project by ID", () => {
    const created = service.create({ name: "Find Me", owner: "alice" });
    const found = service.findById(created.projectId);

    expect(found).toBeDefined();
    expect(found!.name).toBe("Find Me");
  });

  /**
   * Validates that findById returns undefined for missing IDs.
   */
  it("should return undefined for non-existent ID", () => {
    const found = service.findById("does-not-exist");
    expect(found).toBeUndefined();
  });

  /**
   * Validates that update modifies the specified fields.
   */
  it("should update a project", () => {
    const created = service.create({ name: "Original", owner: "alice" });
    const updated = service.update(created.projectId, { name: "Updated" });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated");
    expect(updated!.owner).toBe("alice");
  });

  /**
   * Validates that update returns undefined for non-existent projects.
   */
  it("should return undefined when updating non-existent project", () => {
    const result = service.update("missing", { name: "Nope" });
    expect(result).toBeUndefined();
  });

  /**
   * Validates that delete removes the project and returns true.
   */
  it("should delete a project", () => {
    const created = service.create({ name: "Delete Me", owner: "alice" });
    const deleted = service.delete(created.projectId);

    expect(deleted).toBe(true);
    expect(service.findById(created.projectId)).toBeUndefined();
  });

  /**
   * Validates that delete returns false for non-existent projects.
   */
  it("should return false when deleting non-existent project", () => {
    const deleted = service.delete("missing");
    expect(deleted).toBe(false);
  });
});
