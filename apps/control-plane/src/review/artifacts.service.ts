/**
 * Service layer for assembling artifact trees and retrieving parsed packet content.
 *
 * Aggregates artifact metadata from multiple database tables (review packets,
 * lead review decisions, validation runs, merge queue items) to present a
 * unified artifact tree for a task. Also provides packet content retrieval
 * by searching across packet-bearing tables.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T084-api-artifacts-reviews.md}
 */
import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import { createReviewPacketRepository } from "../infrastructure/repositories/review-packet.repository.js";
import { createLeadReviewDecisionRepository } from "../infrastructure/repositories/lead-review-decision.repository.js";
import { createValidationRunRepository } from "../infrastructure/repositories/validation-run.repository.js";
import { createMergeQueueItemRepository } from "../infrastructure/repositories/merge-queue-item.repository.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import type { ReviewPacket } from "../infrastructure/repositories/review-packet.repository.js";
import type { LeadReviewDecision } from "../infrastructure/repositories/lead-review-decision.repository.js";
import type { ValidationRun } from "../infrastructure/repositories/validation-run.repository.js";
import type { MergeQueueItem } from "../infrastructure/repositories/merge-queue-item.repository.js";

/** Summary of a review packet in the artifact tree. */
export interface ReviewPacketSummary {
  /** Review packet primary key. */
  reviewPacketId: string;
  /** The review cycle this packet belongs to. */
  reviewCycleId: string;
  /** Reviewer type (e.g., "security", "architecture"). */
  reviewerType: string;
  /** Specialist verdict. */
  verdict: string;
  /** When the packet was created. */
  createdAt: Date;
}

/** Summary of a lead review decision in the artifact tree. */
export interface LeadReviewDecisionSummary {
  /** Lead review decision primary key. */
  leadReviewDecisionId: string;
  /** The review cycle this decision consolidates. */
  reviewCycleId: string;
  /** Consolidated decision. */
  decision: string;
  /** Count of blocking issues identified. */
  blockingIssueCount: number;
  /** Count of non-blocking issues. */
  nonBlockingIssueCount: number;
  /** When the decision was created. */
  createdAt: Date;
}

/** Summary of a validation run in the artifact tree. */
export interface ValidationRunSummary {
  /** Validation run primary key. */
  validationRunId: string;
  /** Lifecycle scope (e.g., "pre-merge", "post-merge"). */
  runScope: string;
  /** Overall status of the validation run. */
  status: string;
  /** When the run started. */
  startedAt: Date;
}

/** Summary of a merge queue item in the artifact tree. */
export interface MergeQueueItemSummary {
  /** Merge queue item primary key. */
  mergeQueueItemId: string;
  /** Queue position. */
  position: number;
  /** Current status. */
  status: string;
  /** When the item was enqueued. */
  enqueuedAt: Date;
}

/**
 * Unified artifact tree response showing all artifact types for a task,
 * organized by category.
 */
export interface ArtifactTree {
  /** The task these artifacts belong to. */
  taskId: string;
  /** Specialist review packets across all review cycles. */
  reviewPackets: ReviewPacketSummary[];
  /** Lead review decisions across all review cycles. */
  leadReviewDecisions: LeadReviewDecisionSummary[];
  /** Validation runs at various lifecycle gates. */
  validationRuns: ValidationRunSummary[];
  /** Merge queue item, if the task has been queued for merge. */
  mergeQueueItem: MergeQueueItemSummary | null;
}

/** Parsed packet content with type metadata. */
export interface PacketContent {
  /** The packet identifier. */
  packetId: string;
  /** Discriminator indicating which table the packet came from. */
  packetSource: "review_packet" | "lead_review_decision";
  /** The full parsed JSON packet content. */
  content: unknown;
}

/**
 * Assembles artifact trees from database records and retrieves parsed
 * packet content by searching across packet-bearing tables.
 */
