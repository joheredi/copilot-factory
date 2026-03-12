/**
 * Integration tests for the pools service.
 *
 * Uses an in-memory SQLite database with real Drizzle migrations to verify
 * pool CRUD operations, filtered listing with pagination, enriched detail
 * retrieval (worker counts, profiles), and worker listing by pool.
 *
 * These tests validate the service against a real database to catch SQL
 * and ORM issues that unit tests with mocks would miss.
 *
 * @module @factory/control-plane
 */
import { beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase } from "@factory/testing";

import { PoolsService } from "./pools.service.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import { createWorkerRepository } from "../infrastructure/repositories/worker.repository.js";
import { createAgentProfileRepository } from "../infrastructure/repositories/agent-profile.repository.js";

/** Resolved path for migrations relative to the control-plane app. */
const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname;

describe("PoolsService", () => {
  let conn: DatabaseConnection;
  let service: PoolsService;

  beforeEach(() => {
    conn = createTestDatabase({ migrationsFolder });
    service = new PoolsService(conn);
  });

  /**
   * Validates that pool creation generates a UUID, sets timestamps,
   * and persists all fields including JSON columns (capabilities).
   */
  it("should create a pool with all fields", () => {
    const pool = service.create({
      name: "Dev Pool",
      poolType: "developer",
      provider: "copilot",
      runtime: "copilot-cli",
      model: "gpt-4",
      maxConcurrency: 3,
      defaultTimeoutSec: 600,
      defaultTokenBudget: 100000,
      capabilities: ["typescript", "react"],
      enabled: true,
    });

    expect(pool.workerPoolId).toBeDefined();
    expect(pool.name).toBe("Dev Pool");
    expect(pool.poolType).toBe("developer");
    expect(pool.provider).toBe("copilot");
    expect(pool.maxConcurrency).toBe(3);
    expect(pool.capabilities).toEqual(["typescript", "react"]);
    expect(pool.enabled).toBe(1);
    expect(pool.createdAt).toBeInstanceOf(Date);
  });

  /**
   * Validates that pool creation uses defaults for optional fields.
   * maxConcurrency defaults to 1 in the DTO schema.
   */
  it("should create a pool with minimal fields", () => {
    const pool = service.create({
      name: "Minimal Pool",
      poolType: "reviewer",
      maxConcurrency: 1,
      enabled: true,
    });

    expect(pool.workerPoolId).toBeDefined();
    expect(pool.provider).toBeNull();
    expect(pool.runtime).toBeNull();
    expect(pool.model).toBeNull();
    expect(pool.capabilities).toBeNull();
  });

  /**
   * Validates paginated listing with correct metadata (page, limit,
   * total, totalPages).
   */
  it("should list pools with pagination", () => {
    for (let i = 0; i < 5; i++) {
      service.create({
        name: `Pool ${String(i)}`,
        poolType: "developer",
        maxConcurrency: 1,
        enabled: true,
      });
    }

    const page1 = service.findAll(1, 2);
    expect(page1.data).toHaveLength(2);
    expect(page1.meta.total).toBe(5);
    expect(page1.meta.totalPages).toBe(3);

    const page3 = service.findAll(3, 2);
    expect(page3.data).toHaveLength(1);
  });

  /**
   * Validates that poolType filter returns only pools of the specified type.
   */
  it("should filter pools by poolType", () => {
    service.create({ name: "Dev", poolType: "developer", maxConcurrency: 1, enabled: true });
    service.create({ name: "Rev", poolType: "reviewer", maxConcurrency: 1, enabled: true });

    const result = service.findAll(1, 20, { poolType: "developer" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.poolType).toBe("developer");
  });

  /**
   * Validates that enabled filter correctly filters pools by their
   * enabled/disabled status.
   */
  it("should filter pools by enabled status", () => {
    service.create({ name: "Active", poolType: "developer", maxConcurrency: 1, enabled: true });
    service.create({ name: "Inactive", poolType: "developer", maxConcurrency: 1, enabled: false });

    const enabledOnly = service.findAll(1, 20, { enabled: true });
    expect(enabledOnly.data).toHaveLength(1);
    expect(enabledOnly.data[0]!.name).toBe("Active");

    const disabledOnly = service.findAll(1, 20, { enabled: false });
    expect(disabledOnly.data).toHaveLength(1);
    expect(disabledOnly.data[0]!.name).toBe("Inactive");
  });

  /**
   * Validates that multiple filters are combined with AND semantics.
   */
  it("should combine filters with AND semantics", () => {
    service.create({ name: "Dev Active", poolType: "developer", maxConcurrency: 1, enabled: true });
    service.create({
      name: "Dev Inactive",
      poolType: "developer",
      maxConcurrency: 1,
      enabled: false,
    });
    service.create({ name: "Rev Active", poolType: "reviewer", maxConcurrency: 1, enabled: true });

    const result = service.findAll(1, 20, { poolType: "developer", enabled: true });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.name).toBe("Dev Active");
  });

  /**
   * Validates that findById returns the pool when it exists.
   */
  it("should find a pool by ID", () => {
    const created = service.create({
      name: "Findable",
      poolType: "developer",
      maxConcurrency: 1,
      enabled: true,
    });

    const found = service.findById(created.workerPoolId);
    expect(found).toBeDefined();
    expect(found!.name).toBe("Findable");
  });

  /**
   * Validates that findById returns undefined for non-existent pools.
   */
  it("should return undefined for non-existent pool", () => {
    expect(service.findById("non-existent")).toBeUndefined();
  });

  /**
   * Validates that pool detail includes worker count, active task count,
   * and profile list from related tables.
   */
  it("should return enriched pool detail with worker and profile counts", () => {
    const pool = service.create({
      name: "Enriched Pool",
      poolType: "developer",
      maxConcurrency: 5,
      enabled: true,
    });

    // Add workers directly via repository
    const workerRepo = createWorkerRepository(conn.db);
    workerRepo.create({
      workerId: "w1",
      poolId: pool.workerPoolId,
      name: "worker-1",
      status: "online",
    });
    workerRepo.create({
      workerId: "w2",
      poolId: pool.workerPoolId,
      name: "worker-2",
      status: "busy",
    });
    workerRepo.create({
      workerId: "w3",
      poolId: pool.workerPoolId,
      name: "worker-3",
      status: "busy",
    });

    // Add a profile directly via repository
    const profileRepo = createAgentProfileRepository(conn.db);
    profileRepo.create({
      agentProfileId: "p1",
      poolId: pool.workerPoolId,
    });

    const detail = service.findDetailById(pool.workerPoolId);
    expect(detail).toBeDefined();
    expect(detail!.workerCount).toBe(3);
    expect(detail!.activeTaskCount).toBe(2);
    expect(detail!.profiles).toHaveLength(1);
  });

  /**
   * Validates that findDetailById returns undefined for non-existent pools.
   */
  it("should return undefined detail for non-existent pool", () => {
    expect(service.findDetailById("non-existent")).toBeUndefined();
  });

  /**
   * Validates that update modifies only the specified fields and
   * updates the updatedAt timestamp.
   */
  it("should update pool fields", () => {
    const pool = service.create({
      name: "Original",
      poolType: "developer",
      maxConcurrency: 1,
      enabled: true,
    });

    const updated = service.update(pool.workerPoolId, {
      name: "Updated",
      maxConcurrency: 5,
      enabled: false,
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated");
    expect(updated!.maxConcurrency).toBe(5);
    expect(updated!.enabled).toBe(0);
    expect(updated!.poolType).toBe("developer"); // unchanged
  });

  /**
   * Validates that update returns undefined for non-existent pools.
   */
  it("should return undefined when updating non-existent pool", () => {
    expect(service.update("non-existent", { name: "No Pool" })).toBeUndefined();
  });

  /**
   * Validates that delete removes the pool and returns true.
   */
  it("should delete a pool", () => {
    const pool = service.create({
      name: "Deletable",
      poolType: "developer",
      maxConcurrency: 1,
      enabled: true,
    });

    expect(service.delete(pool.workerPoolId)).toBe(true);
    expect(service.findById(pool.workerPoolId)).toBeUndefined();
  });

  /**
   * Validates that delete returns false for non-existent pools.
   */
  it("should return false when deleting non-existent pool", () => {
    expect(service.delete("non-existent")).toBe(false);
  });

  /**
   * Validates that findWorkersByPoolId returns workers belonging
   * to the specified pool.
   */
  it("should list workers by pool ID", () => {
    const pool = service.create({
      name: "Workers Pool",
      poolType: "developer",
      maxConcurrency: 3,
      enabled: true,
    });

    const workerRepo = createWorkerRepository(conn.db);
    workerRepo.create({
      workerId: "w1",
      poolId: pool.workerPoolId,
      name: "worker-1",
      status: "online",
    });
    workerRepo.create({
      workerId: "w2",
      poolId: pool.workerPoolId,
      name: "worker-2",
      status: "busy",
    });

    const result = service.findWorkersByPoolId(pool.workerPoolId);
    expect(result).toHaveLength(2);
  });
});
