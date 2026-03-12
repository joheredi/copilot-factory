/**
 * REST controller for task review history.
 *
 * Exposes endpoints for listing all review cycles for a task (with
 * lead review decisions) and retrieving specialist packets for a
 * specific review cycle. Routes are nested under `/tasks/:taskId/reviews`.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T084-api-artifacts-reviews.md}
 */
import { Controller, Get, NotFoundException, Param, Inject } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";

import { ReviewsService } from "./reviews.service.js";
import type { ReviewHistoryResponse, ReviewCyclePacketsResponse } from "./reviews.service.js";

/**
 * Handles HTTP requests for task review history.
 *
 * Provides a review history endpoint listing all review cycles with
 * their lead review decisions and specialist packet counts. Also
 * provides a cycle-level detail endpoint returning all specialist
 * packets and the lead decision for a specific review cycle.
 */
@ApiTags("reviews")
@Controller("tasks/:taskId/reviews")
export class ReviewsController {
  /** @param reviewsService Injected reviews service. */
  constructor(@Inject(ReviewsService) private readonly reviewsService: ReviewsService) {}

  /**
   * Get review cycle history for a task.
   *
   * Returns all review cycles with their lead review decisions and
   * specialist packet counts. Useful for rendering a timeline of
   * review rounds in the UI.
   *
   * @param taskId Task UUID.
   * @returns Review history with enriched cycle data.
   * @throws NotFoundException if the task does not exist.
   */
  @Get()
  @ApiOperation({ summary: "Get review history for a task" })
  @ApiParam({ name: "taskId", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Review cycle history with decisions." })
  @ApiResponse({ status: 404, description: "Task not found." })
  getReviewHistory(@Param("taskId") taskId: string): ReviewHistoryResponse {
    const history = this.reviewsService.getReviewHistory(taskId);
    if (!history) {
      throw new NotFoundException(`Task with ID "${taskId}" not found`);
    }
    return history;
  }

  /**
   * Get specialist packets and lead decision for a specific review cycle.
   *
   * Returns the full specialist review packets and the consolidated
   * lead review decision for a single review cycle. Useful for
   * rendering review detail views in the UI.
   *
   * @param taskId Task UUID.
   * @param cycleId Review cycle UUID.
   * @returns Specialist packets and lead decision for the cycle.
   * @throws NotFoundException if the task or review cycle does not exist.
   */
  @Get(":cycleId/packets")
  @ApiOperation({ summary: "Get packets for a review cycle" })
  @ApiParam({ name: "taskId", description: "Task UUID" })
  @ApiParam({ name: "cycleId", description: "Review cycle UUID" })
  @ApiResponse({ status: 200, description: "Specialist packets and lead decision." })
  @ApiResponse({ status: 404, description: "Task or review cycle not found." })
  getReviewCyclePackets(
    @Param("taskId") taskId: string,
    @Param("cycleId") cycleId: string,
  ): ReviewCyclePacketsResponse {
    const packets = this.reviewsService.getReviewCyclePackets(taskId, cycleId);
    if (!packets) {
      throw new NotFoundException(`Review cycle "${cycleId}" not found for task "${taskId}"`);
    }
    return packets;
  }
}
