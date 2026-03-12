/**
 * REST controller for operator actions on tasks.
 *
 * Exposes endpoints under `/tasks/:id/actions/{action}` for all
 * operator actions defined in §6.2 of the additional refinements PRD.
 * Each endpoint validates the request body, delegates to the
 * {@link OperatorActionsService}, and returns the updated task with
 * the audit event.
 *
 * State transitions are NOT handled through the regular tasks CRUD
 * controller — operator overrides go through this dedicated controller
 * to enforce the actor_type=operator audit trail and apply
 * action-specific precondition checks.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/prd/006-additional-refinements.md} §6.2
 * @see {@link file://docs/backlog/tasks/T101-api-operator-actions.md}
 */
import { Body, Controller, HttpCode, HttpStatus, Param, Post, Inject } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";

import { OperatorActionsService } from "./operator-actions.service.js";
import type { OperatorActionResult } from "./operator-actions.service.js";
import {
  PauseActionDto,
  ResumeActionDto,
  RequeueActionDto,
  ForceUnblockActionDto,
  ChangePriorityActionDto,
  ReassignPoolActionDto,
  RerunReviewActionDto,
  OverrideMergeOrderActionDto,
  ReopenActionDto,
  CancelActionDto,
  ResolveEscalationDto,
} from "./dtos/operator-action.dto.js";

/**
 * Handles HTTP requests for operator actions on tasks.
 *
 * All actions return the updated task entity and the audit event
 * that was recorded. Invalid actions return 400 with a descriptive
 * error message. Tasks that don't exist return 404.
 */
@ApiTags("operator-actions")
@Controller("tasks")
export class OperatorActionsController {
  /** @param service Injected operator actions service. */
  constructor(@Inject(OperatorActionsService) private readonly service: OperatorActionsService) {}

