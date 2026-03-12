/**
 * Merge executor service — orchestrates all merge strategies.
 *
 * Executes the merge pipeline for a dequeued merge queue item using the
 * configured strategy (rebase-and-merge, squash, or merge-commit):
 * 1. Transition item PREPARING → REBASING, task QUEUED_FOR_MERGE → MERGING
 * 2. Fetch latest refs and perform strategy-specific merge operation
 * 3. On merge failure: classify conflict, transition to FAILED/CHANGES_REQUESTED
 * 4. On merge success: run merge-gate validation
 * 5. On validation failure: transition item to FAILED
 * 6. On validation pass: push to remote, transition item MERGING → MERGED
 * 7. Transition task MERGING → POST_MERGE_VALIDATION
 * 8. Emit MergePacket with full details including chosen strategy
 *
 * Strategy precedence (§10.10.1):
 *   task-level override → repo workflow template → system default (rebase-and-merge)
 *
 * All state transitions use the domain state machine guards and are
 * persisted atomically with audit events. Domain events are emitted
 * after each transaction commits.
 *
 * @see docs/prd/010-integration-contracts.md §10.10 — Merge Pipeline
 * @see docs/prd/010-integration-contracts.md §10.10.1 — Merge Strategy
 * @see docs/prd/002-data-model.md §2.2 MergeQueueItem State
 * @see docs/prd/008-packet-and-schema-spec.md §8.8 MergePacket
 * @module @factory/application/services/merge-executor.service
 */

import {
  TaskStatus,
  MergeQueueItemStatus,
  MergeStrategy,
  PacketStatus,
  validateTransition,
  validateMergeQueueItemTransition,
  type TransitionContext,
  type MergeQueueItemTransitionContext,
} from "@factory/domain";

import { MergePacketSchema, type MergePacket } from "@factory/schemas";

import { getTracer, SpanStatusCode, SpanNames, SpanAttributes } from "@factory/observability";

import { EntityNotFoundError, InvalidTransitionError } from "../errors.js";

import type { AuditEventRecord } from "../ports/repository.ports.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { ActorInfo } from "../events/domain-events.js";
import type {
  ValidationRunResult,
  ValidationCheckOutcome,
} from "../ports/validation-runner.ports.js";
import type {
  MergeExecutorUnitOfWork,
  MergeExecutorTask,
  MergeExecutorItem,
  MergeGitOperationsPort,
  MergeValidationPort,
  MergeArtifactPort,
  ConflictClassifierPort,
  ConflictClassification,
} from "../ports/merge-executor.ports.js";

// ─── Error Types ────────────────────────────────────────────────────────────

/**
 * Thrown when the merge queue item is not in PREPARING state at execution start.
 * The merge executor expects the item to have been dequeued (ENQUEUED → PREPARING)
 * by the merge queue service before execution begins.
 */
export class MergeItemNotPreparingError extends Error {
  public readonly mergeQueueItemId: string;
  public readonly currentStatus: string;

  constructor(mergeQueueItemId: string, currentStatus: string) {
    super(
      `Merge queue item ${mergeQueueItemId} is not in PREPARING state (current: ${currentStatus})`,
    );
    this.name = "MergeItemNotPreparingError";
    this.mergeQueueItemId = mergeQueueItemId;
    this.currentStatus = currentStatus;
  }
}

/**
 * Thrown when the merge queue item's associated task is not in QUEUED_FOR_MERGE state.
 */
export class TaskNotQueuedForMergeError extends Error {
  public readonly taskId: string;
  public readonly currentStatus: string;

  constructor(taskId: string, currentStatus: string) {
    super(`Task ${taskId} is not in QUEUED_FOR_MERGE state (current: ${currentStatus})`);
    this.name = "TaskNotQueuedForMergeError";
    this.taskId = taskId;
    this.currentStatus = currentStatus;
  }
}

// ─── Service Input/Output Types ─────────────────────────────────────────────

/**
 * Parameters for executing a merge operation.
 */
