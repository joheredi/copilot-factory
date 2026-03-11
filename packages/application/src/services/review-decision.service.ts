/**
 * Review decision application service — processes the lead reviewer's
 * decision and applies it to the task and review cycle state.
 *
 * When the lead reviewer completes their consolidated review, this service:
 *
 * 1. Validates the LeadReviewDecisionPacket against its Zod schema
 * 2. Within a single atomic transaction:
 *    a. Fetches and validates the task (must be IN_REVIEW)
 *    b. Fetches and validates the review cycle (must be CONSOLIDATING)
 *    c. Verifies the packet targets the current active review cycle
 *    d. Persists a LeadReviewDecision record
 *    e. Applies the decision:
 *       - `approved` / `approved_with_follow_up`: ReviewCycle→APPROVED, Task→APPROVED
 *       - `changes_requested`: check escalation policy; if exceeded ReviewCycle→ESCALATED,
 *         Task→ESCALATED; else ReviewCycle→REJECTED, Task→CHANGES_REQUESTED,
 *         increment reviewRoundCount
 *       - `escalated`: ReviewCycle→ESCALATED, Task→ESCALATED
 *    f. For `approved_with_follow_up`: creates skeleton follow-up tasks
 *    g. Records audit events for all transitions
 * 3. Emits domain events after the transaction commits
 *
 * All database reads and writes occur within a single transaction to
 * guarantee atomicity per §10.3.
 *
 * @see docs/prd/002-data-model.md §2.1, §2.2, §2.5 — Task & ReviewCycle States
 * @see docs/prd/004-agent-contracts.md §4.7 — Lead Reviewer Contract
 * @see docs/prd/007-technical-architecture.md §7.7 — ApplyLeadReviewDecisionCommand
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.7 — Escalation Policy
 * @see docs/backlog/tasks/T061-review-decision-apply.md
 *
 * @module @factory/application/services/review-decision
 */

import {
  TaskStatus,
  ReviewCycleStatus,
  LeadReviewDecision,
  validateTransition,
  validateReviewCycleTransition,
  EscalationTrigger,
  shouldEscalate,
} from "@factory/domain";
import type {
  TransitionContext,
  ReviewCycleTransitionContext,
  EscalationPolicy,
} from "@factory/domain";
import { LeadReviewDecisionPacketSchema } from "@factory/schemas";
import type { LeadReviewDecisionPacket } from "@factory/schemas";

import type { ActorInfo, DomainEvent } from "../events/domain-events.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type {
  ReviewDecisionUnitOfWork,
  ReviewDecisionTransactionRepositories,
  ReviewDecisionTask,
  ReviewDecisionCycle,
  ReviewDecisionAuditEvent,
  LeadReviewDecisionRecord,
  FollowUpTaskRecord,
} from "../ports/review-decision.ports.js";
import { EntityNotFoundError, InvalidTransitionError } from "../errors.js";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

/**
 * Parameters for applying a lead review decision.
 *
 * The caller provides the raw packet, the task and review cycle
 * identifiers (for cross-referencing), escalation policy for
 * review round limit checks, the maximum review rounds from the
 * review policy, and the actor triggering the application.
 */
export interface ApplyReviewDecisionParams {
  /** The raw LeadReviewDecisionPacket to validate and apply. */
  readonly packet: unknown;

  /** The task under review — used for cross-referencing with the packet. */
  readonly taskId: string;

  /** The review cycle this decision concludes. */
  readonly reviewCycleId: string;

  /** The effective escalation policy for this task. */
  readonly escalationPolicy: EscalationPolicy;

  /**
   * Maximum review rounds from the review policy.
   * Used to evaluate the MAX_REVIEW_ROUNDS_EXCEEDED trigger.
   */
  readonly maxReviewRounds: number;

  /** The actor applying the decision (typically system/scheduler). */
  readonly actor: ActorInfo;
}

/**
 * Outcome type indicating what decision was applied.
 */
export type ReviewDecisionOutcome =
  | "approved"
  | "approved_with_follow_up"
  | "changes_requested"
  | "escalated"
  | "escalated_from_review_limit";

