/**
 * Tests for the post-merge validation service.
 *
 * This test suite verifies the complete post-merge validation and failure
 * policy implementation per §9.11 of the policy spec. It covers:
 *
 * 1. **Happy path**: validation passes → task transitions to DONE
 * 2. **Critical severity**: security check failure OR threshold exceeded →
 *    revert task + queue pause + critical notification
 * 3. **High severity**: required check failure below threshold →
 *    revert task (when analysis agent disabled) + high notification
 * 4. **Low severity**: only optional checks fail →
 *    diagnostic task + informational notification
 * 5. **Precondition enforcement**: wrong state or missing task → errors thrown
 * 6. **Policy customization**: override default failure policy
 * 7. **Audit trail**: all transitions produce audit events
 * 8. **Domain events**: transitions emit domain events
 *
 * @module @factory/application/services/post-merge-validation.service.test
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.11
 */

import { describe, it, expect } from "vitest";

import { TaskStatus } from "@factory/domain";

import {
  createPostMergeValidationService,
  classifyFailureSeverity,
  DEFAULT_POST_MERGE_FAILURE_POLICY,
} from "./post-merge-validation.service.js";
import type {
  PostMergeValidationService,
  PostMergeFailurePolicy,
  ExecutePostMergeValidationParams,
} from "./post-merge-validation.service.js";
import type {
  PostMergeTask,
  PostMergeValidationRunnerPort,
  MergeQueuePausePort,
  OperatorNotificationPort,
  PostMergeUnitOfWork,
  PostMergeTransactionRepositories,
  PostMergeFollowUpTaskRecord,
  PostMergeFollowUpTaskCreationPort,
  PostMergeTaskRepositoryPort,
  CreateFollowUpTaskData,
} from "../ports/post-merge-validation.ports.js";
import type {
  AuditEventRecord,
  NewAuditEvent,
  AuditEventRepositoryPort,
} from "../ports/repository.ports.js";
import type {
  ValidationRunResult,
  ValidationCheckOutcome,
} from "../ports/validation-runner.ports.js";
import type { DomainEvent, ActorInfo } from "../events/domain-events.js";
import { EntityNotFoundError, InvalidTransitionError } from "../errors.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const TASK_ID = "task-post-merge-001";
const REPO_ID = "repo-001";
const PROJECT_ID = "project-001";
const MERGE_QUEUE_ITEM_ID = "mqi-001";
const WORKSPACE_PATH = "/workspaces/task-post-merge-001";
const FIXED_DATE = new Date("2025-06-15T12:00:00Z");

const DEFAULT_ACTOR: ActorInfo = { type: "system", id: "orchestrator" };

// ─── Fake Implementations ───────────────────────────────────────────────────

/**
 * Create an in-memory task repository for testing.
 */
function createFakeTaskRepo(tasks: Map<string, PostMergeTask>): PostMergeTaskRepositoryPort {
  return {
    findById(id: string): PostMergeTask | undefined {
      return tasks.get(id);
    },
    updateStatus(id: string, expectedVersion: number, newStatus: TaskStatus): PostMergeTask {
      const task = tasks.get(id);
      if (!task) throw new EntityNotFoundError("Task", id);
      if (task.version !== expectedVersion) {
        throw new Error(`Version conflict: expected ${expectedVersion}, got ${task.version}`);
      }
      const updated: PostMergeTask = { ...task, status: newStatus, version: task.version + 1 };
      tasks.set(id, updated);
      return updated;
    },
  };
}

/**
 * Create a fake audit event repository that records events.
 */
function createFakeAuditRepo(events: AuditEventRecord[]): AuditEventRepositoryPort {
  let nextId = 1;
  return {
    create(event: NewAuditEvent): AuditEventRecord {
      const record: AuditEventRecord = {
        ...event,
        id: `audit-${nextId++}`,
        createdAt: FIXED_DATE,
      };
      events.push(record);
      return record;
    },
  };
}

/**
 * Create a fake follow-up task creation port that records created tasks.
 */
