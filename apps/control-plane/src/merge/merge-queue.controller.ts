/**
 * REST controller for listing merge queue items.
 *
 * Exposes a paginated list endpoint at `GET /merge-queue` with
 * optional status and repositoryId filters. Each item is enriched
 * with task title and status for UI consumption.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T098-build-merge-queue-view.md}
 */
import { Controller, Get, Query, Inject } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";

import { MergeQueueFilterQueryDto } from "./dtos/merge-queue-filter-query.dto.js";
import { MergeQueueService } from "./merge-queue.service.js";
import type { PaginatedMergeQueueResponse } from "./merge-queue.service.js";

/**
 * Handles HTTP requests for the merge queue list view.
 *
 * Provides a single paginated list endpoint that returns merge queue
 * items ordered by queue position, enriched with task metadata.
 */
@ApiTags("merge-queue")
@Controller("merge-queue")
export class MergeQueueController {
  /** @param mergeQueueService Injected merge queue service. */
  constructor(@Inject(MergeQueueService) private readonly mergeQueueService: MergeQueueService) {}

  /**
   * List merge queue items with optional filters.
   *
   * Returns a paginated list of merge queue items ordered by position.
   * Each item includes the associated task title and status for
   * display in the merge queue view.
   *
   * @param query - Pagination and filter parameters.
   * @returns Paginated list of enriched merge queue items.
   */
  @Get()
  @ApiOperation({ summary: "List merge queue items" })
  @ApiQuery({
    name: "page",
    required: false,
    description: "Page number (1-based, default 1)",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Items per page (1-100, default 20)",
  })
  @ApiQuery({
    name: "status",
    required: false,
    description:
      "Filter by status (ENQUEUED, PREPARING, REBASING, VALIDATING, MERGING, MERGED, REQUEUED, FAILED)",
  })
  @ApiQuery({
    name: "repositoryId",
    required: false,
    description: "Filter by repository ID",
  })
  @ApiResponse({
    status: 200,
    description: "Paginated merge queue item list.",
  })
  findAll(@Query() query: MergeQueueFilterQueryDto): PaginatedMergeQueueResponse {
    return this.mergeQueueService.findAll(query.page, query.limit, {
      status: query.status,
      repositoryId: query.repositoryId,
    });
  }
}