/**
 * Result of a successful review decision application.
 *
 * Contains all the state changes that occurred: the updated task,
 * review cycle, persisted decision record, any follow-up tasks,
 * and audit events.
 */
export interface ApplyReviewDecisionResult {
  /** The outcome of the decision application. */
  readonly outcome: ReviewDecisionOutcome;

  /** The updated task after the decision was applied. */
  readonly task: ReviewDecisionTask;

  /** The updated review cycle after the decision was applied. */
  readonly reviewCycle: ReviewDecisionCycle;

  /** The persisted lead review decision record. */
  readonly decisionRecord: LeadReviewDecisionRecord;

  /** Follow-up tasks created (only for approved_with_follow_up). */
  readonly followUpTasks: readonly FollowUpTaskRecord[];

  /** Audit events recorded during the decision application. */
  readonly auditEvents: readonly ReviewDecisionAuditEvent[];
}

/**
 * The review decision application service interface.
 *
 * Exposes a single orchestration method that validates the packet,
 * applies the decision atomically, and emits domain events.
 */
export interface ReviewDecisionService {
  /**
   * Apply a lead review decision to a task and its review cycle.
   *
   * Validates the packet, determines the appropriate state transitions,
   * checks escalation policy for review round limits, and persists all
   * changes atomically.
   *
   * @param params - The decision application parameters
   * @returns The result of the decision application
   * @throws {SchemaValidationError} if the packet fails Zod validation
   * @throws {EntityNotFoundError} if the task or review cycle doesn't exist
   * @throws {InvalidTransitionError} if the state transitions are invalid
   */
  applyDecision(params: ApplyReviewDecisionParams): ApplyReviewDecisionResult;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into the review decision service factory.
 */
export interface ReviewDecisionDependencies {
  /** Unit of work for atomic multi-entity operations. */
  readonly unitOfWork: ReviewDecisionUnitOfWork;

  /** Event emitter for post-commit domain event publication. */
  readonly eventEmitter: DomainEventEmitter;

  /** ID generator for creating unique identifiers (injected for testability). */
  readonly idGenerator?: () => string;

  /** Clock function for timestamps (injected for testability). */
  readonly clock?: () => Date;
}

// ---------------------------------------------------------------------------
// Schema validation error
// ---------------------------------------------------------------------------

/**
 * Thrown when the LeadReviewDecisionPacket fails Zod schema validation.
 *
 * Contains the structured Zod error issues for diagnostic purposes.
 */
export class SchemaValidationError extends Error {
  public readonly issues: readonly { path: (string | number)[]; message: string }[];