function createFakeFollowUpTaskPort(
  createdTasks: PostMergeFollowUpTaskRecord[],
): PostMergeFollowUpTaskCreationPort {
  let nextId = 1;
  return {
    createFollowUpTask(data: CreateFollowUpTaskData): PostMergeFollowUpTaskRecord {
      const record: PostMergeFollowUpTaskRecord = {
        id: `followup-${nextId++}`,
        title: data.title,
        taskType: data.taskType,
      };
      createdTasks.push(record);
      return record;
    },
  };
}

/**
 * Create a fake unit of work for post-merge validation.
 */
function createFakeUnitOfWork(
  tasks: Map<string, PostMergeTask>,
  auditEvents: AuditEventRecord[],
  followUpTasks: PostMergeFollowUpTaskRecord[],
): PostMergeUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: PostMergeTransactionRepositories) => T): T {
      return fn({
        task: createFakeTaskRepo(tasks),
        auditEvent: createFakeAuditRepo(auditEvents),
        followUpTask: createFakeFollowUpTaskPort(followUpTasks),
      });
    },
  };
}

/**
 * Create a fake validation runner that returns a configured result.
 */
function createFakeValidationRunner(result: ValidationRunResult): PostMergeValidationRunnerPort {
  return {
    async runMergeGateValidation(): Promise<ValidationRunResult> {
      return result;
    },
  };
}

/**
 * Create a fake merge queue pause port that tracks pause/resume calls.
 */
function createFakeMergeQueuePause(): MergeQueuePausePort & {
  readonly pausedRepos: Map<string, string>;
} {
  const pausedRepos = new Map<string, string>();
  return {
    pausedRepos,
    pauseQueue(repositoryId: string, reason: string): void {
      pausedRepos.set(repositoryId, reason);
    },
    resumeQueue(repositoryId: string): void {
      pausedRepos.delete(repositoryId);
    },
    isPaused(repositoryId: string): boolean {
      return pausedRepos.has(repositoryId);
    },
  };
}

/**
 * Create a fake operator notification port that records notifications.
 */
function createFakeOperatorNotification(): OperatorNotificationPort & {
  readonly notifications: Array<{
    taskId: string;
    repositoryId: string;
    severity: string;
    message: string;
    requiresAction: boolean;
  }>;
} {
  const notifications: Array<{
    taskId: string;
    repositoryId: string;
    severity: string;
    message: string;
    requiresAction: boolean;
  }> = [];
  return {
    notifications,
    notify(n) {
      notifications.push(n);
    },
  };
}

// ─── Validation Result Builders ─────────────────────────────────────────────

/**
 * Build a passing validation result.
 */
function buildPassingResult(): ValidationRunResult {
  return {
    profileName: "merge-gate",
    overallStatus: "passed",
    checkOutcomes: [
      {
        checkName: "test",
        command: "pnpm test",
        category: "required",
        status: "passed",
        durationMs: 1000,
      },
      {
        checkName: "build",
        command: "pnpm build",
        category: "required",
        status: "passed",
        durationMs: 2000,
      },
      {
        checkName: "lint",
        command: "pnpm lint",
        category: "optional",
        status: "passed",
        durationMs: 500,
      },
    ],
    summary: "Validation PASSED for task task-post-merge-001.",
    totalDurationMs: 3500,
    requiredPassedCount: 2,
    requiredFailedCount: 0,
    optionalPassedCount: 1,
    optionalFailedCount: 0,
    skippedCount: 0,
  };
}

/**
 * Build a failing validation result with configurable failures.
 */
