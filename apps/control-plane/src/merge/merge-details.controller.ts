/**
 * REST controller for task merge details.
 *
 * Exposes an endpoint for retrieving merge queue status and validation
 * results for a task. Routes are nested under `/tasks/:taskId/merge`.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T084-api-artifacts-reviews.md}
 */
import { Controller, Get, NotFoundException, Param, Inject } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";

import { MergeDetailsService } from "./merge-details.service.js";
import type { MergeDetailResponse } from "./merge-details.service.js";

/**
 * Handles HTTP requests for task merge details.
 *
 * Provides a single endpoint that returns the merge queue item and
 * all associated validation runs for a task. Returns null for the
 * merge queue item if the task has not been queued for merge.
 */
@ApiTags("merge")
@Controller("tasks/:taskId/merge")
export class MergeDetailsController {
  /** @param mergeDetailsService Injected merge details service. */
  constructor(
    @Inject(MergeDetailsService) private readonly mergeDetailsService: MergeDetailsService,
  ) {}

  /**
   * Get merge details for a task.
   *
   * Returns the merge queue item (if any) and all validation runs.
   * The merge queue item is null if the task has not yet been queued
   * for merge. Validation runs include all lifecycle scopes
   * (pre-merge, post-merge, etc.).
   *
   * @param taskId Task UUID.
   * @returns Merge details with validation runs.
   * @throws NotFoundException if the task does not exist.
   */
  @Get()
  @ApiOperation({ summary: "Get merge details for a task" })
  @ApiParam({ name: "taskId", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Merge queue item and validation runs." })
  @ApiResponse({ status: 404, description: "Task not found." })
  getMergeDetails(@Param("taskId") taskId: string): MergeDetailResponse {
    const details = this.mergeDetailsService.getMergeDetails(taskId);
    if (!details) {
      throw new NotFoundException(`Task with ID "${taskId}" not found`);
    }
    return details;
  }
}
