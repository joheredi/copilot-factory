/**
 * Specialist reviewer dispatch service — fans out review work after DEV_COMPLETE.
 *
 * When a task reaches DEV_COMPLETE, this service:
 * 1. Calls the Review Router to determine which specialist reviewers are needed
 * 2. Creates a new ReviewCycle record (NOT_STARTED → ROUTED)
 * 3. Creates one `reviewer_dispatch` job per specialist reviewer, all sharing
 *    the same `jobGroupId` for coordination
 * 4. Creates a `lead_review_consolidation` job that depends on all specialist
 *    jobs (via `dependsOnJobIds`)
 * 5. Transitions the task from DEV_COMPLETE → IN_REVIEW
 * 6. Updates the task's `currentReviewCycleId` to the new cycle
 * 7. Records audit events for both transitions
 * 8. Emits domain events after the transaction commits
 *
 * All database writes occur within a single transaction to guarantee atomicity
 * per §10.3.
 *
 * @see docs/prd/002-data-model.md §2.2 — Review Cycle State
 * @see docs/prd/010-integration-contracts.md §10.6 — Review Routing Contract
 * @see docs/prd/010-integration-contracts.md §10.3 — Transaction Boundaries
 * @see docs/backlog/tasks/T059-reviewer-dispatch.md
 *
 * @module @factory/application/services/reviewer-dispatch
 */

import {
  TaskStatus,
  ReviewCycleStatus,
  JobType,
  JobStatus,
  validateTransition,
  validateReviewCycleTransition,
} from "@factory/domain";
import type { TransitionContext, ReviewCycleTransitionContext } from "@factory/domain";

import type { ActorInfo, DomainEvent } from "../events/domain-events.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { ReviewerDispatchUnitOfWork } from "../ports/reviewer-dispatch.ports.js";
import type {
  ReviewDispatchTask,
  ReviewDispatchCycle,
  ReviewDispatchJob,
  ReviewDispatchAuditEvent,
} from "../ports/reviewer-dispatch.ports.js";
import type {
  ReviewRouterService,
  ReviewRoutingInput,
  RoutingDecision,
} from "./review-router.service.js";
import { EntityNotFoundError, InvalidTransitionError } from "../errors.js";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

/**
 * Parameters for dispatching specialist reviewers for a task.
 *
 * The caller provides the task ID and the review routing input
 * (changed files, tags, risk level, etc.) needed by the Review Router.
 */
export interface DispatchReviewersParams {
  /** ID of the task in DEV_COMPLETE state. */
  readonly taskId: string;

  /** Changed file paths from the dev result, used for path-based routing rules. */
  readonly changedFilePaths: readonly string[];

  /** Tags/labels assigned to the task, used for tag-based routing rules. */
  readonly taskTags: readonly string[];

  /** Optional domain classification of the task. */
  readonly taskDomain?: string;

  /** Risk level of the task, used for risk-based routing rules. */
  readonly riskLevel: ReviewRoutingInput["riskLevel"];

  /** Reviewer types explicitly required by the repository configuration. */
  readonly repositoryRequiredReviewers: readonly string[];

  /** The routing configuration containing the rule definitions. */
  readonly routingConfig: ReviewRoutingInput["routingConfig"];

  /** The actor initiating the dispatch (typically system/review-module). */
  readonly actor: ActorInfo;
}

/**
 * Result of a successful reviewer dispatch operation.
 *
 * Contains the created ReviewCycle, the routing decision, all created
 * jobs, and the updated task.
 */
export interface DispatchReviewersResult {
  /** The newly created and routed review cycle. */
  readonly reviewCycle: ReviewDispatchCycle;

  /** The routing decision from the Review Router. */
  readonly routingDecision: RoutingDecision;

  /** IDs of the created specialist reviewer_dispatch jobs. */
  readonly specialistJobIds: readonly string[];

  /** ID of the created lead_review_consolidation job. */
  readonly leadReviewJobId: string;

  /** The updated task (now in IN_REVIEW status). */
  readonly task: ReviewDispatchTask;

  /** Audit events recorded during the dispatch. */
  readonly auditEvents: readonly ReviewDispatchAuditEvent[];
}

/**
 * The reviewer dispatch service interface.
 *
 * Exposes a single orchestration method that performs the entire
 * review fan-out workflow atomically.
 */
export interface ReviewerDispatchService {
  /**
   * Dispatch specialist reviewers for a task in DEV_COMPLETE state.
   *
   * @param params - The dispatch parameters
   * @returns The dispatch result with created entities and jobs
   * @throws EntityNotFoundError if the task doesn't exist
   * @throws InvalidTransitionError if the task is not in DEV_COMPLETE state
   * @throws InvalidTransitionError if any state machine validation fails
   */
  dispatchReviewers(params: DispatchReviewersParams): DispatchReviewersResult;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into the reviewer dispatch service factory.
 */
export interface ReviewerDispatchDependencies {
  /** Unit of work for atomic multi-entity operations. */
  readonly unitOfWork: ReviewerDispatchUnitOfWork;

