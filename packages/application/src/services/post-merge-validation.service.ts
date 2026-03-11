/**
 * Post-merge validation service — triggers post-merge validation and applies
 * severity-based failure policy.
 *
 * After a merge completes successfully (task in POST_MERGE_VALIDATION state),
 * this service:
 * 1. Runs merge-gate validation against the workspace
 * 2. On success: transitions task POST_MERGE_VALIDATION → DONE
 * 3. On failure: classifies severity and applies the response policy from §9.11
 *
 * ## Severity classification (§9.11.1)
 *
 * - **critical**: any check named "security" fails, OR more than
 *   `critical_check_threshold` required checks fail
 * - **high**: any required check fails (not meeting critical threshold)
 * - **low**: only optional checks fail
 *
 * ## Response by severity (§9.11.2)
 *
 * | Severity   | Automatic action                     | Merge queue          | Notification         |
 * | ---------- | ------------------------------------ | -------------------- | -------------------- |
 * | critical   | Generate revert task                 | Pause for repository | Immediate alert      |
 * | high       | Analysis agent (if enabled) or revert| Continue             | Alert operator       |
 * | low        | Create diagnostic follow-up task     | Continue             | Informational        |
 *
 * @module @factory/application/services/post-merge-validation
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.11
 * @see {@link file://docs/backlog/tasks/T067-post-merge-failure.md}
 */

import { TaskStatus, validateTransition } from "@factory/domain";
import type { TransitionContext } from "@factory/domain";

import { EntityNotFoundError, InvalidTransitionError } from "../errors.js";
import type { ActorInfo } from "../events/domain-events.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { AuditEventRecord } from "../ports/repository.ports.js";
import type {
  ValidationRunResult,
  ValidationCheckOutcome,
} from "../ports/validation-runner.ports.js";
import type {
  PostMergeTask,
  PostMergeValidationRunnerPort,
  MergeQueuePausePort,
  OperatorNotificationPort,
  PostMergeUnitOfWork,
  PostMergeFollowUpTaskRecord,
} from "../ports/post-merge-validation.ports.js";

// ─── Policy Configuration ───────────────────────────────────────────────────

/**
 * Post-merge failure policy configuration from §9.11.4.
 *
 * Controls how the service responds to validation failures after merge.
 */
export interface PostMergeFailurePolicy {
  /**
   * Number of required check failures that triggers critical severity.
   * Default: 3 per §9.11.4.
   */
  readonly criticalCheckThreshold: number;

  /**
   * Whether to automatically generate a revert task on critical failures.
   * Default: true per §9.11.4.
   */
  readonly autoRevertOnCritical: boolean;

  /**
   * Whether to pause the merge queue on critical failures.
   * Default: true per §9.11.4.
   */
  readonly pauseQueueOnCritical: boolean;

  /**
   * Whether to use the post-merge analysis agent for high-severity failures.
   * Default: true per §9.11.4, but the agent may not be available.
   */
  readonly useAnalysisAgentOnHigh: boolean;

  /**
   * Default action when analysis agent is disabled/unavailable for high severity.
   * Default: "revert" per §9.11.4.
   */
  readonly defaultHighAction: "revert" | "escalate";

  /**
   * Whether operator must manually resume the queue after a critical pause.
   * Default: true per §9.11.4.
   */
  readonly requireOperatorResumeAfterPause: boolean;
}

/**
 * Default V1 post-merge failure policy from §9.11.4.
 */
export const DEFAULT_POST_MERGE_FAILURE_POLICY: PostMergeFailurePolicy = {
  criticalCheckThreshold: 3,
  autoRevertOnCritical: true,
  pauseQueueOnCritical: true,
  useAnalysisAgentOnHigh: true,
  defaultHighAction: "revert",
  requireOperatorResumeAfterPause: true,
};

// ─── Failure Severity ───────────────────────────────────────────────────────

/**
 * Post-merge failure severity level per §9.11.1.
 */
export type FailureSeverity = "critical" | "high" | "low";

