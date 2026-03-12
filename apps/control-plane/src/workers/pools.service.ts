/**
 * Service for worker pool management — creation, listing, detail retrieval,
 * update, and deletion.
 *
 * Pools define shared configuration for worker concurrency, timeouts,
 * capabilities, and repo scope rules. Each pool has a type (developer,
 * reviewer, etc.) and can be enabled/disabled independently.
 *
 * The service enriches pool responses with live worker counts and active
 * task counts by querying the worker repository.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/prd/002-data-model.md} §2.3 WorkerPool
 * @see {@link file://docs/prd/006-additional-refinements.md} §6.1
 */
import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import { workerPools } from "../infrastructure/database/schema.js";
import { createWorkerPoolRepository } from "../infrastructure/repositories/worker-pool.repository.js";
import { createWorkerRepository } from "../infrastructure/repositories/worker.repository.js";
import { createAgentProfileRepository } from "../infrastructure/repositories/agent-profile.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import type { WorkerPool } from "../infrastructure/repositories/worker-pool.repository.js";
import type { Worker } from "../infrastructure/repositories/worker.repository.js";
import type { AgentProfile } from "../infrastructure/repositories/agent-profile.repository.js";
import type { CreatePoolDto } from "./dtos/create-pool.dto.js";
import type { UpdatePoolDto } from "./dtos/update-pool.dto.js";

/** Shape of a paginated list response. */
export interface PaginatedResponse<T> {
  /** Items for the current page. */
  data: T[];
  /** Pagination metadata. */
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** Enriched pool detail including worker and profile counts. */
export interface PoolDetail {
  /** The worker pool entity. */
  pool: WorkerPool;
  /** Number of workers currently registered in this pool. */
  workerCount: number;
  /** Number of workers with status "busy" (actively working on a task). */
  activeTaskCount: number;
  /** Agent profiles attached to this pool. */
  profiles: AgentProfile[];
}

/** Filter criteria for listing pools. */
export interface PoolFilters {
  poolType?: string;
  enabled?: boolean;
}

/**
 * Manages worker pool lifecycle — CRUD operations and enriched queries.
 *
 * Pools are the operational containers for workers. This service handles
 * pool configuration management while the worker supervisor (T044) manages
 * the actual worker process lifecycle.
 */
@Injectable()
export class PoolsService {
  /** @param conn Injected database connection. */
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection) {}

  /**
   * Create a new worker pool.
   *
   * Generates a UUID for the pool and persists it with the provided
   * configuration. The pool starts in the enabled/disabled state as
   * specified by the caller (defaults to enabled).
   *
   * @param dto Validated creation payload.
   * @returns The newly created pool row.
   */
  create(dto: CreatePoolDto): WorkerPool {
    return this.conn.writeTransaction((db) => {
      const repo = createWorkerPoolRepository(db);
      return repo.create({
        workerPoolId: randomUUID(),
        name: dto.name,
        poolType: dto.poolType,
        provider: dto.provider ?? null,
        runtime: dto.runtime ?? null,
        model: dto.model ?? null,
        maxConcurrency: dto.maxConcurrency,
        defaultTimeoutSec: dto.defaultTimeoutSec ?? null,
        defaultTokenBudget: dto.defaultTokenBudget ?? null,
        costProfile: dto.costProfile ?? null,
        capabilities: dto.capabilities ?? null,
        repoScopeRules: dto.repoScopeRules ?? null,
        enabled: dto.enabled ? 1 : 0,
      });
    });
  }