  constructor(issues: readonly { path: (string | number)[]; message: string }[]) {
    const summary = issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    super(`LeadReviewDecisionPacket validation failed: ${summary}`);
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validates the raw packet against the LeadReviewDecisionPacket Zod schema.
 *
 * @throws {SchemaValidationError} if validation fails
 * @returns The validated and typed packet
 */
function validatePacket(raw: unknown): LeadReviewDecisionPacket {
  const result = LeadReviewDecisionPacketSchema.safeParse(raw);
  if (!result.success) {
    throw new SchemaValidationError(
      result.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  return result.data;
}

/**
 * Maps a lead review decision to the target review cycle status.
 *
 * - approved / approved_with_follow_up → APPROVED
 * - changes_requested → REJECTED (unless escalated by policy)
 * - escalated → ESCALATED
 */
function getReviewCycleTargetStatus(
  decision: LeadReviewDecisionPacket["decision"],
  shouldEscalateFromPolicy: boolean,
): ReviewCycleStatus {
  switch (decision) {
    case LeadReviewDecision.APPROVED:
    case LeadReviewDecision.APPROVED_WITH_FOLLOW_UP:
      return ReviewCycleStatus.APPROVED;
    case LeadReviewDecision.CHANGES_REQUESTED:
      return shouldEscalateFromPolicy ? ReviewCycleStatus.ESCALATED : ReviewCycleStatus.REJECTED;
    case LeadReviewDecision.ESCALATED:
      return ReviewCycleStatus.ESCALATED;
  }
}

/**
 * Maps a lead review decision to the target task status.
 *
 * - approved / approved_with_follow_up → APPROVED
 * - changes_requested → CHANGES_REQUESTED (unless escalated by policy)
 * - escalated → ESCALATED
 */
function getTaskTargetStatus(
  decision: LeadReviewDecisionPacket["decision"],
  shouldEscalateFromPolicy: boolean,
): TaskStatus {
  switch (decision) {
    case LeadReviewDecision.APPROVED:
    case LeadReviewDecision.APPROVED_WITH_FOLLOW_UP:
      return TaskStatus.APPROVED;
    case LeadReviewDecision.CHANGES_REQUESTED:
      return shouldEscalateFromPolicy ? TaskStatus.ESCALATED : TaskStatus.CHANGES_REQUESTED;
    case LeadReviewDecision.ESCALATED:
      return TaskStatus.ESCALATED;
  }
}

/**
 * Maps a lead review decision to the transition context for the task
 * state machine guard.
 */
function getTaskTransitionContext(
  decision: LeadReviewDecisionPacket["decision"],
  shouldEscalateFromPolicy: boolean,
): TransitionContext {
  switch (decision) {
    case LeadReviewDecision.APPROVED:
    case LeadReviewDecision.APPROVED_WITH_FOLLOW_UP:
      return { leadReviewDecision: decision };
    case LeadReviewDecision.CHANGES_REQUESTED:
      if (shouldEscalateFromPolicy) {
        return { hasEscalationTrigger: true };
      }
      return { leadReviewDecision: "changes_requested" };
    case LeadReviewDecision.ESCALATED:
      return { hasEscalationTrigger: true };
  }
}

/**
 * Maps a lead review decision to the review cycle transition context
 * for the review cycle state machine guard.
 */
function getReviewCycleTransitionContext(
  decision: LeadReviewDecisionPacket["decision"],
  shouldEscalateFromPolicy: boolean,
): ReviewCycleTransitionContext {
  switch (decision) {
    case LeadReviewDecision.APPROVED:
    case LeadReviewDecision.APPROVED_WITH_FOLLOW_UP:
      return { leadReviewDecision: decision };
    case LeadReviewDecision.CHANGES_REQUESTED:
      if (shouldEscalateFromPolicy) {
        return { leadReviewDecision: "escalated" };
      }
      return { leadReviewDecision: "rejected" };
    case LeadReviewDecision.ESCALATED:
      return { leadReviewDecision: "escalated" };
  }
}

/**
 * Determines the outcome label for the decision application.
 */
function getOutcome(
  decision: LeadReviewDecisionPacket["decision"],
  shouldEscalateFromPolicy: boolean,
): ReviewDecisionOutcome {
  switch (decision) {
    case LeadReviewDecision.APPROVED:
      return "approved";
    case LeadReviewDecision.APPROVED_WITH_FOLLOW_UP:
      return "approved_with_follow_up";
    case LeadReviewDecision.CHANGES_REQUESTED:
      return shouldEscalateFromPolicy ? "escalated_from_review_limit" : "changes_requested";
    case LeadReviewDecision.ESCALATED:
      return "escalated";
  }
}

// ---------------------------------------------------------------------------
// Transaction logic
// ---------------------------------------------------------------------------

/**
 * Core transactional logic for applying a review decision.
 *
 * This function is extracted for testability and clarity — it contains
 * all reads and writes that must be atomic.
 */
function applyDecisionInTransaction(
  repos: ReviewDecisionTransactionRepositories,
  packet: LeadReviewDecisionPacket,
  params: ApplyReviewDecisionParams,
  idGenerator: () => string,
): {
  readonly task: ReviewDecisionTask;
  readonly reviewCycle: ReviewDecisionCycle;
  readonly decisionRecord: LeadReviewDecisionRecord;
  readonly followUpTasks: readonly FollowUpTaskRecord[];
  readonly auditEvents: readonly ReviewDecisionAuditEvent[];
  readonly outcome: ReviewDecisionOutcome;
  readonly previousTaskStatus: TaskStatus;
  readonly previousCycleStatus: ReviewCycleStatus;
  readonly taskTargetStatus: TaskStatus;
  readonly cycleTargetStatus: ReviewCycleStatus;
} {
  // ── 1. Fetch and validate the task ──────────────────────────────
  const task = repos.task.findById(params.taskId);
  if (!task) {
    throw new EntityNotFoundError("Task", params.taskId);
  }

  if (task.status !== TaskStatus.IN_REVIEW) {
    throw new InvalidTransitionError(
      "Task",
      params.taskId,
      task.status,
      "APPROVED|CHANGES_REQUESTED|ESCALATED",
      `Task must be in IN_REVIEW state to apply a review decision, but is ${task.status}`,
    );
  }

  // ── 2. Verify review cycle ─────────────────────────────────────
  const cycle = repos.reviewCycle.findById(params.reviewCycleId);
  if (!cycle) {
    throw new EntityNotFoundError("ReviewCycle", params.reviewCycleId);
  }

  if (cycle.taskId !== params.taskId) {
    throw new EntityNotFoundError(
      "ReviewCycle",
      `${params.reviewCycleId} (not associated with task ${params.taskId})`,
    );
  }

  if (cycle.status !== ReviewCycleStatus.CONSOLIDATING) {
    throw new InvalidTransitionError(
      "ReviewCycle",
      params.reviewCycleId,
      cycle.status,
      "APPROVED|REJECTED|ESCALATED",
      `ReviewCycle must be in CONSOLIDATING state, but is ${cycle.status}`,
    );
  }

  // Verify the packet targets the current active review cycle
  if (task.currentReviewCycleId !== null && task.currentReviewCycleId !== params.reviewCycleId) {
    throw new InvalidTransitionError(
      "ReviewCycle",
      params.reviewCycleId,
      cycle.status,
      "APPROVED|REJECTED|ESCALATED",
      `Review cycle ${params.reviewCycleId} is not the current active cycle (${task.currentReviewCycleId}) for task ${params.taskId}`,
    );
  }

  // Cross-reference packet IDs with params
  if (packet.task_id !== params.taskId) {
    throw new InvalidTransitionError(
      "Task",
      params.taskId,
      task.status,
      "APPROVED|CHANGES_REQUESTED|ESCALATED",
      `Packet task_id "${packet.task_id}" does not match expected task "${params.taskId}"`,
    );
  }

  if (packet.review_cycle_id !== params.reviewCycleId) {
    throw new InvalidTransitionError(
      "ReviewCycle",
      params.reviewCycleId,
      cycle.status,
      "APPROVED|REJECTED|ESCALATED",
      `Packet review_cycle_id "${packet.review_cycle_id}" does not match expected cycle "${params.reviewCycleId}"`,
    );
  }

  // ── 3. Evaluate escalation policy for changes_requested ─────────
  let policyEscalation = false;
  if (packet.decision === LeadReviewDecision.CHANGES_REQUESTED) {
    // The next review round count after incrementing
    const nextReviewRound = task.reviewRoundCount + 1;
    const escalationResult = shouldEscalate(
      {
        trigger: EscalationTrigger.MAX_REVIEW_ROUNDS_EXCEEDED,
        review_round: nextReviewRound,
        max_review_rounds: params.maxReviewRounds,
      },
      params.escalationPolicy,
    );
    policyEscalation = escalationResult.should_escalate;
  }

  // ── 4. Determine target states ──────────────────────────────────
  const cycleTargetStatus = getReviewCycleTargetStatus(packet.decision, policyEscalation);
  const taskTargetStatus = getTaskTargetStatus(packet.decision, policyEscalation);

  // ── 5. Validate state machine transitions ───────────────────────
  const cycleTransitionContext = getReviewCycleTransitionContext(packet.decision, policyEscalation);
  const cycleValidation = validateReviewCycleTransition(
    ReviewCycleStatus.CONSOLIDATING,
    cycleTargetStatus,
    cycleTransitionContext,
  );
  if (!cycleValidation.valid) {
    throw new InvalidTransitionError(
      "ReviewCycle",
      params.reviewCycleId,
      ReviewCycleStatus.CONSOLIDATING,
      cycleTargetStatus,
      cycleValidation.reason,
    );
  }

  const taskTransitionContext = getTaskTransitionContext(packet.decision, policyEscalation);
  const taskValidation = validateTransition(
    TaskStatus.IN_REVIEW,
    taskTargetStatus,
    taskTransitionContext,
  );
  if (!taskValidation.valid) {
    throw new InvalidTransitionError(
      "Task",
      params.taskId,
      TaskStatus.IN_REVIEW,
      taskTargetStatus,
      taskValidation.reason,
    );
  }

  // ── 6. Persist the LeadReviewDecision record ────────────────────
  const decisionRecord = repos.leadReviewDecision.create({
    leadReviewDecisionId: idGenerator(),
    reviewCycleId: params.reviewCycleId,
    taskId: params.taskId,
    decision: packet.decision,
    summary: packet.summary,
    blockingIssueCount: packet.blocking_issues.length,
    nonBlockingIssueCount: packet.non_blocking_suggestions.length,
    followUpTaskRefs: packet.follow_up_task_refs,
    packetJson: packet,
  });

  // ── 7. Transition the review cycle ──────────────────────────────
  const previousCycleStatus = cycle.status;
  const updatedCycle = repos.reviewCycle.updateStatus(
    params.reviewCycleId,
    ReviewCycleStatus.CONSOLIDATING,
    cycleTargetStatus,
  );
  if (!updatedCycle) {
    throw new InvalidTransitionError(
      "ReviewCycle",
      params.reviewCycleId,
      ReviewCycleStatus.CONSOLIDATING,
      cycleTargetStatus,
      "Status update failed — concurrent modification detected",
    );
  }

  // ── 8. For changes_requested (non-escalated): increment reviewRoundCount ──
  let updatedTask: ReviewDecisionTask;
  const previousTaskStatus = task.status;

  if (packet.decision === LeadReviewDecision.CHANGES_REQUESTED && !policyEscalation) {
    // Increment review round count first (using current version)
    const taskAfterIncrement = repos.task.incrementReviewRoundCount(params.taskId, task.version);
    if (!taskAfterIncrement) {
      throw new InvalidTransitionError(
        "Task",
        params.taskId,
        task.status,
        taskTargetStatus,
        "Failed to increment reviewRoundCount — concurrent modification detected",
      );
    }

    // Then transition task status (using new version after increment)
    const taskAfterTransition = repos.task.updateStatus(
      params.taskId,
      taskAfterIncrement.version,
      taskTargetStatus,
    );
    if (!taskAfterTransition) {
      throw new InvalidTransitionError(
        "Task",
        params.taskId,
        task.status,
        taskTargetStatus,
        "Task status update failed — concurrent modification detected",
      );
    }
    updatedTask = taskAfterTransition;
  } else {
    // For approved, approved_with_follow_up, escalated — just transition
    const taskAfterTransition = repos.task.updateStatus(
      params.taskId,
      task.version,
      taskTargetStatus,
    );
    if (!taskAfterTransition) {
      throw new InvalidTransitionError(
        "Task",
        params.taskId,
        task.status,
        taskTargetStatus,
        "Task status update failed — concurrent modification detected",
      );
    }
    updatedTask = taskAfterTransition;
  }

  // ── 9. Create follow-up tasks for approved_with_follow_up ───────
  const followUpTasks: FollowUpTaskRecord[] = [];
  if (packet.decision === LeadReviewDecision.APPROVED_WITH_FOLLOW_UP) {
    for (const taskRef of packet.follow_up_task_refs) {
      const followUpTask = repos.followUpTask.create({
        id: idGenerator(),
        projectId: task.projectId,
        title: taskRef,
        parentTaskId: params.taskId,
        source: "review_follow_up",
      });
      followUpTasks.push(followUpTask);
    }
  }

  // ── 10. Record audit events ─────────────────────────────────────
  const auditEvents: ReviewDecisionAuditEvent[] = [];

  // Audit event for review cycle transition
  const cycleAudit = repos.auditEvent.create({
    entityType: "review-cycle",
    entityId: params.reviewCycleId,
    eventType: `review-cycle.decision-applied.${packet.decision}`,
    actorType: params.actor.type,
    actorId: params.actor.id,
    oldState: previousCycleStatus,
    newState: cycleTargetStatus,
    metadata: JSON.stringify({
      taskId: params.taskId,
      decision: packet.decision,
      blockingIssueCount: packet.blocking_issues.length,
      nonBlockingIssueCount: packet.non_blocking_suggestions.length,
      followUpTaskCount: followUpTasks.length,
      policyEscalation,
    }),
  });
  auditEvents.push(cycleAudit);

  // Audit event for task transition
  const taskAudit = repos.auditEvent.create({
    entityType: "task",
    entityId: params.taskId,
    eventType: `task.review-decision.${packet.decision}`,
    actorType: params.actor.type,
    actorId: params.actor.id,
    oldState: previousTaskStatus,
    newState: taskTargetStatus,
    metadata: JSON.stringify({
      reviewCycleId: params.reviewCycleId,
      decision: packet.decision,
      outcome: getOutcome(packet.decision, policyEscalation),
      reviewRoundCount: updatedTask.reviewRoundCount,
    }),
  });
  auditEvents.push(taskAudit);

  const outcome = getOutcome(packet.decision, policyEscalation);

  return {
    task: updatedTask,
    reviewCycle: updatedCycle,
    decisionRecord,
    followUpTasks,
    auditEvents,
    outcome,
    previousTaskStatus,
    previousCycleStatus,
    taskTargetStatus,
    cycleTargetStatus,
  };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

/**
 * Creates a ReviewDecisionService instance.
 *
 * The service orchestrates the full review decision application workflow:
 * packet validation → entity verification → escalation policy check →
 * state transitions → decision persistence → follow-up task creation →
 * audit recording, all within a single atomic transaction.
 *
 * @param deps - Injected dependencies
 * @returns A ReviewDecisionService instance
 *
 * @example
 * ```ts
 * const service = createReviewDecisionService({
 *   unitOfWork,
 *   eventEmitter,
 * });
 *
 * const result = service.applyDecision({
 *   packet: leadReviewDecisionPacket,
 *   taskId: "task-123",
 *   reviewCycleId: "cycle-456",
 *   escalationPolicy: defaultPolicy,
 *   maxReviewRounds: 3,
 *   actor: { type: "system", id: "scheduler" },
 * });
 * // result.outcome === "approved"
 * // result.task.status === TaskStatus.APPROVED
 * ```
 */
export function createReviewDecisionService(
  deps: ReviewDecisionDependencies,
): ReviewDecisionService {
  const {
    unitOfWork,
    eventEmitter,
    idGenerator = () => crypto.randomUUID(),
    clock = () => new Date(),
  } = deps;

  return {
    applyDecision(params: ApplyReviewDecisionParams): ApplyReviewDecisionResult {
      // ── Step 1: Validate the packet against the Zod schema ──────
      const packet = validatePacket(params.packet);

      // ── Step 2: Execute all reads and writes atomically ─────────
      const transactionResult = unitOfWork.runInTransaction((repos) =>
        applyDecisionInTransaction(repos, packet, params, idGenerator),
      );

      // ── Step 3: Emit domain events after commit ─────────────────
      const cycleEvent: DomainEvent = {
        type: "review-cycle.transitioned",
        entityType: "review-cycle",
        entityId: params.reviewCycleId,
        actor: params.actor,
        timestamp: clock(),
        fromStatus: transactionResult.previousCycleStatus,
        toStatus: transactionResult.cycleTargetStatus,
      };
      eventEmitter.emit(cycleEvent);

      const taskEvent: DomainEvent = {
        type: "task.transitioned",
        entityType: "task",
        entityId: params.taskId,
        actor: params.actor,
        timestamp: clock(),
        fromStatus: transactionResult.previousTaskStatus,
        toStatus: transactionResult.taskTargetStatus,
        newVersion: transactionResult.task.version,
      };
      eventEmitter.emit(taskEvent);

      // ── Step 4: Return result ───────────────────────────────────
      return {
        outcome: transactionResult.outcome,
        task: transactionResult.task,
        reviewCycle: transactionResult.reviewCycle,
        decisionRecord: transactionResult.decisionRecord,
        followUpTasks: transactionResult.followUpTasks,
        auditEvents: transactionResult.auditEvents,
      };
    },
  };
}