// ─── Service Input / Output Types ───────────────────────────────────────────

/**
 * Parameters for executing post-merge validation.
 */
export interface ExecutePostMergeValidationParams {
  /** ID of the task in POST_MERGE_VALIDATION state. */
  readonly taskId: string;
  /** Absolute path to the workspace for running validation commands. */
  readonly workspacePath: string;
  /** ID of the merge queue item that triggered this validation. */
  readonly mergeQueueItemId: string;
  /** Who is executing the validation. */
  readonly actor: ActorInfo;
  /** Optional metadata to include in audit events. */
  readonly metadata?: Record<string, unknown>;
  /** Override the default failure policy. */
  readonly failurePolicy?: PostMergeFailurePolicy;
}

/**
 * Result when post-merge validation passes.
 */
export interface PostMergeSuccessResult {
  readonly outcome: "passed";
  /** The task after transitioning to DONE. */
  readonly task: PostMergeTask;
  /** Validation run details. */
  readonly validationResult: ValidationRunResult;
  /** All audit events recorded. */
  readonly auditEvents: readonly AuditEventRecord[];
}

/**
 * Result when post-merge validation fails.
 */
export interface PostMergeFailureResult {
  readonly outcome: "failed";
  /** The classified failure severity. */
  readonly severity: FailureSeverity;
  /** The task after transitioning to FAILED. */
  readonly task: PostMergeTask;
  /** Validation run details. */
  readonly validationResult: ValidationRunResult;
  /** All audit events recorded. */
  readonly auditEvents: readonly AuditEventRecord[];
  /** Whether the merge queue was paused. */
  readonly queuePaused: boolean;
  /** Follow-up tasks created (revert or diagnostic). */
  readonly followUpTasks: readonly PostMergeFollowUpTaskRecord[];
}

/**
 * Union of all post-merge validation outcomes.
 */
export type PostMergeValidationResult = PostMergeSuccessResult | PostMergeFailureResult;

// ─── Service Interface ──────────────────────────────────────────────────────

/**
 * Service for executing post-merge validation and applying failure policy.
 */
export interface PostMergeValidationService {
  /**
   * Execute post-merge validation and apply the failure policy if validation fails.
   *
   * @param params - Validation parameters.
   * @returns The validation result with outcome, severity, and follow-up actions.
   * @throws {EntityNotFoundError} If the task does not exist.
   * @throws {InvalidTransitionError} If the task is not in POST_MERGE_VALIDATION state.
   */
  executePostMergeValidation(
    params: ExecutePostMergeValidationParams,
  ): Promise<PostMergeValidationResult>;
}

// ─── Dependencies ───────────────────────────────────────────────────────────

/**
 * Dependencies injected into the post-merge validation service factory.
 */