  /**
   * List pools with optional filters and page-based pagination.
   *
   * Filters are combined with AND semantics — only pools matching all
   * provided filters are returned.
   *
   * @param page 1-based page number.
   * @param limit Items per page.
   * @param filters Optional filter criteria.
   * @returns Paginated response with pool data and metadata.
   */
  findAll(page: number, limit: number, filters: PoolFilters = {}): PaginatedResponse<WorkerPool> {
    const offset = (page - 1) * limit;
    const conditions = this.buildFilterConditions(filters);

    const countQuery = conditions
      ? this.conn.db.select({ count: count() }).from(workerPools).where(conditions)
      : this.conn.db.select({ count: count() }).from(workerPools);

    const totalResult = countQuery.get();
    const total = totalResult?.count ?? 0;

    let dataQuery = conditions
      ? this.conn.db.select().from(workerPools).where(conditions).$dynamic()
      : this.conn.db.select().from(workerPools).$dynamic();

    dataQuery = dataQuery.limit(limit).offset(offset);
    const data = dataQuery.all();

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find a single pool by ID.
   *
   * @param id Pool UUID.
   * @returns The pool or `undefined` if not found.
   */
  findById(id: string): WorkerPool | undefined {
    const repo = createWorkerPoolRepository(this.conn.db);
    return repo.findById(id);
  }

  /**
   * Get enriched pool detail including worker counts and profiles.
   *
   * Returns the pool along with its registered worker count, active task
   * count (workers with status "busy"), and attached agent profiles.
   *
   * @param id Pool UUID.
   * @returns Enriched pool detail or `undefined` if pool not found.
   */
  findDetailById(id: string): PoolDetail | undefined {
    const poolRepo = createWorkerPoolRepository(this.conn.db);
    const pool = poolRepo.findById(id);
    if (!pool) {
      return undefined;
    }

    const workerRepo = createWorkerRepository(this.conn.db);
    const profileRepo = createAgentProfileRepository(this.conn.db);

    const poolWorkers = workerRepo.findByPoolId(id);
    const activeTaskCount = poolWorkers.filter((w) => w.status === "busy").length;
    const profiles = profileRepo.findByPoolId(id);

    return {
      pool,
      workerCount: poolWorkers.length,
      activeTaskCount,
      profiles,
    };
  }

  /**
   * Update a pool's configuration by ID.
   *
   * Only provided fields are updated. The `enabled` field controls whether
   * the pool accepts new worker assignments — disabling a pool prevents
   * new tasks from being scheduled to it.
   *
   * @param id Pool UUID.
   * @param dto Validated update payload.
   * @returns The updated pool or `undefined` if not found.
   */
  update(id: string, dto: UpdatePoolDto): WorkerPool | undefined {
    return this.conn.writeTransaction((db) => {
      const repo = createWorkerPoolRepository(db);
      const existing = repo.findById(id);
      if (!existing) {
        return undefined;
      }

      const data: Record<string, unknown> = {};
      if (dto.name !== undefined) data["name"] = dto.name;
      if (dto.poolType !== undefined) data["poolType"] = dto.poolType;
      if (dto.provider !== undefined) data["provider"] = dto.provider;
      if (dto.runtime !== undefined) data["runtime"] = dto.runtime;
      if (dto.model !== undefined) data["model"] = dto.model;
      if (dto.maxConcurrency !== undefined) data["maxConcurrency"] = dto.maxConcurrency;
      if (dto.defaultTimeoutSec !== undefined) data["defaultTimeoutSec"] = dto.defaultTimeoutSec;
      if (dto.defaultTokenBudget !== undefined) data["defaultTokenBudget"] = dto.defaultTokenBudget;
      if (dto.costProfile !== undefined) data["costProfile"] = dto.costProfile;
      if (dto.capabilities !== undefined) data["capabilities"] = dto.capabilities;
      if (dto.repoScopeRules !== undefined) data["repoScopeRules"] = dto.repoScopeRules;
      if (dto.enabled !== undefined) data["enabled"] = dto.enabled ? 1 : 0;

      return repo.update(id, data);
    });
  }

  /**
   * Delete a pool by ID.
   *
   * Returns true if the pool was deleted, false if it did not exist.
   * Callers should verify no active workers remain before deleting.
   *
   * @param id Pool UUID.
   * @returns True if deleted, false if not found.
   */
  delete(id: string): boolean {
    return this.conn.writeTransaction((db) => {
      const repo = createWorkerPoolRepository(db);
      return repo.delete(id);
    });
  }

  /**
   * List workers belonging to a specific pool.
   *
   * @param poolId Pool UUID.
   * @returns Array of workers in the pool.
   */
  findWorkersByPoolId(poolId: string): Worker[] {
    const repo = createWorkerRepository(this.conn.db);
    return repo.findByPoolId(poolId);
  }

  /**
   * Build Drizzle filter conditions from pool filter criteria.
   *
   * Combines all provided filters with AND semantics.
   *
   * @param filters Pool filter criteria.
   * @returns Combined SQL condition or undefined if no filters.
   */
  private buildFilterConditions(filters: PoolFilters) {
    const conditions = [];

    if (filters.poolType) {
      conditions.push(eq(workerPools.poolType, filters.poolType));
    }
    if (filters.enabled !== undefined) {
      conditions.push(eq(workerPools.enabled, filters.enabled ? 1 : 0));
    }

    if (conditions.length === 0) return undefined;
    if (conditions.length === 1) return conditions[0];
    return and(...conditions);
  }
}
