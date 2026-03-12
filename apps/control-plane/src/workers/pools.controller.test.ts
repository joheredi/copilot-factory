/**
 * Tests for the pools controller.
 *
 * Verifies HTTP-layer behavior by mocking the {@link PoolsService}.
 * Each test validates a single aspect of the controller: successful
 * responses, proper delegation to the service, and error handling
 * (NotFoundException for missing pools).
 *
 * @module @factory/control-plane
 */
import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PoolsController } from "./pools.controller.js";
import type { PoolsService } from "./pools.service.js";

/** Factory for a fake pool object with sensible defaults. */
function fakePool(overrides: Record<string, unknown> = {}) {
  return {
    workerPoolId: "pool-1",
    name: "Dev Pool",
    poolType: "developer",
    provider: "copilot",
    runtime: "copilot-cli",
    model: "gpt-4",
    maxConcurrency: 3,
    defaultTimeoutSec: 600,
    defaultTokenBudget: 100000,
    costProfile: null,
    capabilities: ["typescript", "react"],
    repoScopeRules: null,
    enabled: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Factory for a fake pool detail response. */
function fakePoolDetail(overrides: Record<string, unknown> = {}) {
  return {
    pool: fakePool(),
    workerCount: 2,
    activeTaskCount: 1,
    profiles: [],
    ...overrides,
  };
}

/** Factory for a fake worker object. */
function fakeWorker(overrides: Record<string, unknown> = {}) {
  return {
    workerId: "worker-1",
    poolId: "pool-1",
    name: "worker-alpha",
    status: "online",
    host: "localhost",
    runtimeVersion: "1.0.0",
    lastHeartbeatAt: new Date(),
    currentTaskId: null,
    currentRunId: null,
    healthMetadata: null,
    ...overrides,
  };
}

describe("PoolsController", () => {
  let controller: PoolsController;
  let service: {
    create: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findDetailById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    findWorkersByPoolId: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      create: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      findDetailById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findWorkersByPoolId: vi.fn(),
    };

    controller = new PoolsController(service as unknown as PoolsService);
  });

  /**
   * Validates that create delegates to the service and returns
   * the created pool with generated UUID and timestamps.
   */
  it("should create a pool", () => {
    const pool = fakePool();
    service.create.mockReturnValue(pool);

    const dto = {
      name: "Dev Pool",
      poolType: "developer" as const,
      maxConcurrency: 3,
      enabled: true,
    };

    const result = controller.create(dto);

    expect(service.create).toHaveBeenCalledWith(dto);
    expect(result).toEqual(pool);
  });

  /**
   * Validates that findAll delegates pagination and filter params
   * to the service. Filters are extracted from the query DTO.
   */
  it("should list pools with pagination and filters", () => {
    const response = {
      data: [fakePool()],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    service.findAll.mockReturnValue(response);

    const result = controller.findAll({
      page: 1,
      limit: 20,
      poolType: "developer",
      enabled: undefined,
    });

    expect(service.findAll).toHaveBeenCalledWith(1, 20, {
      poolType: "developer",
      enabled: undefined,
    });
    expect(result).toEqual(response);
  });

  /**
   * Validates that findById returns enriched pool detail when
   * the pool exists (includes worker count, active task count, profiles).
   */
  it("should return pool detail by ID", () => {
    const detail = fakePoolDetail();
    service.findDetailById.mockReturnValue(detail);

    const result = controller.findById("pool-1");

    expect(service.findDetailById).toHaveBeenCalledWith("pool-1");
    expect(result).toEqual(detail);
  });

  /**
   * Validates that findById throws NotFoundException for missing pools.
   * The global exception filter maps this to a 404 HTTP response.
   */
  it("should throw NotFoundException when pool not found", () => {
    service.findDetailById.mockReturnValue(undefined);

    expect(() => controller.findById("missing")).toThrow(NotFoundException);
  });

  /**
   * Validates that update returns the updated pool when it exists.
   */
  it("should update a pool", () => {
    const pool = fakePool({ name: "Updated Pool" });
    service.update.mockReturnValue(pool);

    const result = controller.update("pool-1", { name: "Updated Pool" });

    expect(service.update).toHaveBeenCalledWith("pool-1", { name: "Updated Pool" });
    expect(result).toEqual(pool);
  });

  /**
   * Validates that update throws NotFoundException for missing pools.
   */
  it("should throw NotFoundException when updating non-existent pool", () => {
    service.update.mockReturnValue(undefined);

    expect(() => controller.update("missing", { name: "Updated" })).toThrow(NotFoundException);
  });

  /**
   * Validates that delete succeeds silently (204) when the pool exists.
   */
  it("should delete a pool", () => {
    service.delete.mockReturnValue(true);

    expect(() => controller.delete("pool-1")).not.toThrow();
    expect(service.delete).toHaveBeenCalledWith("pool-1");
  });

  /**
   * Validates that delete throws NotFoundException for missing pools.
   */
  it("should throw NotFoundException when deleting non-existent pool", () => {
    service.delete.mockReturnValue(false);

    expect(() => controller.delete("missing")).toThrow(NotFoundException);
  });

  /**
   * Validates that findWorkers returns the worker list after verifying
   * the parent pool exists.
   */
  it("should list workers for a pool", () => {
    const pool = fakePool();
    const poolWorkers = [fakeWorker(), fakeWorker({ workerId: "worker-2" })];
    service.findById.mockReturnValue(pool);
    service.findWorkersByPoolId.mockReturnValue(poolWorkers);

    const result = controller.findWorkers("pool-1");

    expect(service.findById).toHaveBeenCalledWith("pool-1");
    expect(service.findWorkersByPoolId).toHaveBeenCalledWith("pool-1");
    expect(result).toHaveLength(2);
  });

  /**
   * Validates that findWorkers throws NotFoundException when pool does
   * not exist — prevents returning empty arrays for invalid pool IDs.
   */
  it("should throw NotFoundException when listing workers for non-existent pool", () => {
    service.findById.mockReturnValue(undefined);

    expect(() => controller.findWorkers("missing")).toThrow(NotFoundException);
  });
});
