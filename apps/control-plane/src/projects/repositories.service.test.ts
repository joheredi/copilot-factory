/**
 * Tests for the repositories service.
 *
 * Uses an in-memory SQLite database with Drizzle migrations to verify
 * CRUD operations against real SQL. A parent project is created in
 * `beforeEach` since repositories require a valid project FK.
 *
 * @module @factory/control-plane
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectsService } from "./projects.service.js";
import { RepositoriesService } from "./repositories.service.js";
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

/** Default DTO for creating a test repository. */
const repoDto = {
  name: "Test Repo",
  remoteUrl: "https://github.com/test/repo.git",
  defaultBranch: "main",
  localCheckoutStrategy: "worktree" as const,
  status: "active",
};

describe("RepositoriesService", () => {
  let conn: DatabaseConnection;
  let projectsService: ProjectsService;
  let service: RepositoriesService;
  let projectId: string;

  beforeEach(() => {
    conn = createTestConnection();
    projectsService = new ProjectsService(conn);
    service = new RepositoriesService(conn);

    // Create a parent project for repository tests
    const project = projectsService.create({
      name: "Parent Project",
      owner: "alice",
    });
    projectId = project.projectId;
  });

  afterEach(() => {
    conn.close();
  });

  /**
   * Validates that a repository can be created under a project.
   */
  it("should create a repository", () => {
    const repo = service.create(projectId, repoDto);

    expect(repo.repositoryId).toBeDefined();
    expect(repo.name).toBe("Test Repo");
    expect(repo.projectId).toBe(projectId);
    expect(repo.localCheckoutStrategy).toBe("worktree");
  });

  /**
   * Validates that listing repositories returns correct pagination.
   */
  it("should list repositories by project with pagination", () => {
    service.create(projectId, { ...repoDto, name: "R1" });
    service.create(projectId, { ...repoDto, name: "R2" });
    service.create(projectId, { ...repoDto, name: "R3" });

    const result = service.findByProjectId(projectId, 1, 2);

    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(3);
    expect(result.meta.totalPages).toBe(2);
  });

  /**
   * Validates that findById returns the correct repository.
   */
  it("should find a repository by ID", () => {
    const created = service.create(projectId, repoDto);
    const found = service.findById(created.repositoryId);

    expect(found).toBeDefined();
    expect(found!.name).toBe("Test Repo");
  });

  /**
   * Validates that findById returns undefined for missing IDs.
   */
  it("should return undefined for non-existent ID", () => {
    expect(service.findById("missing")).toBeUndefined();
  });

  /**
   * Validates that update modifies the specified fields.
   */
  it("should update a repository", () => {
    const created = service.create(projectId, repoDto);
    const updated = service.update(created.repositoryId, {
      name: "Updated Repo",
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Repo");
  });

  /**
   * Validates that update returns undefined for non-existent repositories.
   */
  it("should return undefined when updating non-existent repository", () => {
    expect(service.update("missing", { name: "Nope" })).toBeUndefined();
  });

  /**
   * Validates that delete removes the repository and returns true.
   */
  it("should delete a repository", () => {
    const created = service.create(projectId, repoDto);
    const deleted = service.delete(created.repositoryId);

    expect(deleted).toBe(true);
    expect(service.findById(created.repositoryId)).toBeUndefined();
  });

  /**
   * Validates that delete returns false for non-existent repositories.
   */
  it("should return false when deleting non-existent repository", () => {
    expect(service.delete("missing")).toBe(false);
  });
});