@Injectable()
export class ArtifactsService {
  /** @param conn Injected database connection. */
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection) {}

  /**
   * Build an artifact tree for a task, aggregating metadata from review
   * packets, lead decisions, validation runs, and merge queue items.
   *
   * @param taskId Task UUID.
   * @returns The assembled artifact tree, or `undefined` if the task does not exist.
   */
  getArtifactTree(taskId: string): ArtifactTree | undefined {
    const taskRepo = createTaskRepository(this.conn.db);
    const task = taskRepo.findById(taskId);
    if (!task) {
      return undefined;
    }

    const reviewPacketRepo = createReviewPacketRepository(this.conn.db);
    const leadDecisionRepo = createLeadReviewDecisionRepository(this.conn.db);
    const validationRunRepo = createValidationRunRepository(this.conn.db);
    const mergeQueueRepo = createMergeQueueItemRepository(this.conn.db);

    const reviewPackets = reviewPacketRepo.findByTaskId(taskId);
    const leadDecisions = leadDecisionRepo.findByTaskId(taskId);
    const validationRuns = validationRunRepo.findByTaskId(taskId);
    const mergeQueueItem = mergeQueueRepo.findByTaskId(taskId);

    return {
      taskId,
      reviewPackets: reviewPackets.map(toReviewPacketSummary),
      leadReviewDecisions: leadDecisions.map(toLeadReviewDecisionSummary),
      validationRuns: validationRuns.map(toValidationRunSummary),
      mergeQueueItem: mergeQueueItem ? toMergeQueueItemSummary(mergeQueueItem) : null,
    };
  }

  /**
   * Retrieve parsed packet content by packet ID.
   *
   * Searches across the review_packet and lead_review_decision tables
   * for a matching ID. Returns the parsed `packetJson` content along
   * with source metadata.
   *
   * @param taskId Task UUID (used to scope the search).
   * @param packetId Packet UUID — either a reviewPacketId or leadReviewDecisionId.
   * @returns The parsed packet content, or `undefined` if not found.
   * @throws NotFoundException if the task does not exist.
   */
  getPacketContent(taskId: string, packetId: string): PacketContent | undefined {
    const taskRepo = createTaskRepository(this.conn.db);
    const task = taskRepo.findById(taskId);
    if (!task) {
      throw new NotFoundException(`Task with ID "${taskId}" not found`);
    }

    // Search review packets first
    const reviewPacketRepo = createReviewPacketRepository(this.conn.db);
    const reviewPacket = reviewPacketRepo.findById(packetId);
    if (reviewPacket && reviewPacket.taskId === taskId) {
      return {
        packetId,
        packetSource: "review_packet",
        content: reviewPacket.packetJson,
      };
    }

    // Then search lead review decisions
    const leadDecisionRepo = createLeadReviewDecisionRepository(this.conn.db);
    const leadDecision = leadDecisionRepo.findById(packetId);
    if (leadDecision && leadDecision.taskId === taskId) {
      return {
        packetId,
        packetSource: "lead_review_decision",
        content: leadDecision.packetJson,
      };
    }

    return undefined;
  }
}

/**
 * Map a full review packet row to its summary representation.
 *
 * @param rp Review packet database row.
 * @returns Summary with key metadata fields.
 */
function toReviewPacketSummary(rp: ReviewPacket): ReviewPacketSummary {
  return {
    reviewPacketId: rp.reviewPacketId,
    reviewCycleId: rp.reviewCycleId,
    reviewerType: rp.reviewerType,
    verdict: rp.verdict,
    createdAt: rp.createdAt,
  };
}

/**
 * Map a full lead review decision row to its summary representation.
 *
 * @param ld Lead review decision database row.
 * @returns Summary with key metadata fields.
 */
function toLeadReviewDecisionSummary(ld: LeadReviewDecision): LeadReviewDecisionSummary {
  return {
    leadReviewDecisionId: ld.leadReviewDecisionId,
    reviewCycleId: ld.reviewCycleId,
    decision: ld.decision,
    blockingIssueCount: ld.blockingIssueCount,
    nonBlockingIssueCount: ld.nonBlockingIssueCount,
    createdAt: ld.createdAt,
  };
}

/**
 * Map a full validation run row to its summary representation.
 *
 * @param vr Validation run database row.
 * @returns Summary with key metadata fields.
 */
function toValidationRunSummary(vr: ValidationRun): ValidationRunSummary {
  return {
    validationRunId: vr.validationRunId,
    runScope: vr.runScope,
    status: vr.status,
    startedAt: vr.startedAt,
  };
}

/**
 * Map a full merge queue item row to its summary representation.
 *
 * @param mqi Merge queue item database row.
 * @returns Summary with key metadata fields.
 */
function toMergeQueueItemSummary(mqi: MergeQueueItem): MergeQueueItemSummary {
  return {
    mergeQueueItemId: mqi.mergeQueueItemId,
    position: mqi.position,
    status: mqi.status,
    enqueuedAt: mqi.enqueuedAt,
  };
}
