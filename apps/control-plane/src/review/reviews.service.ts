/**
 * Service layer for review cycle history and specialist packet retrieval.
 *
 * Provides read-only access to review cycles and their associated specialist
 * review packets and lead review decisions. Enriches review cycle listings
 * with decision summaries for UI consumption.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T084-api-artifacts-reviews.md}
 */
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import { createReviewCycleRepository } from "../infrastructure/repositories/review-cycle.repository.js";
import { createReviewPacketRepository } from "../infrastructure/repositories/review-packet.repository.js";
import { createLeadReviewDecisionRepository } from "../infrastructure/repositories/lead-review-decision.repository.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import type { ReviewCycle } from "../infrastructure/repositories/review-cycle.repository.js";
import type { ReviewPacket } from "../infrastructure/repositories/review-packet.repository.js";
import type { LeadReviewDecision } from "../infrastructure/repositories/lead-review-decision.repository.js";

/** A review cycle enriched with its lead review decision, if any. */
export interface ReviewCycleWithDecision {
  /** The review cycle entity. */
  reviewCycle: ReviewCycle;
  /** The lead review decision for this cycle, or null if not yet rendered. */
  leadReviewDecision: LeadReviewDecision | null;
  /** Count of specialist review packets submitted for this cycle. */
  specialistPacketCount: number;
}

/** Response for the review history endpoint. */
export interface ReviewHistoryResponse {
  /** The task these review cycles belong to. */
  taskId: string;
  /** All review cycles ordered by creation time. */
  reviewCycles: ReviewCycleWithDecision[];
}

/** Response for the review cycle packets endpoint. */
export interface ReviewCyclePacketsResponse {
  /** The task ID. */
  taskId: string;
  /** The review cycle ID. */
  reviewCycleId: string;
  /** Specialist review packets for this cycle. */
  specialistPackets: ReviewPacket[];
  /** Lead review decision for this cycle, if any. */
  leadReviewDecision: LeadReviewDecision | null;
}

/**
 * Provides read-only access to review cycle history and specialist packets.
 *
 * Enriches review cycle listings with lead review decisions and packet
 * counts for efficient UI rendering without extra round-trips.
 */
@Injectable()
export class ReviewsService {
  /** @param conn Injected database connection. */
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection) {}

  /**
   * Get the full review history for a task.
   *
   * Returns all review cycles ordered by creation time, each enriched
   * with its lead review decision (if any) and the count of specialist
   * packets submitted.
   *
   * @param taskId Task UUID.
   * @returns Review history response, or `undefined` if task not found.
   */
  getReviewHistory(taskId: string): ReviewHistoryResponse | undefined {
    const taskRepo = createTaskRepository(this.conn.db);
    const task = taskRepo.findById(taskId);
    if (!task) {
      return undefined;
    }

    const cycleRepo = createReviewCycleRepository(this.conn.db);
    const packetRepo = createReviewPacketRepository(this.conn.db);
    const decisionRepo = createLeadReviewDecisionRepository(this.conn.db);

    const cycles = cycleRepo.findByTaskId(taskId);
    const enriched: ReviewCycleWithDecision[] = cycles.map((cycle) => {
      const packets = packetRepo.findByReviewCycleId(cycle.reviewCycleId);
      const decision = decisionRepo.findByReviewCycleId(cycle.reviewCycleId);
      return {
        reviewCycle: cycle,
        leadReviewDecision: decision ?? null,
        specialistPacketCount: packets.length,
      };
    });

    return {
      taskId,
      reviewCycles: enriched,
    };
  }

  /**
   * Get all specialist packets and the lead decision for a specific review cycle.
   *
   * @param taskId Task UUID (used to verify ownership).
   * @param cycleId Review cycle UUID.
   * @returns Review cycle packets response, or `undefined` if not found.
   */
  getReviewCyclePackets(taskId: string, cycleId: string): ReviewCyclePacketsResponse | undefined {
    const taskRepo = createTaskRepository(this.conn.db);
    const task = taskRepo.findById(taskId);
    if (!task) {
      return undefined;
    }

    const cycleRepo = createReviewCycleRepository(this.conn.db);
    const cycle = cycleRepo.findById(cycleId);
    if (!cycle || cycle.taskId !== taskId) {
      return undefined;
    }

    const packetRepo = createReviewPacketRepository(this.conn.db);
    const decisionRepo = createLeadReviewDecisionRepository(this.conn.db);

    const specialistPackets = packetRepo.findByReviewCycleId(cycleId);
    const leadDecision = decisionRepo.findByReviewCycleId(cycleId);

    return {
      taskId,
      reviewCycleId: cycleId,
      specialistPackets,
      leadReviewDecision: leadDecision ?? null,
    };
  }
}