function buildFailingResult(overrides?: {
  requiredFailedCount?: number;
  optionalFailedCount?: number;
  securityCheckFailed?: boolean;
  checkOutcomes?: ValidationCheckOutcome[];
}): ValidationRunResult {
  const requiredFailed = overrides?.requiredFailedCount ?? 1;
  const optionalFailed = overrides?.optionalFailedCount ?? 0;
  const securityFailed = overrides?.securityCheckFailed ?? false;

  const outcomes: ValidationCheckOutcome[] = overrides?.checkOutcomes ?? [
    ...(securityFailed
      ? [
          {
            checkName: "security",
            command: "pnpm security-check",
            category: "required" as const,
            status: "failed" as const,
            durationMs: 1000,
          },
        ]
      : []),
    ...Array.from({ length: requiredFailed - (securityFailed ? 1 : 0) }, (_, i) => ({
      checkName: `test-${i}`,
      command: `pnpm test-${i}`,
      category: "required" as const,
      status: "failed" as const,
      durationMs: 1000,
    })),
    {
      checkName: "build",
      command: "pnpm build",
      category: "required" as const,
      status: "passed" as const,
      durationMs: 2000,
    },
    ...Array.from({ length: optionalFailed }, (_, i) => ({
      checkName: `optional-${i}`,
      command: `pnpm optional-${i}`,
      category: "optional" as const,
      status: "failed" as const,
      durationMs: 500,
    })),
  ];

  const totalRequired = outcomes.filter((c) => c.category === "required");
  const totalOptional = outcomes.filter((c) => c.category === "optional");

  return {
    profileName: "merge-gate",
    overallStatus: "failed",
    checkOutcomes: outcomes,
    summary: `Validation FAILED for task ${TASK_ID}.`,
    totalDurationMs: 5000,
    requiredPassedCount: totalRequired.filter((c) => c.status === "passed").length,
    requiredFailedCount: totalRequired.filter((c) => c.status === "failed" || c.status === "error")
      .length,
    optionalPassedCount: totalOptional.filter((c) => c.status === "passed").length,
    optionalFailedCount: totalOptional.filter((c) => c.status === "failed" || c.status === "error")
      .length,
    skippedCount: 0,
  };
}

/**
 * Build a result where only optional checks fail (low severity).
 */
function buildOptionalOnlyFailingResult(): ValidationRunResult {
  return {
    profileName: "merge-gate",
    overallStatus: "failed",
    checkOutcomes: [
      {
        checkName: "test",
        command: "pnpm test",
        category: "required",
        status: "passed",
        durationMs: 1000,
      },
      {
        checkName: "build",
        command: "pnpm build",
        category: "required",
        status: "passed",
        durationMs: 2000,
      },
      {
        checkName: "lint",
        command: "pnpm lint",
        category: "optional",
        status: "failed",
        durationMs: 500,
      },
    ],
    summary: `Validation FAILED for task ${TASK_ID}. Optional checks failed.`,
    totalDurationMs: 3500,
    requiredPassedCount: 2,
    requiredFailedCount: 0,
    optionalPassedCount: 0,
    optionalFailedCount: 1,
    skippedCount: 0,
  };
}

// ─── Test Fixture ───────────────────────────────────────────────────────────

interface TestFixture {
  tasks: Map<string, PostMergeTask>;
  auditEvents: AuditEventRecord[];
  domainEvents: DomainEvent[];
  followUpTasks: PostMergeFollowUpTaskRecord[];
  queuePause: ReturnType<typeof createFakeMergeQueuePause>;
  operatorNotification: ReturnType<typeof createFakeOperatorNotification>;
  service: PostMergeValidationService;
  defaultParams: ExecutePostMergeValidationParams;
}

/**
 * Create a centralized test fixture with configurable overrides.
 *
 * This factory function produces a fully wired PostMergeValidationService
 * with in-memory fakes, enabling deterministic assertions on state changes,
 * audit events, domain events, queue pauses, and notifications.
 */
