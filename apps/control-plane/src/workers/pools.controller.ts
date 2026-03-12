/**
 * Handles HTTP requests for worker pool management.
 *
 * Provides CRUD endpoints for pools and a sub-resource endpoint for
 * listing active workers in a pool. Pool detail includes enriched data:
 * worker count, active task count, and attached agent profiles.
 *
 * All write operations return the created/updated entity. Not-found
 * conditions throw {@link NotFoundException} which the global exception
 * filter maps to 404.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/prd/002-data-model.md} §2.3 WorkerPool
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Inject,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";

import { CreatePoolDto } from "./dtos/create-pool.dto.js";
import { PoolFilterQueryDto } from "./dtos/pool-filter-query.dto.js";
import { UpdatePoolDto } from "./dtos/update-pool.dto.js";
import { PoolsService } from "./pools.service.js";
import type { PaginatedResponse, PoolDetail } from "./pools.service.js";
import type { WorkerPool } from "../infrastructure/repositories/worker-pool.repository.js";
import type { Worker } from "../infrastructure/repositories/worker.repository.js";

/**
 * REST controller for worker pool CRUD and worker listing.
 *
 * Endpoints:
 * - `POST /pools` — Create a pool
 * - `GET /pools` — List pools with optional filters
 * - `GET /pools/:id` — Get pool detail with worker/profile counts
 * - `PUT /pools/:id` — Update pool configuration
 * - `DELETE /pools/:id` — Delete a pool
 * - `GET /pools/:id/workers` — List active workers in a pool
 */
@ApiTags("pools")
@Controller("pools")
export class PoolsController {
  /** @param poolsService Injected pools service. */
  constructor(@Inject(PoolsService) private readonly poolsService: PoolsService) {}

  /**
   * Create a new worker pool.
   *
   * The pool is assigned a UUID and starts in the specified enabled state
   * (defaults to enabled). Required fields: name, poolType, maxConcurrency.
   *
   * @param dto Validated creation payload.
   * @returns The newly created pool.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a worker pool" })
  @ApiResponse({ status: 201, description: "Pool created." })
  @ApiResponse({ status: 400, description: "Validation failed." })
  create(@Body() dto: CreatePoolDto): WorkerPool {
    return this.poolsService.create(dto);
  }

  /**
   * List pools with optional filters and pagination.
   *
   * Supports filtering by poolType and enabled status. Filters are combined
   * with AND semantics.
   *
   * @param query Pagination and filter parameters.
   * @returns Paginated list of pools.
   */
  @Get()
  @ApiOperation({ summary: "List worker pools with optional filters" })
  @ApiQuery({ name: "poolType", required: false, description: "Filter by pool type" })
  @ApiQuery({ name: "enabled", required: false, description: "Filter by enabled status" })
  @ApiResponse({ status: 200, description: "Paginated pool list." })
  findAll(@Query() query: PoolFilterQueryDto): PaginatedResponse<WorkerPool> {
    return this.poolsService.findAll(query.page, query.limit, {
      poolType: query.poolType,
      enabled: query.enabled,
    });
  }

  /**
   * Get a single pool by ID with enriched detail.
   *
   * Returns the pool along with its registered worker count, active task
   * count, and attached agent profiles.
   *
   * @param id Pool UUID.
   * @returns Enriched pool detail.
   * @throws NotFoundException if the pool does not exist.
   */
  @Get(":id")
  @ApiOperation({ summary: "Get pool detail by ID" })
  @ApiParam({ name: "id", description: "Pool UUID" })
  @ApiResponse({ status: 200, description: "Pool detail with worker counts and profiles." })
  @ApiResponse({ status: 404, description: "Pool not found." })
  findById(@Param("id") id: string): PoolDetail {
    const detail = this.poolsService.findDetailById(id);
    if (!detail) {
      throw new NotFoundException(`Pool with ID "${id}" not found`);
    }
    return detail;
  }

  /**
   * Update a pool's configuration by ID.
   *
   * Only provided fields are updated. Setting `enabled` to false prevents
   * new tasks from being scheduled to this pool.
   *
   * @param id Pool UUID.
   * @param dto Validated update payload.
   * @returns The updated pool.
   * @throws NotFoundException if the pool does not exist.
   */
  @Put(":id")
  @ApiOperation({ summary: "Update pool configuration" })
  @ApiParam({ name: "id", description: "Pool UUID" })
  @ApiResponse({ status: 200, description: "Pool updated." })
  @ApiResponse({ status: 400, description: "Validation failed." })
  @ApiResponse({ status: 404, description: "Pool not found." })
  update(@Param("id") id: string, @Body() dto: UpdatePoolDto): WorkerPool {
    const pool = this.poolsService.update(id, dto);
    if (!pool) {
      throw new NotFoundException(`Pool with ID "${id}" not found`);
    }
    return pool;
  }

  /**
   * Delete a pool by ID.
   *
   * @param id Pool UUID.
   * @throws NotFoundException if the pool does not exist.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a worker pool" })
  @ApiParam({ name: "id", description: "Pool UUID" })
  @ApiResponse({ status: 204, description: "Pool deleted." })
  @ApiResponse({ status: 404, description: "Pool not found." })
  delete(@Param("id") id: string): void {
    const deleted = this.poolsService.delete(id);
    if (!deleted) {
      throw new NotFoundException(`Pool with ID "${id}" not found`);
    }
  }

  /**
   * List active workers belonging to a pool.
   *
   * Returns all workers registered in the pool regardless of status.
   * The caller can filter for active workers client-side using the
   * worker status field.
   *
   * @param id Pool UUID.
   * @returns Array of workers in the pool.
   * @throws NotFoundException if the pool does not exist.
   */
  @Get(":id/workers")
  @ApiOperation({ summary: "List workers in a pool" })
  @ApiParam({ name: "id", description: "Pool UUID" })
  @ApiResponse({ status: 200, description: "Worker list." })
  @ApiResponse({ status: 404, description: "Pool not found." })
  findWorkers(@Param("id") id: string): Worker[] {
    const pool = this.poolsService.findById(id);
    if (!pool) {
      throw new NotFoundException(`Pool with ID "${id}" not found`);
    }
    return this.poolsService.findWorkersByPoolId(id);
  }
}