  /** Pure review routing service for determining reviewer assignments. */
  readonly reviewRouter: ReviewRouterService;

  /** Event emitter for post-commit domain event publication. */
  readonly eventEmitter: DomainEventEmitter;

  /** ID generator for creating unique IDs (injected for testability). */
  readonly idGenerator: () => string;

  /** Clock function for timestamps (injected for testability). */
  readonly clock?: () => Date;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

/**
 * Creates a ReviewerDispatchService instance.
 *
 * The service orchestrates the full reviewer dispatch workflow:
 * routing → cycle creation → job fan-out → task transition, all within
 * a single atomic transaction.
 *
 * @param deps - Injected dependencies
 * @returns A ReviewerDispatchService instance
 *
 * @example
 * ```ts
 * const service = createReviewerDispatchService({
 *   unitOfWork,
 *   reviewRouter: createReviewRouterService(),
 *   eventEmitter,
 *   idGenerator: () => crypto.randomUUID(),
 * });
 *
 * const result = service.dispatchReviewers({
 *   taskId: "task-123",
 *   changedFilePaths: ["src/auth/login.ts"],
 *   taskTags: ["auth"],
 *   riskLevel: "high",
 *   repositoryRequiredReviewers: [],
 *   routingConfig: { rules: [] },
 *   actor: { type: "system", id: "review-module" },
 * });
 * ```
 */
export function createReviewerDispatchService(
  deps: ReviewerDispatchDependencies,
): ReviewerDispatchService {
  const { unitOfWork, reviewRouter, eventEmitter, idGenerator, clock = () => new Date() } = deps;

  return {
    dispatchReviewers(params: DispatchReviewersParams): DispatchReviewersResult {
      // ── Step 1: Get routing decision (pure, no side effects) ────────
      const routingDecision = reviewRouter.routeReview({
        changedFilePaths: params.changedFilePaths,
        taskTags: params.taskTags,
        taskDomain: params.taskDomain,
        riskLevel: params.riskLevel,
        repositoryRequiredReviewers: params.repositoryRequiredReviewers,
        routingConfig: params.routingConfig,
      });

      // Combine required and optional reviewers for the full specialist set.
      // Each required reviewer gets a reviewer_dispatch job.
      // Optional reviewers also get jobs but are tracked separately in the cycle.
      const allSpecialists = [
        ...routingDecision.requiredReviewers,
        ...routingDecision.optionalReviewers,
      ];

      // ── Step 2: Generate IDs upfront ────────────────────────────────
      const reviewCycleId = idGenerator();
      const specialistJobIds: string[] = [];
      const leadReviewJobId = idGenerator();

      for (let i = 0; i < allSpecialists.length; i++) {
        specialistJobIds.push(idGenerator());
      }

      // ── Step 3: Execute all mutations atomically ────────────────────
      const transactionResult = unitOfWork.runInTransaction((repos) => {
        // 3a. Fetch and validate the task
        const task = repos.task.findById(params.taskId);
        if (!task) {
          throw new EntityNotFoundError("Task", params.taskId);
        }

        if (task.status !== TaskStatus.DEV_COMPLETE) {
          throw new InvalidTransitionError(
            "Task",
            params.taskId,
            task.status,
            TaskStatus.IN_REVIEW,
            `Task must be in DEV_COMPLETE state, but is ${task.status}`,
          );
        }

        // 3b. Validate task transition via domain state machine
        const taskTransitionContext: TransitionContext = {
          hasReviewRoutingDecision: true,
        };
        const taskValidation = validateTransition(
          task.status,
          TaskStatus.IN_REVIEW,
          taskTransitionContext,
        );
        if (!taskValidation.valid) {
          throw new InvalidTransitionError(
            "Task",
            params.taskId,
            task.status,
            TaskStatus.IN_REVIEW,
            taskValidation.reason,
          );
        }

        // 3c. Create ReviewCycle with NOT_STARTED status
        repos.reviewCycle.create({
          reviewCycleId,
          taskId: params.taskId,
          status: ReviewCycleStatus.NOT_STARTED,
          requiredReviewers: routingDecision.requiredReviewers,
          optionalReviewers: routingDecision.optionalReviewers,
        });

        // 3d. Validate and transition ReviewCycle to ROUTED
        const cycleTransitionContext: ReviewCycleTransitionContext = {
          routingDecisionEmitted: true,
        };
        const cycleValidation = validateReviewCycleTransition(
          ReviewCycleStatus.NOT_STARTED,
          ReviewCycleStatus.ROUTED,
          cycleTransitionContext,
        );
        if (!cycleValidation.valid) {
          throw new InvalidTransitionError(
            "ReviewCycle",
            reviewCycleId,
            ReviewCycleStatus.NOT_STARTED,
            ReviewCycleStatus.ROUTED,
            cycleValidation.reason,
          );
        }

        const routedCycle = repos.reviewCycle.updateStatus(
          reviewCycleId,
          ReviewCycleStatus.NOT_STARTED,
          ReviewCycleStatus.ROUTED,
        );
        if (!routedCycle) {
          throw new InvalidTransitionError(
            "ReviewCycle",
            reviewCycleId,
            ReviewCycleStatus.NOT_STARTED,
            ReviewCycleStatus.ROUTED,
            "Status update failed — concurrent modification detected",
          );
        }

        // 3e. Create one reviewer_dispatch job per specialist reviewer
        const createdSpecialistJobs: ReviewDispatchJob[] = [];

        for (let i = 0; i < allSpecialists.length; i++) {
          const reviewerType = allSpecialists[i]!;
          const isRequired = routingDecision.requiredReviewers.includes(reviewerType);

          const job = repos.job.create({
            jobId: specialistJobIds[i]!,
            jobType: JobType.REVIEWER_DISPATCH,
            entityType: "review-cycle",
            entityId: reviewCycleId,
            payloadJson: {
              reviewCycleId,
              taskId: params.taskId,
              reviewerType,
              isRequired,
              role: "reviewer",
            },
            status: JobStatus.PENDING,
            attemptCount: 0,
            runAfter: null,
            parentJobId: null,
            jobGroupId: reviewCycleId,
            dependsOnJobIds: null,
          });
          createdSpecialistJobs.push(job);
        }

        // 3f. Create lead_review_consolidation job depending on all specialists
        const leadJob = repos.job.create({
          jobId: leadReviewJobId,
          jobType: JobType.LEAD_REVIEW_CONSOLIDATION,
          entityType: "review-cycle",
          entityId: reviewCycleId,
          payloadJson: {
            reviewCycleId,
            taskId: params.taskId,
            role: "lead-reviewer",
          },
          status: JobStatus.PENDING,
          attemptCount: 0,
          runAfter: null,
          parentJobId: null,
          jobGroupId: reviewCycleId,
          dependsOnJobIds: specialistJobIds.length > 0 ? specialistJobIds : null,
        });

        // 3g. Transition task to IN_REVIEW and set currentReviewCycleId
        const updatedTask = repos.task.updateForReviewDispatch(
          params.taskId,
          task.version,
          TaskStatus.IN_REVIEW,
          reviewCycleId,
        );

        // 3h. Record audit events
        const auditEvents: ReviewDispatchAuditEvent[] = [];

        const reviewCycleAudit = repos.auditEvent.create({
          entityType: "review-cycle",
          entityId: reviewCycleId,
          eventType: "review-cycle.created-and-routed",
          actorType: params.actor.type,
          actorId: params.actor.id,
          oldState: null,
          newState: ReviewCycleStatus.ROUTED,
          metadata: JSON.stringify({
            taskId: params.taskId,
            requiredReviewers: routingDecision.requiredReviewers,
            optionalReviewers: routingDecision.optionalReviewers,
            specialistJobCount: allSpecialists.length,
            routingRationale: routingDecision.routingRationale,
          }),
        });
        auditEvents.push(reviewCycleAudit);

        const taskAudit = repos.auditEvent.create({
          entityType: "task",
          entityId: params.taskId,
          eventType: "task.transitioned",
          actorType: params.actor.type,
          actorId: params.actor.id,
          oldState: TaskStatus.DEV_COMPLETE,
          newState: TaskStatus.IN_REVIEW,
          metadata: JSON.stringify({
            reviewCycleId,
            specialistJobIds,
            leadReviewJobId,
            newVersion: updatedTask.version,
          }),
        });
        auditEvents.push(taskAudit);

        return {
          reviewCycle: routedCycle,
          task: updatedTask,
          specialistJobs: createdSpecialistJobs,
          leadJob,
          auditEvents,
          previousTaskStatus: task.status,
        };
      });

      // ── Step 4: Emit domain events after commit ─────────────────────
      const taskEvent: DomainEvent = {
        type: "task.transitioned",
        entityType: "task",
        entityId: params.taskId,
        actor: params.actor,
        timestamp: clock(),
        fromStatus: transactionResult.previousTaskStatus,
        toStatus: TaskStatus.IN_REVIEW,
        newVersion: transactionResult.task.version,
      };
      eventEmitter.emit(taskEvent);

      const reviewCycleEvent: DomainEvent = {
        type: "review-cycle.transitioned",
        entityType: "review-cycle",
        entityId: reviewCycleId,
        actor: params.actor,
        timestamp: clock(),
        fromStatus: ReviewCycleStatus.NOT_STARTED,
        toStatus: ReviewCycleStatus.ROUTED,
      };
      eventEmitter.emit(reviewCycleEvent);

      // ── Step 5: Return result ───────────────────────────────────────
      return {
        reviewCycle: transactionResult.reviewCycle,
        routingDecision,
        specialistJobIds,
        leadReviewJobId,
        task: transactionResult.task,
        auditEvents: transactionResult.auditEvents,
      };
    },
  };
}