function createDefaultFixture(overrides?: {
  validationResult?: ValidationRunResult;
  taskStatus?: TaskStatus;
  failurePolicy?: PostMergeFailurePolicy;
}): TestFixture {
  const tasks = new Map<string, PostMergeTask>([
    [
      TASK_ID,
      {
        id: TASK_ID,
        status: overrides?.taskStatus ?? TaskStatus.POST_MERGE_VALIDATION,
        version: 10,
        repositoryId: REPO_ID,
        projectId: PROJECT_ID,
      },
    ],
  ]);

  const auditEvents: AuditEventRecord[] = [];
  const domainEvents: DomainEvent[] = [];
  const followUpTasks: PostMergeFollowUpTaskRecord[] = [];
  const queuePause = createFakeMergeQueuePause();
  const operatorNotification = createFakeOperatorNotification();

  const service = createPostMergeValidationService({
    unitOfWork: createFakeUnitOfWork(tasks, auditEvents, followUpTasks),
    eventEmitter: {
      emit: (e: DomainEvent) => {
        domainEvents.push(e);
      },
    },
    validationRunner: createFakeValidationRunner(
      overrides?.validationResult ?? buildPassingResult(),
    ),
    mergeQueuePause: queuePause,
    operatorNotification,
    clock: () => FIXED_DATE,
  });

  const defaultParams: ExecutePostMergeValidationParams = {
    taskId: TASK_ID,
    workspacePath: WORKSPACE_PATH,
    mergeQueueItemId: MERGE_QUEUE_ITEM_ID,
    actor: DEFAULT_ACTOR,
    metadata: { pipeline: "test" },
    failurePolicy: overrides?.failurePolicy,
  };

  return {
    tasks,
    auditEvents,
    domainEvents,
    followUpTasks,
    queuePause,
    operatorNotification,
    service,
    defaultParams,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("PostMergeValidationService", () => {
  // ── Happy Path ──────────────────────────────────────────────────────────

  describe("executePostMergeValidation — success (validation passes)", () => {
    /**
     * Validates the primary happy path: when all merge-gate checks pass,
     * the task transitions to DONE. This is the most common post-merge
     * outcome and must work correctly for the merge pipeline to complete.
     */
    it("should transition task to DONE when validation passes", async () => {
      const fixture = createDefaultFixture();
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("passed");
      if (result.outcome !== "passed") return;
      expect(result.task.status).toBe(TaskStatus.DONE);
      expect(result.task.version).toBe(11);
    });

    /**
     * Verifies that the success path produces an audit event for the
     * POST_MERGE_VALIDATION → DONE transition. The audit trail is essential
     * for operational observability and compliance.
     */
    it("should record an audit event for the transition", async () => {
      const fixture = createDefaultFixture();
      await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(fixture.auditEvents).toHaveLength(1);
      expect(fixture.auditEvents[0]!.entityType).toBe("task");
      expect(fixture.auditEvents[0]!.oldState).toBe(TaskStatus.POST_MERGE_VALIDATION);
      expect(fixture.auditEvents[0]!.newState).toBe(TaskStatus.DONE);
    });

    /**
     * Verifies that the success path emits a domain event for downstream
     * consumers (e.g., reverse dependency recalculation, notifications).
     */
    it("should emit a task.transitioned domain event", async () => {
      const fixture = createDefaultFixture();
      await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(fixture.domainEvents).toHaveLength(1);
      const event = fixture.domainEvents[0]!;
      expect(event.type).toBe("task.transitioned");
      expect(event.entityId).toBe(TASK_ID);
    });

    /**
     * Verifies that on success, no follow-up tasks are created and the
     * queue is not paused — the merge is considered fully complete.
     */
    it("should not create follow-up tasks or pause queue", async () => {
      const fixture = createDefaultFixture();
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("passed");
      expect(fixture.followUpTasks).toHaveLength(0);
      expect(fixture.queuePause.isPaused(REPO_ID)).toBe(false);
    });

    /**
     * Verifies the validation result is attached to the service result
     * so callers can inspect check details.
     */
    it("should include validation result in the response", async () => {
      const fixture = createDefaultFixture();
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("passed");
      if (result.outcome !== "passed") return;
      expect(result.validationResult.profileName).toBe("merge-gate");
      expect(result.validationResult.overallStatus).toBe("passed");
    });
  });

  // ── Critical Severity ───────────────────────────────────────────────────

  describe("executePostMergeValidation — critical severity", () => {
    /**
     * Verifies that when a security check fails, the failure is classified
     * as critical regardless of other check outcomes. Security failures
     * are the highest-impact post-merge issue per §9.11.1.
     */
    it("should classify security check failure as critical", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ securityCheckFailed: true }),
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.severity).toBe("critical");
    });

    /**
     * Verifies that exceeding the critical_check_threshold (default: 3)
     * triggers critical severity. This handles cascading failures where
     * multiple required checks fail simultaneously after merge.
     */
    it("should classify exceeding critical_check_threshold as critical", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ requiredFailedCount: 4 }),
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.severity).toBe("critical");
    });

    /**
     * Verifies that critical failures generate a revert task when
     * autoRevertOnCritical is true (default). Revert tasks are the
     * primary mechanism for restoring the target branch.
     */
    it("should generate a revert task on critical failure", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ requiredFailedCount: 4 }),
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.followUpTasks).toHaveLength(1);
      expect(result.followUpTasks[0]!.taskType).toBe("revert");
      expect(result.followUpTasks[0]!.title).toContain("Revert");
    });

    /**
     * Verifies the merge queue is paused for the affected repository on
     * critical failure. This prevents other merges from landing on a
     * broken branch per §9.11.2.
     */
    it("should pause merge queue on critical failure", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ requiredFailedCount: 4 }),
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.queuePaused).toBe(true);
      expect(fixture.queuePause.isPaused(REPO_ID)).toBe(true);
    });

    /**
     * Verifies the operator receives a critical notification that
     * requires action. The operator must manually resume the queue
     * after investigating per §9.11.4.
     */
    it("should send critical operator notification", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ requiredFailedCount: 4 }),
      });
      await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(fixture.operatorNotification.notifications).toHaveLength(1);
      const notification = fixture.operatorNotification.notifications[0]!;
      expect(notification.severity).toBe("critical");
      expect(notification.requiresAction).toBe(true);
      expect(notification.message).toContain("CRITICAL");
    });

    /**
     * Verifies the task transitions to FAILED on critical post-merge
     * validation failure with the correct audit metadata.
     */
    it("should transition task to FAILED with severity metadata", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ requiredFailedCount: 4 }),
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.task.status).toBe(TaskStatus.FAILED);

      expect(fixture.auditEvents).toHaveLength(1);
      const auditMetadata = JSON.parse(fixture.auditEvents[0]!.metadata);
      expect(auditMetadata.failureSeverity).toBe("critical");
    });
  });

  // ── High Severity ─────────────────────────────────────────────────────

  describe("executePostMergeValidation — high severity", () => {
    /**
     * Verifies that a single required check failure (below critical
     * threshold) is classified as high severity per §9.11.1.
     */
    it("should classify single required check failure as high", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ requiredFailedCount: 1 }),
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.severity).toBe("high");
    });

    /**
     * Verifies that when the analysis agent is disabled (default policy
     * has useAnalysisAgentOnHigh: true, but we override to false), a
     * revert task is generated per §9.11.3 fallback behavior.
     */
    it("should generate revert task when analysis agent disabled", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ requiredFailedCount: 1 }),
        failurePolicy: {
          ...DEFAULT_POST_MERGE_FAILURE_POLICY,
          useAnalysisAgentOnHigh: false,
        },
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.followUpTasks).toHaveLength(1);
      expect(result.followUpTasks[0]!.taskType).toBe("revert");
    });

    /**
     * Verifies that when the analysis agent IS enabled (default), no
     * revert task is created — the agent handles analysis and the
     * orchestrator will apply its recommendation separately.
     */
    it("should not generate revert task when analysis agent enabled", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ requiredFailedCount: 1 }),
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.followUpTasks).toHaveLength(0);
    });

    /**
     * Verifies the merge queue continues processing on high severity
     * failures — only critical failures pause the queue per §9.11.2.
     */
    it("should not pause merge queue on high severity", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ requiredFailedCount: 1 }),
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.queuePaused).toBe(false);
      expect(fixture.queuePause.isPaused(REPO_ID)).toBe(false);
    });

    /**
     * Verifies the operator is notified about high-severity failures
     * with requiresAction: true so they can investigate.
     */
    it("should send high severity operator notification", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ requiredFailedCount: 1 }),
      });
      await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(fixture.operatorNotification.notifications).toHaveLength(1);
      const notification = fixture.operatorNotification.notifications[0]!;
      expect(notification.severity).toBe("high");
      expect(notification.requiresAction).toBe(true);
      expect(notification.message).toContain("HIGH");
    });
  });

  // ── Low Severity ──────────────────────────────────────────────────────

  describe("executePostMergeValidation — low severity", () => {
    /**
     * Verifies that when only optional checks fail, the severity is
     * classified as low. This is the least impactful failure and the
     * merge is still considered to have landed successfully.
     */
    it("should classify optional-only failures as low", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildOptionalOnlyFailingResult(),
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.severity).toBe("low");
    });

    /**
     * Verifies that low-severity failures create a diagnostic follow-up
     * task (not a revert task) per §9.11.2.
     */
    it("should create diagnostic follow-up task", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildOptionalOnlyFailingResult(),
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.followUpTasks).toHaveLength(1);
      expect(result.followUpTasks[0]!.taskType).toBe("diagnostic");
      expect(result.followUpTasks[0]!.title).toContain("Diagnostic");
    });

    /**
     * Verifies the merge queue continues processing on low severity
     * failures — only critical failures pause the queue.
     */
    it("should not pause merge queue on low severity", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildOptionalOnlyFailingResult(),
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.queuePaused).toBe(false);
    });

    /**
     * Verifies the operator receives an informational notification that
     * does not require action.
     */
    it("should send informational notification", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildOptionalOnlyFailingResult(),
      });
      await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(fixture.operatorNotification.notifications).toHaveLength(1);
      const notification = fixture.operatorNotification.notifications[0]!;
      expect(notification.severity).toBe("low");
      expect(notification.requiresAction).toBe(false);
      expect(notification.message).toContain("INFO");
    });
  });

  // ── Precondition Enforcement ──────────────────────────────────────────

  describe("executePostMergeValidation — precondition checks", () => {
    /**
     * Verifies that attempting post-merge validation on a non-existent
     * task throws EntityNotFoundError. This prevents silent failures
     * from stale references.
     */
    it("should throw EntityNotFoundError for missing task", async () => {
      const fixture = createDefaultFixture();
      const params = { ...fixture.defaultParams, taskId: "nonexistent-task" };

      await expect(fixture.service.executePostMergeValidation(params)).rejects.toThrow(
        EntityNotFoundError,
      );
    });

    /**
     * Verifies that a task not in POST_MERGE_VALIDATION state is rejected
     * with InvalidTransitionError. This enforces the state machine invariant
     * that only POST_MERGE_VALIDATION tasks can proceed to DONE or FAILED.
     */
    it("should throw InvalidTransitionError for wrong state", async () => {
      const fixture = createDefaultFixture({
        taskStatus: TaskStatus.IN_DEVELOPMENT,
      });

      await expect(
        fixture.service.executePostMergeValidation(fixture.defaultParams),
      ).rejects.toThrow(InvalidTransitionError);
    });
  });

  // ── Policy Customization ──────────────────────────────────────────────

  describe("executePostMergeValidation — policy customization", () => {
    /**
     * Verifies that a custom critical_check_threshold changes the boundary
     * between high and critical severity classification.
     */
    it("should use custom critical_check_threshold", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ requiredFailedCount: 2 }),
        failurePolicy: {
          ...DEFAULT_POST_MERGE_FAILURE_POLICY,
          criticalCheckThreshold: 1,
        },
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.severity).toBe("critical");
    });

    /**
     * Verifies that disabling autoRevertOnCritical prevents revert task
     * creation even for critical failures. This is an operator escape hatch.
     */
    it("should skip revert task when autoRevertOnCritical is false", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ requiredFailedCount: 4 }),
        failurePolicy: {
          ...DEFAULT_POST_MERGE_FAILURE_POLICY,
          autoRevertOnCritical: false,
        },
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.severity).toBe("critical");
      expect(result.followUpTasks).toHaveLength(0);
    });

    /**
     * Verifies that disabling pauseQueueOnCritical prevents queue pausing
     * even on critical failures.
     */
    it("should not pause queue when pauseQueueOnCritical is false", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ requiredFailedCount: 4 }),
        failurePolicy: {
          ...DEFAULT_POST_MERGE_FAILURE_POLICY,
          pauseQueueOnCritical: false,
        },
      });
      const result = await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(result.outcome).toBe("failed");
      if (result.outcome !== "failed") return;
      expect(result.queuePaused).toBe(false);
      expect(fixture.queuePause.isPaused(REPO_ID)).toBe(false);
    });
  });

  // ── Audit Trail Completeness ──────────────────────────────────────────

  describe("executePostMergeValidation — audit trail", () => {
    /**
     * Verifies that failure audit events include the severity and failure
     * counts in metadata. This is critical for post-incident analysis
     * and debugging.
     */
    it("should include failure details in audit metadata", async () => {
      const fixture = createDefaultFixture({
        validationResult: buildFailingResult({ requiredFailedCount: 2, optionalFailedCount: 1 }),
      });
      await fixture.service.executePostMergeValidation(fixture.defaultParams);

      expect(fixture.auditEvents).toHaveLength(1);
      const auditMetadata = JSON.parse(fixture.auditEvents[0]!.metadata);
      expect(auditMetadata.failureSeverity).toBe("high");
      expect(auditMetadata.requiredFailedCount).toBe(2);
      expect(auditMetadata.optionalFailedCount).toBe(1);
      expect(auditMetadata.validationProfile).toBe("merge-gate");
      expect(auditMetadata.mergeQueueItemId).toBe(MERGE_QUEUE_ITEM_ID);
    });

    /**
     * Verifies that success audit events include the validation profile
     * and status.
     */
    it("should include success details in audit metadata", async () => {
      const fixture = createDefaultFixture();
      await fixture.service.executePostMergeValidation(fixture.defaultParams);

      const auditMetadata = JSON.parse(fixture.auditEvents[0]!.metadata);
      expect(auditMetadata.validationStatus).toBe("passed");
      expect(auditMetadata.validationProfile).toBe("merge-gate");
    });
  });
});