export interface PostMergeValidationDependencies {
  readonly unitOfWork: PostMergeUnitOfWork;
  readonly eventEmitter: DomainEventEmitter;
  readonly validationRunner: PostMergeValidationRunnerPort;
  readonly mergeQueuePause: MergeQueuePausePort;
  readonly operatorNotification: OperatorNotificationPort;
  /** Injectable clock for deterministic tests. */
  readonly clock?: () => Date;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a new PostMergeValidationService.
 *
 * @param deps - Injected dependencies.
 * @returns A fully configured PostMergeValidationService.
 */
export function createPostMergeValidationService(
  deps: PostMergeValidationDependencies,
): PostMergeValidationService {
  const {
    unitOfWork,
    eventEmitter,
    validationRunner,
    mergeQueuePause,
    operatorNotification,
    clock = () => new Date(),
  } = deps;

  return {
    async executePostMergeValidation(
      params: ExecutePostMergeValidationParams,
    ): Promise<PostMergeValidationResult> {
      const {
        taskId,
        workspacePath,
        mergeQueueItemId,
        actor,
        metadata = {},
        failurePolicy = DEFAULT_POST_MERGE_FAILURE_POLICY,
      } = params;

      const auditEvents: AuditEventRecord[] = [];

      // ── Phase 1: Validate preconditions ──────────────────────────────

      const initialTask = unitOfWork.runInTransaction((repos) => {
        const task = repos.task.findById(taskId);
        if (!task) {
          throw new EntityNotFoundError("Task", taskId);
        }
        if (task.status !== TaskStatus.POST_MERGE_VALIDATION) {
          throw new InvalidTransitionError(
            "Task",
            taskId,
            task.status,
            TaskStatus.DONE,
            `Task must be in POST_MERGE_VALIDATION state, but is in ${task.status}`,
          );
        }
        return task;
      });

      // ── Phase 2: Run merge-gate validation ───────────────────────────

      const validationResult = await validationRunner.runMergeGateValidation({
        taskId,
        workspacePath,
      });

      // ── Phase 3: Apply outcome ───────────────────────────────────────

      if (validationResult.overallStatus === "passed") {
        return applySuccess(
          initialTask,
          validationResult,
          auditEvents,
          actor,
          metadata,
          mergeQueueItemId,
        );
      }

      return applyFailure(
        initialTask,
        validationResult,
        auditEvents,
        actor,
        metadata,
        mergeQueueItemId,
        failurePolicy,
      );
    },
  };

  // ── Internal: Success path ─────────────────────────────────────────────

  /**
   * Apply success outcome: transition POST_MERGE_VALIDATION → DONE.
   */
  function applySuccess(
    task: PostMergeTask,
    validationResult: ValidationRunResult,
    auditEvents: AuditEventRecord[],
    actor: ActorInfo,
    metadata: Record<string, unknown>,
    mergeQueueItemId: string,
  ): PostMergeSuccessResult {
    const transitionResult = unitOfWork.runInTransaction((repos) => {
      const validation = validateTransition(TaskStatus.POST_MERGE_VALIDATION, TaskStatus.DONE, {
        postMergeValidationPassed: true,
      } as TransitionContext);
      if (!validation.valid) {
        throw new InvalidTransitionError(
          "Task",
          task.id,
          TaskStatus.POST_MERGE_VALIDATION,
          TaskStatus.DONE,
          validation.reason,
        );
      }

      const updatedTask = repos.task.updateStatus(task.id, task.version, TaskStatus.DONE);

      const audit = repos.auditEvent.create({
        entityType: "task",
        entityId: task.id,
        eventType: "state_transition",
        actorType: actor.type,
        actorId: actor.id,
        oldState: TaskStatus.POST_MERGE_VALIDATION,
        newState: TaskStatus.DONE,
        metadata: JSON.stringify({
          ...metadata,
          mergeQueueItemId,
          validationProfile: validationResult.profileName,
          validationStatus: "passed",
        }),
      });

      return { task: updatedTask, audit };
    });

    auditEvents.push(transitionResult.audit);

    eventEmitter.emit({
      type: "task.transitioned",
      entityType: "task",
      entityId: task.id,
      fromStatus: TaskStatus.POST_MERGE_VALIDATION,
      toStatus: TaskStatus.DONE,
      newVersion: transitionResult.task.version,
      actor,
      timestamp: clock(),
    });

    return {
      outcome: "passed",
      task: transitionResult.task,
      validationResult,
      auditEvents,
    };
  }

  // ── Internal: Failure path ─────────────────────────────────────────────

  /**
   * Apply failure outcome: classify severity, transition to FAILED, apply policy.
   */
  function applyFailure(
    task: PostMergeTask,
    validationResult: ValidationRunResult,
    auditEvents: AuditEventRecord[],
    actor: ActorInfo,
    metadata: Record<string, unknown>,
    mergeQueueItemId: string,
    policy: PostMergeFailurePolicy,
  ): PostMergeFailureResult {
    const severity = classifyFailureSeverity(validationResult, policy);
    const followUpTasks: PostMergeFollowUpTaskRecord[] = [];
    let queuePaused = false;

    // Transition task to FAILED
    const transitionResult = unitOfWork.runInTransaction((repos) => {
      const validation = validateTransition(TaskStatus.POST_MERGE_VALIDATION, TaskStatus.FAILED, {
        postMergeValidationPassed: false,
      } as TransitionContext);
      if (!validation.valid) {
        throw new InvalidTransitionError(
          "Task",
          task.id,
          TaskStatus.POST_MERGE_VALIDATION,
          TaskStatus.FAILED,
          validation.reason,
        );
      }

      const updatedTask = repos.task.updateStatus(task.id, task.version, TaskStatus.FAILED);

      const audit = repos.auditEvent.create({
        entityType: "task",
        entityId: task.id,
        eventType: "state_transition",
        actorType: actor.type,
        actorId: actor.id,
        oldState: TaskStatus.POST_MERGE_VALIDATION,
        newState: TaskStatus.FAILED,
        metadata: JSON.stringify({
          ...metadata,
          mergeQueueItemId,
          validationProfile: validationResult.profileName,
          validationStatus: "failed",
          failureSeverity: severity,
          requiredFailedCount: validationResult.requiredFailedCount,
          optionalFailedCount: validationResult.optionalFailedCount,
        }),
      });

      // Apply severity-specific follow-up task creation within the transaction
      if (severity === "critical" && policy.autoRevertOnCritical) {
        const revertTask = repos.followUpTask.createFollowUpTask({
          title: `Revert: post-merge validation critical failure for ${task.id}`,
          description: buildRevertDescription(task, validationResult, severity),
          repositoryId: task.repositoryId,
          projectId: task.projectId,
          taskType: "revert",
          originTaskId: task.id,
          priority: 0, // highest priority for revert tasks
        });
        followUpTasks.push(revertTask);
      } else if (severity === "high" && !policy.useAnalysisAgentOnHigh) {
        // Analysis agent disabled — generate revert task per §9.11.3
        const revertTask = repos.followUpTask.createFollowUpTask({
          title: `Revert: post-merge validation high-severity failure for ${task.id}`,
          description: buildRevertDescription(task, validationResult, severity),
          repositoryId: task.repositoryId,
          projectId: task.projectId,
          taskType: "revert",
          originTaskId: task.id,
          priority: 1,
        });
        followUpTasks.push(revertTask);
      } else if (severity === "low") {
        const diagnosticTask = repos.followUpTask.createFollowUpTask({
          title: `Diagnostic: post-merge optional check failures for ${task.id}`,
          description: buildDiagnosticDescription(task, validationResult),
          repositoryId: task.repositoryId,
          projectId: task.projectId,
          taskType: "diagnostic",
          originTaskId: task.id,
          priority: 5, // lower priority for diagnostics
        });
        followUpTasks.push(diagnosticTask);
      }

      return { task: updatedTask, audit };
    });

    auditEvents.push(transitionResult.audit);

    // Emit domain event
    eventEmitter.emit({
      type: "task.transitioned",
      entityType: "task",
      entityId: task.id,
      fromStatus: TaskStatus.POST_MERGE_VALIDATION,
      toStatus: TaskStatus.FAILED,
      newVersion: transitionResult.task.version,
      actor,
      timestamp: clock(),
    });

    // Apply queue pause for critical failures (outside transaction — side effect)
    if (severity === "critical" && policy.pauseQueueOnCritical) {
      mergeQueuePause.pauseQueue(
        task.repositoryId,
        `Critical post-merge validation failure for task ${task.id}. ` +
          `${validationResult.requiredFailedCount} required checks failed.`,
      );
      queuePaused = true;
    }

    // Send operator notification
    operatorNotification.notify({
      taskId: task.id,
      repositoryId: task.repositoryId,
      severity,
      message: buildNotificationMessage(task, validationResult, severity),
      requiresAction: severity === "critical" || severity === "high",
    });

    return {
      outcome: "failed",
      severity,
      task: transitionResult.task,
      validationResult,
      auditEvents,
      queuePaused,
      followUpTasks,
    };
  }
}

// ─── Severity Classification ────────────────────────────────────────────────

/**
 * Classify post-merge validation failure severity per §9.11.1.
 *
 * Classification rules:
 * - **critical**: any check named "security" fails, OR more than
 *   `criticalCheckThreshold` required checks fail
 * - **high**: any required check fails (below critical threshold)
 * - **low**: only optional checks fail (overall status is "failed" but no
 *   required check failures — possible if fail_on_skipped_required_check
 *   triggered it, or if the policy considers skipped-required as failed)
 *
 * @param validationResult - The validation run result.
 * @param policy - The failure policy with thresholds.
 * @returns The classified severity.
 */
export function classifyFailureSeverity(
  validationResult: ValidationRunResult,
  policy: PostMergeFailurePolicy,
): FailureSeverity {
  const securityCheckFailed = validationResult.checkOutcomes.some(
    (c) => isSecurityCheck(c) && isCheckFailing(c),
  );

  if (securityCheckFailed) {
    return "critical";
  }

  if (validationResult.requiredFailedCount > policy.criticalCheckThreshold) {
    return "critical";
  }

  if (validationResult.requiredFailedCount > 0) {
    return "high";
  }

  return "low";
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Determine whether a check is a security check by name.
 * Security checks are identified by the "security" check name.
 */
function isSecurityCheck(check: ValidationCheckOutcome): boolean {
  return check.checkName.toLowerCase() === "security";
}

/**
 * Determine whether a check has a failing status.
 */
function isCheckFailing(check: ValidationCheckOutcome): boolean {
  return check.status === "failed" || check.status === "error";
}

/**
 * Build a human-readable description for a revert follow-up task.
 */
function buildRevertDescription(
  task: PostMergeTask,
  validationResult: ValidationRunResult,
  severity: FailureSeverity,
): string {
  const failedChecks = validationResult.checkOutcomes
    .filter(isCheckFailing)
    .map((c) => `${c.checkName} (${c.category})`)
    .join(", ");

  return (
    `Post-merge validation failed with ${severity} severity for task ${task.id}. ` +
    `Failed checks: ${failedChecks}. ` +
    `A revert of the merged changes is recommended to restore the target branch ` +
    `to a known-good state. Profile: ${validationResult.profileName}. ` +
    `Summary: ${validationResult.summary}`
  );
}

/**
 * Build a human-readable description for a diagnostic follow-up task.
 */
function buildDiagnosticDescription(
  task: PostMergeTask,
  validationResult: ValidationRunResult,
): string {
  const failedChecks = validationResult.checkOutcomes
    .filter(isCheckFailing)
    .map((c) => `${c.checkName} (${c.category})`)
    .join(", ");

  return (
    `Post-merge validation had optional check failures for task ${task.id}. ` +
    `Failed optional checks: ${failedChecks}. ` +
    `No required checks failed — the merge is considered successful. ` +
    `This diagnostic task tracks investigation of the optional failures. ` +
    `Profile: ${validationResult.profileName}. ` +
    `Summary: ${validationResult.summary}`
  );
}

/**
 * Build a notification message for the operator.
 */
function buildNotificationMessage(
  task: PostMergeTask,
  validationResult: ValidationRunResult,
  severity: FailureSeverity,
): string {
  if (severity === "critical") {
    return (
      `CRITICAL: Post-merge validation failed for task ${task.id} in repository ${task.repositoryId}. ` +
      `${validationResult.requiredFailedCount} required checks failed. ` +
      `Merge queue has been paused. Operator action required to resume.`
    );
  }
  if (severity === "high") {
    return (
      `HIGH: Post-merge validation failed for task ${task.id} in repository ${task.repositoryId}. ` +
      `${validationResult.requiredFailedCount} required check(s) failed. ` +
      `Review recommended.`
    );
  }
  return (
    `INFO: Post-merge optional check failures for task ${task.id} in repository ${task.repositoryId}. ` +
    `${validationResult.optionalFailedCount} optional check(s) failed. ` +
    `No action required — diagnostic task created.`
  );
}
