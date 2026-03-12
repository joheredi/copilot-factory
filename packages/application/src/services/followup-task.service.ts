/**
 * Follow-up task generation service — creates follow-up tasks from
 * review decisions, post-merge failures, and analysis agent recommendations.
 *
 * This service centralizes follow-up task creation so that all follow-up
 * types (review, revert, diagnostic, hotfix) use consistent logic for:
 *
 * 1. Validating the source task exists
 * 2. Creating the follow-up task record in BACKLOG state
 * 3. Setting appropriate metadata (source, taskType, priority)
 * 4. Creating a `relates_to` dependency from follow-up → source task
 * 5. Recording audit events for traceability
 * 6. Emitting domain events after commit
 *
 * ## Follow-up types
 *
 * | Type         | Source                               | TaskType      | Priority | Source field       |
 * | ------------ | ------------------------------------ | ------------- | -------- | ------------------ |
 * | review       | approved_with_follow_up decision     | chore         | medium   | follow_up          |
 * | revert       | Critical/high post-merge failure     | bug_fix       | critical | follow_up          |
 * | diagnostic   | Low-severity post-merge failure      | chore         | low      | follow_up          |
 * | hotfix       | Analysis agent recommendation        | bug_fix       | high     | follow_up          |
 *
 * All follow-up tasks:
 * - Enter BACKLOG state to be picked up by the scheduler
 * - Get a `relates_to` (non-hard-block) dependency on the source task
 * - Have `source = "follow_up"` per the TaskSource enum
 *
 * @module @factory/application/services/followup-task
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} — follow_up_task_refs
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.11 — Post-Merge Failure Policy
 * @see {@link file://docs/backlog/tasks/T068-followup-task-gen.md}
 */

import { TaskStatus, TaskType, TaskPriority, TaskSource, DependencyType } from "@factory/domain";

import { EntityNotFoundError } from "../errors.js";
import type { ActorInfo, DomainEvent } from "../events/domain-events.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type {
  FollowUpUnitOfWork,
  FollowUpTransactionRepositories,
  FollowUpSourceTask,
  CreatedFollowUpTaskRecord,
  CreatedFollowUpDependency,
  FollowUpAuditEvent,
} from "../ports/followup-task.ports.js";

// ---------------------------------------------------------------------------
// Follow-up source types (discriminated union)
// ---------------------------------------------------------------------------

/**
 * A follow-up from an `approved_with_follow_up` lead review decision.
 *
 * Each entry in `follow_up_task_refs` from the LeadReviewDecisionPacket
 * becomes a separate follow-up task. The ref string is used as the task
 * title; a description is auto-generated with review context.
 */
export interface ReviewFollowUpSource {
  readonly type: "review";
  /** The follow-up task reference strings from the lead review decision. */
  readonly followUpTaskRefs: readonly string[];
  /** The review cycle ID for audit context. */
  readonly reviewCycleId: string;
}

/**
 * A revert task from a post-merge validation failure (critical or high severity).
 *
 * Revert tasks get the highest priority to ensure quick remediation.
 * The description includes the failure context and suggested revert scope.
 *
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.11.3
 */
export interface RevertFollowUpSource {
  readonly type: "revert";
  /** Description of what needs to be reverted. */
  readonly revertDescription: string;
  /** The severity that triggered the revert (critical or high). */
  readonly severity: "critical" | "high";
  /** Optional suggested revert scope (commits, files). */
  readonly revertScope?: {
    readonly commits?: readonly string[];
    readonly files?: readonly string[];
  };
}

/**
 * A diagnostic task from a low-severity post-merge validation failure.
 *
 * Diagnostic tasks are informational — they do not block the merge queue
 * and get lower priority.
 *
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.11.2
 */
export interface DiagnosticFollowUpSource {
  readonly type: "diagnostic";
  /** Description of the diagnostic issue to investigate. */
  readonly diagnosticDescription: string;
  /** Names of the optional checks that failed. */
  readonly failedChecks: readonly string[];
}

/**
 * A hotfix task from an analysis agent's recommendation.
 *
 * Created when the post-merge analysis agent recommends `hotfix_task`
 * instead of a full revert. Gets priority boost for quick resolution.
 *
 * @see docs/prd/008-packet-and-schema-spec.md — PostMergeAnalysisPacket
 */
export interface HotfixFollowUpSource {
  readonly type: "hotfix";
  /** The hotfix description from the analysis agent. */
  readonly hotfixDescription: string;
  /** The failure attribution from the analysis agent. */
  readonly failureAttribution: string;
}

