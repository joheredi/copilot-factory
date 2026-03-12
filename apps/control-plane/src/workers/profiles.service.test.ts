/**
 * Integration tests for the profiles service.
 *
 * Uses an in-memory SQLite database with real Drizzle migrations to verify
 * agent profile CRUD operations scoped to parent pools. Tests ensure the
 * pool ownership constraint is enforced — profiles cannot be accessed or
 * modified through a different pool.
 *
 * @module @factory/control-plane
 */
import { beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase } from "@factory/testing";

import { ProfilesService } from "./profiles.service.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import { createWorkerPoolRepository } from "../infrastructure/repositories/worker-pool.repository.js";
import { createPromptTemplateRepository } from "../infrastructure/repositories/prompt-template.repository.js";

/** Resolved path for migrations relative to the control-plane app. */
const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname;

/** Helper to create a test pool in the database. */
function createPool(conn: DatabaseConnection, id: string, name: string) {
  const repo = createWorkerPoolRepository(conn.db);
  return repo.create({
    workerPoolId: id,
    name,
    poolType: "developer",
    maxConcurrency: 1,
    enabled: 1,
  });
}

/** Helper to create a test prompt template in the database. */
function createTemplate(conn: DatabaseConnection, id: string) {
  const repo = createPromptTemplateRepository(conn.db);
  return repo.create({
    promptTemplateId: id,
    name: `Template ${id}`,
    version: "1.0.0",
    role: "developer",
    templateText: "Test template text",
  });
}

describe("ProfilesService", () => {
  let conn: DatabaseConnection;
  let service: ProfilesService;

  beforeEach(() => {
    conn = createTestDatabase({ migrationsFolder });
    service = new ProfilesService(conn);
    // Create a test pool and template for profile operations
    createPool(conn, "pool-1", "Test Pool");
    createTemplate(conn, "template-1");
    createTemplate(conn, "t1");
    createTemplate(conn, "t2");
  });

  /**
   * Validates that profile creation generates a UUID, links to the
   * parent pool, and persists all policy references.
   */
  it("should create a profile with all policy references", () => {
    const profile = service.create("pool-1", {
      promptTemplateId: "template-1",
      toolPolicyId: "tool-1",
      commandPolicyId: "cmd-1",
      fileScopePolicyId: "fs-1",
      validationPolicyId: "val-1",
      reviewPolicyId: "rev-1",
      budgetPolicyId: "bud-1",
      retryPolicyId: "ret-1",
    });

    expect(profile).not.toBeNull();
    expect(profile!.agentProfileId).toBeDefined();
    expect(profile!.poolId).toBe("pool-1");
    expect(profile!.promptTemplateId).toBe("template-1");
    expect(profile!.toolPolicyId).toBe("tool-1");
    expect(profile!.retryPolicyId).toBe("ret-1");
  });

  /**
   * Validates that profiles can be created with no policy references.
   * This supports incremental profile configuration.
   */
  it("should create a profile with no policy references", () => {
    const profile = service.create("pool-1", {});

    expect(profile).not.toBeNull();
    expect(profile!.promptTemplateId).toBeNull();
    expect(profile!.toolPolicyId).toBeNull();
  });

  /**
   * Validates that create returns null when the parent pool does not exist.
   * This prevents orphaned profiles.
   */
  it("should return null when creating profile for non-existent pool", () => {
    const result = service.create("non-existent", {});
    expect(result).toBeNull();
  });

  /**
   * Validates that findByPoolId returns all profiles attached to a pool.
   */
  it("should list profiles for a pool", () => {
    service.create("pool-1", { promptTemplateId: "t1" });
    service.create("pool-1", { promptTemplateId: "t2" });

    const profiles = service.findByPoolId("pool-1");
    expect(profiles).toHaveLength(2);
  });

  /**
   * Validates that findByPoolId returns an empty array for pools with
   * no profiles, not undefined or null.
   */
  it("should return empty array for pool with no profiles", () => {
    const profiles = service.findByPoolId("pool-1");
    expect(profiles).toEqual([]);
  });

  /**
   * Validates that findById returns a profile when it exists and
   * belongs to the specified pool.
   */
  it("should find a profile by ID scoped to pool", () => {
    const created = service.create("pool-1", { promptTemplateId: "t1" });

    const found = service.findById("pool-1", created!.agentProfileId);
    expect(found).toBeDefined();
    expect(found!.promptTemplateId).toBe("t1");
  });

  /**
   * Validates that findById returns undefined when the profile exists
   * but belongs to a different pool — enforces pool ownership.
   */
  it("should return undefined when profile belongs to different pool", () => {
    createPool(conn, "pool-2", "Other Pool");
    const created = service.create("pool-1", {});

    const found = service.findById("pool-2", created!.agentProfileId);
    expect(found).toBeUndefined();
  });

  /**
   * Validates that findById returns undefined for non-existent profiles.
   */
  it("should return undefined for non-existent profile", () => {
    expect(service.findById("pool-1", "non-existent")).toBeUndefined();
  });

  /**
   * Validates that update modifies only the specified policy references.
   */
  it("should update profile policy references", () => {
    const created = service.create("pool-1", {});

    const updated = service.update("pool-1", created!.agentProfileId, {
      toolPolicyId: "tool-new",
      budgetPolicyId: "budget-new",
    });

    expect(updated).toBeDefined();
    expect(updated!.toolPolicyId).toBe("tool-new");
    expect(updated!.budgetPolicyId).toBe("budget-new");
    expect(updated!.promptTemplateId).toBeNull(); // unchanged
  });

  /**
   * Validates that update can clear policy references by setting them to null.
   */
  it("should clear policy references with null", () => {
    const created = service.create("pool-1", { toolPolicyId: "tool-1" });

    const updated = service.update("pool-1", created!.agentProfileId, {
      toolPolicyId: null,
    });

    expect(updated).toBeDefined();
    expect(updated!.toolPolicyId).toBeNull();
  });

  /**
   * Validates that update returns undefined when profile belongs to
   * a different pool — enforces pool ownership on writes.
   */
  it("should return undefined when updating profile in wrong pool", () => {
    createPool(conn, "pool-2", "Other Pool");
    const created = service.create("pool-1", {});

    const result = service.update("pool-2", created!.agentProfileId, {
      toolPolicyId: "tool-1",
    });
    expect(result).toBeUndefined();
  });

  /**
   * Validates that delete removes the profile and returns true.
   */
  it("should delete a profile", () => {
    const created = service.create("pool-1", {});

    expect(service.delete("pool-1", created!.agentProfileId)).toBe(true);
    expect(service.findById("pool-1", created!.agentProfileId)).toBeUndefined();
  });

  /**
   * Validates that delete returns false when profile belongs to a
   * different pool — prevents cross-pool deletion.
   */
  it("should return false when deleting profile in wrong pool", () => {
    createPool(conn, "pool-2", "Other Pool");
    const created = service.create("pool-1", {});

    expect(service.delete("pool-2", created!.agentProfileId)).toBe(false);
    // Profile should still exist
    expect(service.findById("pool-1", created!.agentProfileId)).toBeDefined();
  });

  /**
   * Validates that delete returns false for non-existent profiles.
   */
  it("should return false when deleting non-existent profile", () => {
    expect(service.delete("pool-1", "non-existent")).toBe(false);
  });
});