// ─── Unit Tests for classifyFailureSeverity ─────────────────────────────────

describe("classifyFailureSeverity", () => {
  const policy = DEFAULT_POST_MERGE_FAILURE_POLICY;

  /**
   * Verifies the pure classification function handles the security check
   * rule independently of the service integration.
   */
  it("should return critical for security check failure", () => {
    const result = buildFailingResult({ securityCheckFailed: true });
    expect(classifyFailureSeverity(result, policy)).toBe("critical");
  });

  /**
   * Verifies the threshold rule: > criticalCheckThreshold required failures
   * triggers critical severity even without security check failure.
   */
  it("should return critical when required failures exceed threshold", () => {
    const result = buildFailingResult({ requiredFailedCount: 4 });
    expect(classifyFailureSeverity(result, policy)).toBe("critical");
  });

  /**
   * Verifies the boundary: exactly at the threshold is NOT critical —
   * only exceeding it triggers critical. (> not >=)
   */
  it("should return high when required failures equal threshold", () => {
    const result = buildFailingResult({ requiredFailedCount: 3 });
    expect(classifyFailureSeverity(result, policy)).toBe("high");
  });

  /**
   * Verifies single required failure is high severity.
   */
  it("should return high for single required check failure", () => {
    const result = buildFailingResult({ requiredFailedCount: 1 });
    expect(classifyFailureSeverity(result, policy)).toBe("high");
  });

  /**
   * Verifies that only-optional failures produce low severity.
   */
  it("should return low when only optional checks fail", () => {
    const result = buildOptionalOnlyFailingResult();
    expect(classifyFailureSeverity(result, policy)).toBe("low");
  });

  /**
   * Verifies custom threshold changes the boundary between high and critical.
   */
  it("should use custom threshold", () => {
    const customPolicy = { ...policy, criticalCheckThreshold: 1 };
    const result = buildFailingResult({ requiredFailedCount: 2 });
    expect(classifyFailureSeverity(result, customPolicy)).toBe("critical");
  });
});