/**
 * Discriminated union of all follow-up task source types.
 *
 * The `type` field determines which metadata is available and how
 * the follow-up task record is constructed.
 */
export type FollowUpSource =
  | ReviewFollowUpSource
  | RevertFollowUpSource
  | DiagnosticFollowUpSource
  | HotfixFollowUpSource;

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

/**
 * Parameters for creating follow-up tasks.
 */
export interface CreateFollowUpTasksParams {
  /** The source task ID that triggered follow-up generation. */
  readonly sourceTaskId: string;

  /** The follow-up source with type-specific context. */
  readonly source: FollowUpSource;

  /** The actor triggering the follow-up creation. */
  readonly actor: ActorInfo;
}

/**
 * A single created follow-up task with its dependency and audit trail.
 */
export interface CreatedFollowUp {
  /** The created follow-up task record. */
  readonly task: CreatedFollowUpTaskRecord;

  /** The dependency edge linking follow-up to source task. */
  readonly dependency: CreatedFollowUpDependency;

  /** The audit event recorded for this follow-up creation. */
  readonly auditEvent: FollowUpAuditEvent;
}

/**
 * Result of follow-up task creation.
 *
 * Contains all created follow-up tasks, their dependencies, and
 * audit events. Multiple tasks may be created from a single source
 * (e.g., review follow-ups with multiple refs).
 */
export interface CreateFollowUpTasksResult {
  /** The source task that triggered follow-up generation. */
  readonly sourceTask: FollowUpSourceTask;

  /** All created follow-up tasks with their dependencies and audit events. */
  readonly followUps: readonly CreatedFollowUp[];

  /** Total number of follow-up tasks created. */
  readonly count: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * The follow-up task generation service interface.
 *
 * Provides a single method for creating follow-up tasks from
 * any supported source type. All task creation, dependency linking,
 * and auditing happen atomically within a transaction.
 */
export interface FollowUpTaskService {
  /**
   * Create follow-up tasks from the given source.
   *
   * Validates the source task exists, creates one or more follow-up
   * task records in BACKLOG state, links them to the source task
   * with a `relates_to` dependency, records audit events, and emits
   * domain events after commit.
   *
   * @param params - The follow-up creation parameters
   * @returns The result with all created follow-ups
   * @throws {EntityNotFoundError} if the source task doesn't exist
   */
  createFollowUpTasks(params: CreateFollowUpTasksParams): CreateFollowUpTasksResult;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into the follow-up task service factory.
 */
export interface FollowUpTaskDependencies {
  /** Unit of work for atomic multi-entity operations. */
  readonly unitOfWork: FollowUpUnitOfWork;

  /** Event emitter for post-commit domain event publication. */
  readonly eventEmitter: DomainEventEmitter;

  /** ID generator for creating unique identifiers (injected for testability). */
  readonly idGenerator?: () => string;