  /**
   * Pause a task (move to ESCALATED).
   *
   * @param id Task UUID.
   * @param dto Validated pause payload with actorId and reason.
   * @returns Updated task and audit event.
   */
  @Post(":id/actions/pause")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Pause a task" })
  @ApiParam({ name: "id", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Task paused (moved to ESCALATED)." })
  @ApiResponse({ status: 400, description: "Invalid action for current state." })
  @ApiResponse({ status: 404, description: "Task not found." })
  pause(@Param("id") id: string, @Body() dto: PauseActionDto): OperatorActionResult {
    return this.service.pause(id, dto.actorId, dto.reason);
  }

  /**
   * Resume a paused/escalated task (move to ASSIGNED).
   *
   * @param id Task UUID.
   * @param dto Validated resume payload with actorId and reason.
   * @returns Updated task and audit event.
   */
  @Post(":id/actions/resume")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Resume an escalated task" })
  @ApiParam({ name: "id", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Task resumed (moved to ASSIGNED)." })
  @ApiResponse({ status: 400, description: "Task is not in ESCALATED state." })
  @ApiResponse({ status: 404, description: "Task not found." })
  resume(@Param("id") id: string, @Body() dto: ResumeActionDto): OperatorActionResult {
    return this.service.resume(id, dto.actorId, dto.reason);
  }

  /**
   * Requeue a task (move back to READY).
   *
   * @param id Task UUID.
   * @param dto Validated requeue payload with actorId and reason.
   * @returns Updated task and audit event.
   */
  @Post(":id/actions/requeue")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Requeue a task" })
  @ApiParam({ name: "id", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Task requeued (moved to READY)." })
  @ApiResponse({ status: 400, description: "Task is not in ASSIGNED or IN_DEVELOPMENT state." })
  @ApiResponse({ status: 404, description: "Task not found." })
  requeue(@Param("id") id: string, @Body() dto: RequeueActionDto): OperatorActionResult {
    return this.service.requeue(id, dto.actorId, dto.reason);
  }

  /**
   * Force-unblock a task (BLOCKED → READY).
   *
   * @param id Task UUID.
   * @param dto Validated unblock payload with actorId and reason.
   * @returns Updated task and audit event.
   */
  @Post(":id/actions/force-unblock")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Force-unblock a blocked task" })
  @ApiParam({ name: "id", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Task unblocked (moved to READY)." })
  @ApiResponse({ status: 400, description: "Task is not in BLOCKED state." })
  @ApiResponse({ status: 404, description: "Task not found." })
  forceUnblock(@Param("id") id: string, @Body() dto: ForceUnblockActionDto): OperatorActionResult {
    return this.service.forceUnblock(id, dto.actorId, dto.reason);
  }

  /**
   * Change a task's priority.
   *
   * @param id Task UUID.
   * @param dto Validated priority change payload.
   * @returns Updated task and audit event.
   */
  @Post(":id/actions/change-priority")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Change task priority" })
  @ApiParam({ name: "id", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Task priority updated." })
  @ApiResponse({ status: 404, description: "Task not found." })
  changePriority(
    @Param("id") id: string,
    @Body() dto: ChangePriorityActionDto,
  ): OperatorActionResult {
    return this.service.changePriority(id, dto);
  }

  /**
   * Reassign a task to a different worker pool.
   *
   * @param id Task UUID.
   * @param dto Validated pool reassignment payload.
   * @returns Task and audit event.
   */
  @Post(":id/actions/reassign-pool")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reassign task to a different pool" })
  @ApiParam({ name: "id", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Pool assignment recorded." })
  @ApiResponse({ status: 400, description: "Task is in a terminal state." })
  @ApiResponse({ status: 404, description: "Task not found." })
  reassignPool(@Param("id") id: string, @Body() dto: ReassignPoolActionDto): OperatorActionResult {
    return this.service.reassignPool(id, dto);
  }

  /**
   * Rerun review for a task (move back to DEV_COMPLETE).
   *
   * @param id Task UUID.
   * @param dto Validated rerun-review payload with actorId and reason.
   * @returns Updated task and audit event.
   */
  @Post(":id/actions/rerun-review")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rerun review for a task" })
  @ApiParam({ name: "id", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Task moved to DEV_COMPLETE for re-review." })
  @ApiResponse({ status: 400, description: "Task is not in APPROVED or IN_REVIEW state." })
  @ApiResponse({ status: 404, description: "Task not found." })
  rerunReview(@Param("id") id: string, @Body() dto: RerunReviewActionDto): OperatorActionResult {
    return this.service.rerunReview(id, dto.actorId, dto.reason);
  }

  /**
   * Override merge queue ordering for a task.
   *
   * @param id Task UUID.
   * @param dto Validated merge order override payload.
   * @returns Task and audit event.
   */
  @Post(":id/actions/override-merge-order")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Override merge queue ordering" })
  @ApiParam({ name: "id", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Merge queue order updated." })
  @ApiResponse({ status: 400, description: "Task not in QUEUED_FOR_MERGE or no queue item." })
  @ApiResponse({ status: 404, description: "Task not found." })
  overrideMergeOrder(
    @Param("id") id: string,
    @Body() dto: OverrideMergeOrderActionDto,
  ): OperatorActionResult {
    return this.service.overrideMergeOrder(id, dto);
  }

  /**
   * Reopen a task from a terminal state.
   *
   * @param id Task UUID.
   * @param dto Validated reopen payload with actorId and reason.
   * @returns Updated task and audit event.
   */
  @Post(":id/actions/reopen")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reopen a completed/failed/cancelled task" })
  @ApiParam({ name: "id", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Task reopened (moved to BACKLOG)." })
  @ApiResponse({ status: 400, description: "Task is not in DONE, FAILED, or CANCELLED state." })
  @ApiResponse({ status: 404, description: "Task not found." })
  reopen(@Param("id") id: string, @Body() dto: ReopenActionDto): OperatorActionResult {
    return this.service.reopen(id, dto.actorId, dto.reason);
  }

  /**
   * Cancel a task.
   *
   * @param id Task UUID.
   * @param dto Validated cancel payload with actorId and reason.
   * @returns Updated task and audit event.
   */
  @Post(":id/actions/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancel a task" })
  @ApiParam({ name: "id", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Task cancelled." })
  @ApiResponse({
    status: 400,
    description:
      "Task is already in a terminal state, in MERGING, or has in-progress work without acknowledgment.",
  })
  @ApiResponse({ status: 404, description: "Task not found." })
  cancel(@Param("id") id: string, @Body() dto: CancelActionDto): OperatorActionResult {
    return this.service.cancel(id, dto.actorId, dto.reason, dto.acknowledgeInProgressWork);
  }

  /**
   * Resolve an escalated task with a chosen resolution strategy.
   *
   * Supports three resolution types:
   * - `retry`: Move back to ASSIGNED for a new development attempt,
   *   optionally with a different worker pool.
   * - `cancel`: Move to CANCELLED, preserving escalation context.
   * - `mark_done`: Mark as externally completed (requires evidence).
   *
   * @param id Task UUID.
   * @param dto Validated escalation resolution payload.
   * @returns Updated task and audit event.
   */
  @Post(":id/actions/resolve-escalation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Resolve an escalated task" })
  @ApiParam({ name: "id", description: "Task UUID" })
  @ApiResponse({
    status: 200,
    description: "Escalation resolved. Task moved to the target state.",
  })
  @ApiResponse({ status: 400, description: "Task is not in ESCALATED state or invalid payload." })
  @ApiResponse({ status: 404, description: "Task not found." })
  resolveEscalation(
    @Param("id") id: string,
    @Body() dto: ResolveEscalationDto,
  ): OperatorActionResult {
    return this.service.resolveEscalation(id, dto);
  }
}