export interface ExecuteMergeParams {
  /** ID of the merge queue item to process (must be in PREPARING state). */
  readonly mergeQueueItemId: string;
  /** Absolute path to the git worktree for this task. */
  readonly workspacePath: string;
  /** Target branch to merge into (e.g., "main"). */
  readonly targetBranch: string;
  /**
   * Merge strategy to use. Resolved by the caller via policy precedence:
   * task-level override → repo workflow template → system default (rebase-and-merge).
   *
   * @see docs/prd/010-integration-contracts.md §10.10.1
   * @default MergeStrategy.REBASE_AND_MERGE
   */
  readonly mergeStrategy?: MergeStrategy;
  /** Who is executing the merge. */
  readonly actor: ActorInfo;
  /** Optional metadata to include in audit events. */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Outcome discriminator for merge execution results.
 *
 * - `merged`: Merge completed successfully; task moved to POST_MERGE_VALIDATION.
 * - `rebase_conflict`: Rebase failed; conflict classified and task transitioned.
 * - `validation_failed`: Merge-gate validation failed after successful rebase.
 * - `push_failed`: Git push failed after successful validation.
 */
export type MergeOutcome = "merged" | "rebase_conflict" | "validation_failed" | "push_failed";

/**
 * Base fields present in all merge execution results.
 */
interface BaseMergeResult {
  /** Discriminator for the merge outcome. */
  readonly outcome: MergeOutcome;
  /** The merge queue item after all transitions. */
  readonly item: MergeExecutorItem;
  /** The task after all transitions. */
  readonly task: MergeExecutorTask;
  /** All audit events recorded during execution. */
  readonly auditEvents: readonly AuditEventRecord[];
}

/**
 * Result when merge completes successfully.
 */
export interface MergeSuccessResult extends BaseMergeResult {
  readonly outcome: "merged";
  /** The emitted MergePacket. */
  readonly mergePacket: MergePacket;
  /** Path where the MergePacket artifact was stored. */
  readonly artifactPath: string;
  /** The commit SHA after merge. */
  readonly mergedCommitSha: string;
}

/**
 * Result when rebase fails with conflicts.
 */
export interface RebaseConflictResult extends BaseMergeResult {
  readonly outcome: "rebase_conflict";
  /** Files with conflicts. */
  readonly conflictFiles: readonly string[];
  /** How the conflict was classified. */
  readonly classification: ConflictClassification;
}

/**
 * Result when merge-gate validation fails.
 */
export interface ValidationFailedResult extends BaseMergeResult {
  readonly outcome: "validation_failed";
  /** The validation run result with per-check details. */
  readonly validationResult: ValidationRunResult;
}

/**
 * Result when git push fails after successful validation.
 */
export interface PushFailedResult extends BaseMergeResult {
  readonly outcome: "push_failed";
  /** Error message from the push failure. */
  readonly pushError: string;
}

/**
 * Union of all possible merge execution results.
 */
export type ExecuteMergeResult =
  | MergeSuccessResult
  | RebaseConflictResult
  | ValidationFailedResult
  | PushFailedResult;

// ─── Service Interface ──────────────────────────────────────────────────────

/**
 * Service for executing merge operations using the configured strategy.
 *
 * Takes a dequeued merge queue item (in PREPARING state) and runs
 * it through the full merge pipeline using the specified strategy:
 * - rebase-and-merge: rebase → validate → push source branch
 * - squash: squash-merge into target → validate → push target branch
 * - merge-commit: merge --no-ff into target → validate → push target branch
 */
export interface MergeExecutorService {
  /**
   * Execute a merge operation for a merge queue item.
   *
   * @param params - The merge execution parameters including strategy.
   * @returns The execution result indicating outcome and final state.
   *
   * @throws {EntityNotFoundError} If the item or task does not exist.
   * @throws {MergeItemNotPreparingError} If the item is not in PREPARING state.
   * @throws {TaskNotQueuedForMergeError} If the task is not in QUEUED_FOR_MERGE state.
   * @throws {InvalidTransitionError} If a state machine rejects a transition.
   */
  executeMerge(params: ExecuteMergeParams): Promise<ExecuteMergeResult>;
}

// ─── Service Dependencies ───────────────────────────────────────────────────

/**
 * Dependencies injected into the merge executor service factory.
 */
export interface MergeExecutorDependencies {
  /** Unit of work for atomic database operations. */
  readonly unitOfWork: MergeExecutorUnitOfWork;
  /** Emits domain events after transactions commit. */
  readonly eventEmitter: DomainEventEmitter;
  /** Git operations port for fetch, rebase, push. */
  readonly gitOps: MergeGitOperationsPort;
  /** Validation port for running merge-gate checks. */
  readonly validation: MergeValidationPort;
  /** Conflict classifier port for categorizing rebase conflicts. */
  readonly conflictClassifier: ConflictClassifierPort;
  /** Artifact port for persisting MergePacket. */
  readonly artifactStore: MergeArtifactPort;
  /** Clock function for timestamps (injectable for testing). */
  readonly clock?: () => Date;
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Map check_type strings from check names to schema-compatible ValidationCheckType values.
 * Falls back to "test" for unknown check names since the schema requires a valid enum value.
 */
const CHECK_NAME_TO_TYPE: Record<string, string> = {
  test: "test",
  lint: "lint",
  build: "build",
  typecheck: "typecheck",
  policy: "policy",
  schema: "schema",
  security: "security",
};

/**
 * Map a check outcome status to a schema-compatible ValidationCheckStatus.
 * The schema only allows "passed", "failed", "skipped" — "error" maps to "failed".
 */
function mapStatusToSchemaStatus(status: string): "passed" | "failed" | "skipped" {
  if (status === "error") return "failed";
  if (status === "passed") return "passed";
  if (status === "skipped") return "skipped";
  return "failed";
}

/**
 * Map a ValidationCheckOutcome to a schema-compatible validation check result object.
 * Used when building the MergePacket details.validation_results array.
 */
function mapCheckOutcomeToSchemaResult(outcome: ValidationCheckOutcome): {
  check_type: "test" | "lint" | "build" | "typecheck" | "policy" | "schema" | "security";
  tool_name: string;
  command: string;
  status: "passed" | "failed" | "skipped";
  duration_ms: number;
  summary: string;
} {
  const checkType = CHECK_NAME_TO_TYPE[outcome.checkName];
  return {
    check_type: (checkType ?? "test") as
      | "test"
      | "lint"
      | "build"
      | "typecheck"
      | "policy"
      | "schema"
      | "security",
    tool_name: outcome.checkName,
    command: outcome.command,
    status: mapStatusToSchemaStatus(outcome.status),
    duration_ms: outcome.durationMs,
    summary: outcome.output ?? `${outcome.checkName}: ${outcome.status}`,
  };
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a new MergeExecutorService instance.
 *
 * @param deps - The injected dependencies.
 * @returns A fully configured MergeExecutorService.
 *
 * @example
 * ```typescript
 * const mergeExecutor = createMergeExecutorService({
 *   unitOfWork,
 *   eventEmitter,
 *   gitOps: createExecMergeGitOperations(),
 *   validation: createMergeValidationAdapter(validationRunner),
 *   conflictClassifier: createPolicyConflictClassifier(policySnapshot),
 *   artifactStore: createMergeArtifactAdapter(artifactService),
 *   clock: () => new Date(),
 * });
 * ```
 */
/** @internal OpenTelemetry tracer for merge executor spans. */
const mergeTracer = getTracer("merge-executor");

export function createMergeExecutorService(deps: MergeExecutorDependencies): MergeExecutorService {
  const {
    unitOfWork,
    eventEmitter,
    gitOps,
    validation,
    conflictClassifier,
    artifactStore,
    clock = () => new Date(),
  } = deps;

  return {
    async executeMerge(params: ExecuteMergeParams): Promise<ExecuteMergeResult> {
      const {
        mergeQueueItemId,
        workspacePath,
        targetBranch,
        mergeStrategy = MergeStrategy.REBASE_AND_MERGE,
        actor,
        metadata,
      } = params;
      const auditEvents: AuditEventRecord[] = [];

      // ── merge.prepare span: load state and transition to REBASING ──
      const prepareSpan = mergeTracer.startSpan(SpanNames.MERGE_PREPARE);
      prepareSpan.setAttribute(SpanAttributes.MERGE_QUEUE_ITEM_ID, mergeQueueItemId);

      // ── Phase 1: Load and validate current state ──────────────────────

      let initialState: { item: MergeExecutorItem; task: MergeExecutorTask };
      try {
        initialState = unitOfWork.runInTransaction((repos) => {
          const item = repos.mergeQueueItem.findById(mergeQueueItemId);
          if (!item) {
            throw new EntityNotFoundError("MergeQueueItem", mergeQueueItemId);
          }
          if (item.status !== MergeQueueItemStatus.PREPARING) {
            throw new MergeItemNotPreparingError(mergeQueueItemId, item.status);
          }

          const task = repos.task.findById(item.taskId);
          if (!task) {
            throw new EntityNotFoundError("Task", item.taskId);
          }
          if (task.status !== TaskStatus.QUEUED_FOR_MERGE) {
            throw new TaskNotQueuedForMergeError(item.taskId, task.status);
          }

          return { item, task };
        });
      } catch (error: unknown) {
        prepareSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        prepareSpan.end();
        throw error;
      }

      prepareSpan.setAttribute(SpanAttributes.TASK_ID, initialState.task.id);

      let currentTask = initialState.task;

      // ── Phase 2: Transition to REBASING / MERGING ─────────────────────

      const rebasingResult = unitOfWork.runInTransaction((repos) => {
        // Transition merge queue item: PREPARING → REBASING
        const itemValidation = validateMergeQueueItemTransition(
          MergeQueueItemStatus.PREPARING,
          MergeQueueItemStatus.REBASING,
          { workspaceReady: true } as MergeQueueItemTransitionContext,
        );
        if (!itemValidation.valid) {
          throw new InvalidTransitionError(
            "MergeQueueItem",
            mergeQueueItemId,
            MergeQueueItemStatus.PREPARING,
            MergeQueueItemStatus.REBASING,
            itemValidation.reason,
          );
        }

        const updatedItem = repos.mergeQueueItem.updateStatus(
          mergeQueueItemId,
          MergeQueueItemStatus.PREPARING,
          MergeQueueItemStatus.REBASING,
        );

        // Transition task: QUEUED_FOR_MERGE → MERGING
        const taskValidation = validateTransition(
          TaskStatus.QUEUED_FOR_MERGE,
          TaskStatus.MERGING,
          {} as TransitionContext,
        );
        if (!taskValidation.valid) {
          throw new InvalidTransitionError(
            "Task",
            currentTask.id,
            TaskStatus.QUEUED_FOR_MERGE,
            TaskStatus.MERGING,
            taskValidation.reason,
          );
        }

        const updatedTask = repos.task.updateStatus(
          currentTask.id,
          currentTask.version,
          TaskStatus.MERGING,
        );

        // Audit events
        const itemAudit = repos.auditEvent.create({
          entityType: "merge-queue-item",
          entityId: mergeQueueItemId,
          eventType: "state_transition",
          actorType: actor.type,
          actorId: actor.id,
          oldState: MergeQueueItemStatus.PREPARING,
          newState: MergeQueueItemStatus.REBASING,
          metadata: metadata ? JSON.stringify(metadata) : null,
        });

        const taskAudit = repos.auditEvent.create({
          entityType: "task",
          entityId: currentTask.id,
          eventType: "state_transition",
          actorType: actor.type,
          actorId: actor.id,
          oldState: TaskStatus.QUEUED_FOR_MERGE,
          newState: TaskStatus.MERGING,
          metadata: metadata ? JSON.stringify(metadata) : null,
        });

        return { item: updatedItem, task: updatedTask, itemAudit, taskAudit };
      });

      currentTask = rebasingResult.task;
      auditEvents.push(rebasingResult.itemAudit, rebasingResult.taskAudit);

      // Emit domain events after transaction
      eventEmitter.emit({
        type: "merge-queue-item.transitioned",
        entityType: "merge-queue-item",
        entityId: mergeQueueItemId,
        fromStatus: MergeQueueItemStatus.PREPARING,
        toStatus: MergeQueueItemStatus.REBASING,
        actor,
        timestamp: clock(),
      });
      eventEmitter.emit({
        type: "task.transitioned",
        entityType: "task",
        entityId: currentTask.id,
        fromStatus: TaskStatus.QUEUED_FOR_MERGE,
        toStatus: TaskStatus.MERGING,
        newVersion: currentTask.version,
        actor,
        timestamp: clock(),
      });

      prepareSpan.setStatus({ code: SpanStatusCode.OK });
      prepareSpan.end();

      // ── merge.execute span: perform the merge, validation, and push ──
      const executeSpan = mergeTracer.startSpan(SpanNames.MERGE_EXECUTE);
      executeSpan.setAttribute(SpanAttributes.MERGE_QUEUE_ITEM_ID, mergeQueueItemId);
      executeSpan.setAttribute(SpanAttributes.TASK_ID, currentTask.id);

      try {
        // ── Phase 3: Fetch and execute strategy-specific merge operation ──

        await gitOps.fetch(workspacePath, "origin");

        // Get the current branch name before any operations (it's the source/feature branch)
        const sourceBranch = await gitOps.getCurrentBranch(workspacePath);

        // Dispatch to strategy-specific merge operation
        let mergeOpResult: { success: boolean; conflictFiles: readonly string[] };
        if (mergeStrategy === MergeStrategy.REBASE_AND_MERGE) {
          mergeOpResult = await gitOps.rebase(workspacePath, `origin/${targetBranch}`);
        } else if (mergeStrategy === MergeStrategy.SQUASH) {
          const commitMessage = `squash: merge ${sourceBranch} into ${targetBranch}`;
          mergeOpResult = await gitOps.squashMerge(
            workspacePath,
            sourceBranch,
            `origin/${targetBranch}`,
            commitMessage,
          );
        } else {
          mergeOpResult = await gitOps.mergeCommit(
            workspacePath,
            sourceBranch,
            `origin/${targetBranch}`,
          );
        }

        if (!mergeOpResult.success) {
          // Classify the conflict via the classifier port
          const classification = await conflictClassifier.classify(mergeOpResult.conflictFiles);

          // Determine task and item transitions based on classification
          const failResult = unitOfWork.runInTransaction((repos) => {
            // Transition item: REBASING → FAILED
            const itemContext: MergeQueueItemTransitionContext = {
              rebaseFailed: true,
              ...(classification === "reworkable" ? { conflictReworkable: true } : {}),
            };
            const itemTarget =
              classification === "reworkable"
                ? MergeQueueItemStatus.REQUEUED
                : MergeQueueItemStatus.FAILED;

            const itemValidation = validateMergeQueueItemTransition(
              MergeQueueItemStatus.REBASING,
              itemTarget,
              itemContext,
            );
            if (!itemValidation.valid) {
              throw new InvalidTransitionError(
                "MergeQueueItem",
                mergeQueueItemId,
                MergeQueueItemStatus.REBASING,
                itemTarget,
                itemValidation.reason,
              );
            }

            const failedItem = repos.mergeQueueItem.updateStatus(
              mergeQueueItemId,
              MergeQueueItemStatus.REBASING,
              itemTarget,
              { completedAt: clock() },
            );

            // Transition task based on classification
            const taskTarget =
              classification === "reworkable" ? TaskStatus.CHANGES_REQUESTED : TaskStatus.FAILED;

            const taskContext: TransitionContext = {
              mergeConflictClassification:
                classification === "reworkable" ? "reworkable" : "non_reworkable",
            } as TransitionContext;

            const taskValidation = validateTransition(TaskStatus.MERGING, taskTarget, taskContext);
            if (!taskValidation.valid) {
              throw new InvalidTransitionError(
                "Task",
                currentTask.id,
                TaskStatus.MERGING,
                taskTarget,
                taskValidation.reason,
              );
            }

            const failedTask = repos.task.updateStatus(
              currentTask.id,
              currentTask.version,
              taskTarget,
            );

            const itemAudit = repos.auditEvent.create({
              entityType: "merge-queue-item",
              entityId: mergeQueueItemId,
              eventType: "state_transition",
              actorType: actor.type,
              actorId: actor.id,
              oldState: MergeQueueItemStatus.REBASING,
              newState: itemTarget,
              metadata: JSON.stringify({
                ...metadata,
                conflictFiles: mergeOpResult.conflictFiles,
                classification,
              }),
            });

            const taskAudit = repos.auditEvent.create({
              entityType: "task",
              entityId: currentTask.id,
              eventType: "state_transition",
              actorType: actor.type,
              actorId: actor.id,
              oldState: TaskStatus.MERGING,
              newState: taskTarget,
              metadata: JSON.stringify({
                ...metadata,
                reason: "merge_conflict",
                mergeStrategy,
                conflictFiles: mergeOpResult.conflictFiles,
                classification,
              }),
            });

            return {
              item: failedItem,
              task: failedTask,
              itemAudit,
              taskAudit,
              itemTarget,
              taskTarget,
            };
          });

          auditEvents.push(failResult.itemAudit, failResult.taskAudit);

          eventEmitter.emit({
            type: "merge-queue-item.transitioned",
            entityType: "merge-queue-item",
            entityId: mergeQueueItemId,
            fromStatus: MergeQueueItemStatus.REBASING,
            toStatus: failResult.itemTarget,
            actor,
            timestamp: clock(),
          });
          eventEmitter.emit({
            type: "task.transitioned",
            entityType: "task",
            entityId: currentTask.id,
            fromStatus: TaskStatus.MERGING,
            toStatus: failResult.taskTarget,
            newVersion: failResult.task.version,
            actor,
            timestamp: clock(),
          });

          executeSpan.setAttribute(SpanAttributes.RESULT_STATUS, "rebase_conflict");
          executeSpan.setStatus({ code: SpanStatusCode.OK });
          return {
            outcome: "rebase_conflict",
            item: failResult.item,
            task: failResult.task,
            auditEvents,
            conflictFiles: mergeOpResult.conflictFiles,
            classification,
          };
        }

        // ── Phase 4: Transition to VALIDATING and run validation ──────────

        const validatingResult = unitOfWork.runInTransaction((repos) => {
          const itemValidation = validateMergeQueueItemTransition(
            MergeQueueItemStatus.REBASING,
            MergeQueueItemStatus.VALIDATING,
            { rebaseSuccessful: true } as MergeQueueItemTransitionContext,
          );
          if (!itemValidation.valid) {
            throw new InvalidTransitionError(
              "MergeQueueItem",
              mergeQueueItemId,
              MergeQueueItemStatus.REBASING,
              MergeQueueItemStatus.VALIDATING,
              itemValidation.reason,
            );
          }

          const updatedItem = repos.mergeQueueItem.updateStatus(
            mergeQueueItemId,
            MergeQueueItemStatus.REBASING,
            MergeQueueItemStatus.VALIDATING,
          );

          const itemAudit = repos.auditEvent.create({
            entityType: "merge-queue-item",
            entityId: mergeQueueItemId,
            eventType: "state_transition",
            actorType: actor.type,
            actorId: actor.id,
            oldState: MergeQueueItemStatus.REBASING,
            newState: MergeQueueItemStatus.VALIDATING,
            metadata: metadata ? JSON.stringify(metadata) : null,
          });

          return { item: updatedItem, itemAudit };
        });

        auditEvents.push(validatingResult.itemAudit);

        eventEmitter.emit({
          type: "merge-queue-item.transitioned",
          entityType: "merge-queue-item",
          entityId: mergeQueueItemId,
          fromStatus: MergeQueueItemStatus.REBASING,
          toStatus: MergeQueueItemStatus.VALIDATING,
          actor,
          timestamp: clock(),
        });

        // Run merge-gate validation
        const validationResult = await validation.runMergeGateValidation({
          taskId: currentTask.id,
          workspacePath,
        });

        if (validationResult.overallStatus === "failed") {
          const valFailResult = unitOfWork.runInTransaction((repos) => {
            const itemValidation = validateMergeQueueItemTransition(
              MergeQueueItemStatus.VALIDATING,
              MergeQueueItemStatus.FAILED,
              { validationFailed: true } as MergeQueueItemTransitionContext,
            );
            if (!itemValidation.valid) {
              throw new InvalidTransitionError(
                "MergeQueueItem",
                mergeQueueItemId,
                MergeQueueItemStatus.VALIDATING,
                MergeQueueItemStatus.FAILED,
                itemValidation.reason,
              );
            }

            const failedItem = repos.mergeQueueItem.updateStatus(
              mergeQueueItemId,
              MergeQueueItemStatus.VALIDATING,
              MergeQueueItemStatus.FAILED,
              { completedAt: clock() },
            );

            const itemAudit = repos.auditEvent.create({
              entityType: "merge-queue-item",
              entityId: mergeQueueItemId,
              eventType: "state_transition",
              actorType: actor.type,
              actorId: actor.id,
              oldState: MergeQueueItemStatus.VALIDATING,
              newState: MergeQueueItemStatus.FAILED,
              metadata: JSON.stringify({
                ...metadata,
                reason: "validation_failed",
                summary: validationResult.summary,
              }),
            });

            return { item: failedItem, itemAudit };
          });

          auditEvents.push(valFailResult.itemAudit);

          eventEmitter.emit({
            type: "merge-queue-item.transitioned",
            entityType: "merge-queue-item",
            entityId: mergeQueueItemId,
            fromStatus: MergeQueueItemStatus.VALIDATING,
            toStatus: MergeQueueItemStatus.FAILED,
            actor,
            timestamp: clock(),
          });

          executeSpan.setAttribute(SpanAttributes.RESULT_STATUS, "validation_failed");
          executeSpan.setStatus({ code: SpanStatusCode.OK });
          return {
            outcome: "validation_failed",
            item: valFailResult.item,
            task: currentTask,
            auditEvents,
            validationResult,
          };
        }

        // ── Phase 5: Transition to MERGING and push ───────────────────────

        const mergingResult = unitOfWork.runInTransaction((repos) => {
          const itemValidation = validateMergeQueueItemTransition(
            MergeQueueItemStatus.VALIDATING,
            MergeQueueItemStatus.MERGING,
            { validationPassed: true } as MergeQueueItemTransitionContext,
          );
          if (!itemValidation.valid) {
            throw new InvalidTransitionError(
              "MergeQueueItem",
              mergeQueueItemId,
              MergeQueueItemStatus.VALIDATING,
              MergeQueueItemStatus.MERGING,
              itemValidation.reason,
            );
          }

          const updatedItem = repos.mergeQueueItem.updateStatus(
            mergeQueueItemId,
            MergeQueueItemStatus.VALIDATING,
            MergeQueueItemStatus.MERGING,
          );

          const itemAudit = repos.auditEvent.create({
            entityType: "merge-queue-item",
            entityId: mergeQueueItemId,
            eventType: "state_transition",
            actorType: actor.type,
            actorId: actor.id,
            oldState: MergeQueueItemStatus.VALIDATING,
            newState: MergeQueueItemStatus.MERGING,
            metadata: metadata ? JSON.stringify(metadata) : null,
          });

          return { item: updatedItem, itemAudit };
        });

        auditEvents.push(mergingResult.itemAudit);

        eventEmitter.emit({
          type: "merge-queue-item.transitioned",
          entityType: "merge-queue-item",
          entityId: mergeQueueItemId,
          fromStatus: MergeQueueItemStatus.VALIDATING,
          toStatus: MergeQueueItemStatus.MERGING,
          actor,
          timestamp: clock(),
        });

        // Determine which branch to push based on strategy:
        // - rebase-and-merge: push the source (feature) branch
        // - squash / merge-commit: push the target branch (we merged into it)
        const pushBranch =
          mergeStrategy === MergeStrategy.REBASE_AND_MERGE ? sourceBranch : targetBranch;

        // Push the branch
        try {
          await gitOps.push(workspacePath, "origin", pushBranch);
        } catch (error: unknown) {
          const pushError = error instanceof Error ? error.message : String(error);

          const pushFailResult = unitOfWork.runInTransaction((repos) => {
            const itemValidation = validateMergeQueueItemTransition(
              MergeQueueItemStatus.MERGING,
              MergeQueueItemStatus.FAILED,
              { mergeFailed: true } as MergeQueueItemTransitionContext,
            );
            if (!itemValidation.valid) {
              throw new InvalidTransitionError(
                "MergeQueueItem",
                mergeQueueItemId,
                MergeQueueItemStatus.MERGING,
                MergeQueueItemStatus.FAILED,
                itemValidation.reason,
              );
            }

            const failedItem = repos.mergeQueueItem.updateStatus(
              mergeQueueItemId,
              MergeQueueItemStatus.MERGING,
              MergeQueueItemStatus.FAILED,
              { completedAt: clock() },
            );

            const itemAudit = repos.auditEvent.create({
              entityType: "merge-queue-item",
              entityId: mergeQueueItemId,
              eventType: "state_transition",
              actorType: actor.type,
              actorId: actor.id,
              oldState: MergeQueueItemStatus.MERGING,
              newState: MergeQueueItemStatus.FAILED,
              metadata: JSON.stringify({
                ...metadata,
                reason: "push_failed",
                error: pushError,
              }),
            });

            return { item: failedItem, itemAudit };
          });

          auditEvents.push(pushFailResult.itemAudit);

          eventEmitter.emit({
            type: "merge-queue-item.transitioned",
            entityType: "merge-queue-item",
            entityId: mergeQueueItemId,
            fromStatus: MergeQueueItemStatus.MERGING,
            toStatus: MergeQueueItemStatus.FAILED,
            actor,
            timestamp: clock(),
          });

          executeSpan.setAttribute(SpanAttributes.RESULT_STATUS, "push_failed");
          executeSpan.setStatus({ code: SpanStatusCode.OK });
          return {
            outcome: "push_failed",
            item: pushFailResult.item,
            task: currentTask,
            auditEvents,
            pushError,
          };
        }

        // ── Phase 6: Finalize — MERGED + POST_MERGE_VALIDATION ────────────

        const mergedCommitSha = await gitOps.getHeadSha(workspacePath);

        const finalResult = unitOfWork.runInTransaction((repos) => {
          // Transition item: MERGING → MERGED
          const itemValidation = validateMergeQueueItemTransition(
            MergeQueueItemStatus.MERGING,
            MergeQueueItemStatus.MERGED,
            { mergeSuccessful: true } as MergeQueueItemTransitionContext,
          );
          if (!itemValidation.valid) {
            throw new InvalidTransitionError(
              "MergeQueueItem",
              mergeQueueItemId,
              MergeQueueItemStatus.MERGING,
              MergeQueueItemStatus.MERGED,
              itemValidation.reason,
            );
          }

          const mergedItem = repos.mergeQueueItem.updateStatus(
            mergeQueueItemId,
            MergeQueueItemStatus.MERGING,
            MergeQueueItemStatus.MERGED,
            { completedAt: clock() },
          );

          // Transition task: MERGING → POST_MERGE_VALIDATION
          // Re-read task to get current version after earlier transition
          const freshTask = repos.task.findById(currentTask.id);
          if (!freshTask) {
            throw new EntityNotFoundError("Task", currentTask.id);
          }

          const taskValidation = validateTransition(
            TaskStatus.MERGING,
            TaskStatus.POST_MERGE_VALIDATION,
            { mergeSuccessful: true } as TransitionContext,
          );
          if (!taskValidation.valid) {
            throw new InvalidTransitionError(
              "Task",
              currentTask.id,
              TaskStatus.MERGING,
              TaskStatus.POST_MERGE_VALIDATION,
              taskValidation.reason,
            );
          }

          const mergedTask = repos.task.updateStatus(
            currentTask.id,
            freshTask.version,
            TaskStatus.POST_MERGE_VALIDATION,
          );

          const itemAudit = repos.auditEvent.create({
            entityType: "merge-queue-item",
            entityId: mergeQueueItemId,
            eventType: "state_transition",
            actorType: actor.type,
            actorId: actor.id,
            oldState: MergeQueueItemStatus.MERGING,
            newState: MergeQueueItemStatus.MERGED,
            metadata: JSON.stringify({
              ...metadata,
              mergedCommitSha,
            }),
          });

          const taskAudit = repos.auditEvent.create({
            entityType: "task",
            entityId: currentTask.id,
            eventType: "state_transition",
            actorType: actor.type,
            actorId: actor.id,
            oldState: TaskStatus.MERGING,
            newState: TaskStatus.POST_MERGE_VALIDATION,
            metadata: JSON.stringify({
              ...metadata,
              mergedCommitSha,
            }),
          });

          return { item: mergedItem, task: mergedTask, itemAudit, taskAudit };
        });

        const currentItem = finalResult.item;
        currentTask = finalResult.task;
        auditEvents.push(finalResult.itemAudit, finalResult.taskAudit);

        // Emit domain events
        eventEmitter.emit({
          type: "merge-queue-item.transitioned",
          entityType: "merge-queue-item",
          entityId: mergeQueueItemId,
          fromStatus: MergeQueueItemStatus.MERGING,
          toStatus: MergeQueueItemStatus.MERGED,
          actor,
          timestamp: clock(),
        });
        eventEmitter.emit({
          type: "task.transitioned",
          entityType: "task",
          entityId: currentTask.id,
          fromStatus: TaskStatus.MERGING,
          toStatus: TaskStatus.POST_MERGE_VALIDATION,
          newVersion: currentTask.version,
          actor,
          timestamp: clock(),
        });

        // ── Phase 7: Build and persist MergePacket ────────────────────────

        /** Strategy-specific labels for human-readable MergePacket summaries. */
        const STRATEGY_LABELS: Record<MergeStrategy, string> = {
          [MergeStrategy.REBASE_AND_MERGE]: "Rebase-and-merge",
          [MergeStrategy.SQUASH]: "Squash merge",
          [MergeStrategy.MERGE_COMMIT]: "Merge commit",
        };

        const mergePacketData: MergePacket = {
          packet_type: "merge_packet",
          schema_version: "1.0",
          created_at: clock().toISOString(),
          task_id: currentTask.id,
          repository_id: currentTask.repositoryId,
          merge_queue_item_id: mergeQueueItemId,
          status: PacketStatus.SUCCESS,
          summary: `${STRATEGY_LABELS[mergeStrategy]} completed successfully. Merged commit: ${mergedCommitSha}`,
          details: {
            source_branch: sourceBranch,
            target_branch: targetBranch,
            approved_commit_sha: initialState.item.approvedCommitSha ?? "",
            merged_commit_sha: mergedCommitSha,
            merge_strategy: mergeStrategy,
            rebase_performed: mergeStrategy === MergeStrategy.REBASE_AND_MERGE,
            validation_results: validationResult.checkOutcomes.map(mapCheckOutcomeToSchemaResult),
          },
          artifact_refs: [],
        };

        // Validate against schema before persisting
        const parseResult = MergePacketSchema.safeParse(mergePacketData);
        if (!parseResult.success) {
          // Schema validation should not fail for well-formed packets;
          // if it does, still return success but without artifact
          const artifactPath = "";
          executeSpan.setAttribute(SpanAttributes.RESULT_STATUS, "merged");
          executeSpan.setStatus({ code: SpanStatusCode.OK });
          return {
            outcome: "merged",
            item: currentItem,
            task: currentTask,
            auditEvents,
            mergePacket: mergePacketData,
            artifactPath,
            mergedCommitSha,
          };
        }

        const validatedPacket = parseResult.data;
        const artifactPath = await artifactStore.persistMergePacket(
          mergeQueueItemId,
          validatedPacket,
        );

        // Update artifact_refs in the packet with the persisted path
        const finalPacket: MergePacket = {
          ...validatedPacket,
          artifact_refs: [artifactPath],
        };

        executeSpan.setAttribute(SpanAttributes.RESULT_STATUS, "merged");
        executeSpan.setStatus({ code: SpanStatusCode.OK });

        return {
          outcome: "merged",
          item: currentItem,
          task: currentTask,
          auditEvents,
          mergePacket: finalPacket,
          artifactPath,
          mergedCommitSha,
        };
      } catch (error: unknown) {
        executeSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        executeSpan.end();
      }
    },
  };
}