  /** Clock function for timestamps (injected for testability). */
  readonly clock?: () => Date;
}

// ---------------------------------------------------------------------------
// Internal: per-source task construction
// ---------------------------------------------------------------------------

/**
 * Intermediate representation of a follow-up task to be created.
 * Built by the source-specific builder and then persisted in the transaction.
 */
interface FollowUpTaskBlueprint {
  readonly title: string;
  readonly description: string;
  readonly taskType: string;
  readonly priority: string;
}

/**
 * Build task blueprints from a review follow-up source.
 *
 * Each entry in `follow_up_task_refs` becomes a separate follow-up task
 * with the ref as the title and an auto-generated description.
 */
function buildReviewBlueprints(
  source: ReviewFollowUpSource,
  sourceTask: FollowUpSourceTask,
): FollowUpTaskBlueprint[] {
  return source.followUpTaskRefs.map((ref) => ({
    title: ref,
    description:
      `Follow-up from review of task "${sourceTask.title}" (${sourceTask.id}). ` +
      `Review cycle: ${source.reviewCycleId}. ` +
      `This task was created because the lead reviewer approved the changes ` +
      `with follow-up items that should be addressed in subsequent work.`,
    taskType: TaskType.CHORE,
    priority: TaskPriority.MEDIUM,
  }));
}

/**
 * Build a task blueprint from a revert follow-up source.
 *
 * Revert tasks get the highest priority (critical) to ensure rapid
 * remediation of post-merge failures.
 */
function buildRevertBlueprint(
  source: RevertFollowUpSource,
  sourceTask: FollowUpSourceTask,
): FollowUpTaskBlueprint[] {
  const scopeSection = source.revertScope ? buildRevertScopeSection(source.revertScope) : "";

  return [
    {
      title: `Revert: ${source.severity} post-merge failure for ${sourceTask.id}`,
      description:
        `Revert required due to ${source.severity}-severity post-merge validation failure ` +
        `on task "${sourceTask.title}" (${sourceTask.id}).\n\n` +
        `${source.revertDescription}` +
        `${scopeSection}`,
      taskType: TaskType.BUG_FIX,
      priority: TaskPriority.CRITICAL,
    },
  ];
}

/**
 * Build a human-readable scope section for revert task descriptions.
 */
function buildRevertScopeSection(scope: {
  readonly commits?: readonly string[];
  readonly files?: readonly string[];
}): string {
  const parts: string[] = [];
  if (scope.commits && scope.commits.length > 0) {
    parts.push(`\n\nCommits to revert: ${scope.commits.join(", ")}`);
  }
  if (scope.files && scope.files.length > 0) {
    parts.push(`\n\nAffected files:\n${scope.files.map((f) => `- ${f}`).join("\n")}`);
  }
  return parts.join("");
}

/**
 * Build a task blueprint from a diagnostic follow-up source.
 *
 * Diagnostic tasks are informational and get low priority since they
 * only track optional check failures.
 */
function buildDiagnosticBlueprint(
  source: DiagnosticFollowUpSource,
  sourceTask: FollowUpSourceTask,
): FollowUpTaskBlueprint[] {
  const failedChecksList =
    source.failedChecks.length > 0
      ? `\n\nFailed optional checks:\n${source.failedChecks.map((c) => `- ${c}`).join("\n")}`
      : "";

  return [
    {
      title: `Diagnostic: optional check failures after merge of ${sourceTask.id}`,
      description:
        `Diagnostic follow-up for task "${sourceTask.title}" (${sourceTask.id}). ` +
        `Optional validation checks failed after merge but did not block the pipeline.\n\n` +
        `${source.diagnosticDescription}` +
        `${failedChecksList}`,
      taskType: TaskType.CHORE,
      priority: TaskPriority.LOW,
    },
  ];
}

/**
 * Build a task blueprint from a hotfix follow-up source.
 *
 * Hotfix tasks get high priority as an alternative to a full revert
 * when the analysis agent determines the issue is fixable in-place.
 */
function buildHotfixBlueprint(
  source: HotfixFollowUpSource,
  sourceTask: FollowUpSourceTask,
): FollowUpTaskBlueprint[] {
  return [
    {
      title: `Hotfix: post-merge fix for ${sourceTask.id}`,
      description:
        `Hotfix task for post-merge failure on "${sourceTask.title}" (${sourceTask.id}). ` +
        `The analysis agent recommends a targeted fix instead of a full revert.\n\n` +
        `Failure attribution: ${source.failureAttribution}\n\n` +
        `Recommended fix: ${source.hotfixDescription}`,
      taskType: TaskType.BUG_FIX,
      priority: TaskPriority.HIGH,
    },
  ];
}

/**
 * Route to the correct blueprint builder based on the source type.
 */
function buildBlueprints(
  source: FollowUpSource,
  sourceTask: FollowUpSourceTask,
): FollowUpTaskBlueprint[] {
  switch (source.type) {
    case "review":
      return buildReviewBlueprints(source, sourceTask);
    case "revert":
      return buildRevertBlueprint(source, sourceTask);
    case "diagnostic":
      return buildDiagnosticBlueprint(source, sourceTask);
    case "hotfix":
      return buildHotfixBlueprint(source, sourceTask);
  }
}

/**
 * Build the audit event metadata string for a follow-up task creation.
 */
function buildAuditMetadata(
  source: FollowUpSource,
  sourceTaskId: string,
  followUpTaskId: string,
): string {
  const base = {
    sourceTaskId,
    followUpTaskId,
    followUpType: source.type,
  };

  switch (source.type) {
    case "review":
      return JSON.stringify({
        ...base,
        reviewCycleId: source.reviewCycleId,
        followUpRefCount: source.followUpTaskRefs.length,
      });
    case "revert":
      return JSON.stringify({
        ...base,
        severity: source.severity,
        hasRevertScope: source.revertScope !== undefined,
      });
    case "diagnostic":
      return JSON.stringify({
        ...base,
        failedCheckCount: source.failedChecks.length,
      });
    case "hotfix":
      return JSON.stringify({
        ...base,
        hasFailureAttribution: true,
      });
  }
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

/**
 * Creates a FollowUpTaskService instance.
 *
 * The service orchestrates the full follow-up task creation workflow:
 * source task lookup → blueprint construction → task creation →
 * dependency linking → audit recording, all within a single atomic
 * transaction. Domain events are emitted after commit.
 *
 * @param deps - Injected dependencies
 * @returns A FollowUpTaskService instance
 *
 * @example
 * ```ts
 * const service = createFollowUpTaskService({
 *   unitOfWork,
 *   eventEmitter,
 * });
 *
 * // Create follow-ups from a review decision
 * const result = service.createFollowUpTasks({
 *   sourceTaskId: "task-123",
 *   source: {
 *     type: "review",
 *     followUpTaskRefs: ["Add input validation", "Update docs"],
 *     reviewCycleId: "cycle-456",
 *   },
 *   actor: { type: "system", id: "orchestrator" },
 * });
 * // result.count === 2
 * // result.followUps[0].task.status === "BACKLOG"
 * ```
 */
export function createFollowUpTaskService(deps: FollowUpTaskDependencies): FollowUpTaskService {
  const {
    unitOfWork,
    eventEmitter,
    idGenerator = () => crypto.randomUUID(),
    clock = () => new Date(),
  } = deps;

  return {
    createFollowUpTasks(params: CreateFollowUpTasksParams): CreateFollowUpTasksResult {
      // ── Step 1: Execute all reads and writes atomically ──────────
      const transactionResult = unitOfWork.runInTransaction((repos) =>
        createFollowUpsInTransaction(repos, params, idGenerator),
      );

      // ── Step 2: Emit domain events after commit ─────────────────
      for (const followUp of transactionResult.followUps) {
        const event: DomainEvent = {
          type: "task.transitioned",
          entityType: "task",
          entityId: followUp.task.taskId,
          fromStatus: TaskStatus.BACKLOG,
          toStatus: TaskStatus.BACKLOG,
          newVersion: 1,
          actor: params.actor,
          timestamp: clock(),
        };
        eventEmitter.emit(event);
      }

      // ── Step 3: Return result ───────────────────────────────────
      return transactionResult;
    },
  };
}

// ---------------------------------------------------------------------------
// Transaction body
// ---------------------------------------------------------------------------

/**
 * Core transaction logic for creating follow-up tasks.
 *
 * Validates the source task exists, builds blueprints from the source,
 * creates task records, dependency edges, and audit events — all within
 * the caller-provided transaction.
 */
function createFollowUpsInTransaction(
  repos: FollowUpTransactionRepositories,
  params: CreateFollowUpTasksParams,
  idGenerator: () => string,
): CreateFollowUpTasksResult {
  // ── 1. Fetch and validate source task ─────────────────────────
  const sourceTask = repos.sourceTask.findById(params.sourceTaskId);
  if (!sourceTask) {
    throw new EntityNotFoundError("Task", params.sourceTaskId);
  }

  // ── 2. Build blueprints from the follow-up source ─────────────
  const blueprints = buildBlueprints(params.source, sourceTask);

  // ── 3. Create task records, dependency edges, and audit events ─
  const followUps: CreatedFollowUp[] = blueprints.map((blueprint) => {
    const taskId = idGenerator();

    // Create the follow-up task in BACKLOG state
    const task = repos.task.create({
      taskId,
      repositoryId: sourceTask.repositoryId,
      projectId: sourceTask.projectId,
      title: blueprint.title,
      description: blueprint.description,
      taskType: blueprint.taskType,
      priority: blueprint.priority,
      source: TaskSource.FOLLOW_UP,
      status: TaskStatus.BACKLOG,
    });

    // Create a relates_to dependency (informational, not hard-blocking)
    const dependency = repos.dependency.create({
      taskDependencyId: idGenerator(),
      taskId,
      dependsOnTaskId: params.sourceTaskId,
      dependencyType: DependencyType.RELATES_TO,
      isHardBlock: false,
    });

    // Record audit event
    const auditEvent = repos.auditEvent.create({
      entityType: "task",
      entityId: taskId,
      eventType: `task.follow-up-created.${params.source.type}`,
      actorType: params.actor.type,
      actorId: params.actor.id,
      oldState: null,
      newState: TaskStatus.BACKLOG,
      metadata: buildAuditMetadata(params.source, params.sourceTaskId, taskId),
    });

    return { task, dependency, auditEvent };
  });

  return {
    sourceTask,
    followUps,
    count: followUps.length,
  };
}
