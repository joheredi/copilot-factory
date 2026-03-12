/**
 * Tests for the follow-up task generation service.
 *
 * This test suite verifies the centralized follow-up task creation from
 * all supported sources: review decisions, post-merge revert, diagnostic,
 * and hotfix recommendations.
 *
 * Coverage includes:
 *
 * 1. **Review follow-ups**: approved_with_follow_up creates tasks from refs
 * 2. **Revert tasks**: critical/high severity failures create revert tasks
 * 3. **Diagnostic tasks**: low-severity failures create diagnostic tasks
 * 4. **Hotfix tasks**: analysis agent recommendations create hotfix tasks
 * 5. **Dependencies**: each follow-up gets a relates_to dependency on source
 * 6. **Audit trail**: each follow-up produces an audit event
 * 7. **Domain events**: task.transitioned events emitted after commit
 * 8. **Error handling**: missing source task throws EntityNotFoundError
 * 9. **Atomicity**: all operations within a single transaction
 *
 * @module @factory/application/services/followup-task.service.test
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} — follow_up_task_refs
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.11
 */

import { describe, it, expect } from "vitest";

import { TaskStatus, TaskType, TaskPriority, TaskSource, DependencyType } from "@factory/domain";

import { createFollowUpTaskService } from "./followup-task.service.js";
import type {
  FollowUpTaskService,
  ReviewFollowUpSource,
  RevertFollowUpSource,
  DiagnosticFollowUpSource,
  HotfixFollowUpSource,
} from "./followup-task.service.js";
import type {
  FollowUpSourceTask,
  FollowUpUnitOfWork,
  FollowUpTransactionRepositories,
  FollowUpSourceTaskPort,
  FollowUpTaskCreationPort,
  FollowUpDependencyCreationPort,
  FollowUpAuditEventPort,
  NewFollowUpTaskRecord,
  CreatedFollowUpTaskRecord,
  NewFollowUpDependency,
  CreatedFollowUpDependency,
  FollowUpAuditEvent,
} from "../ports/followup-task.ports.js";
import type { DomainEvent, ActorInfo } from "../events/domain-events.js";
import { EntityNotFoundError } from "../errors.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const SOURCE_TASK_ID = "task-source-001";
const REPO_ID = "repo-001";
const PROJECT_ID = "project-001";
const REVIEW_CYCLE_ID = "cycle-001";
const FIXED_DATE = new Date("2025-06-15T12:00:00Z");

const DEFAULT_ACTOR: ActorInfo = { type: "system", id: "orchestrator" };

const DEFAULT_SOURCE_TASK: FollowUpSourceTask = {
  id: SOURCE_TASK_ID,
  status: TaskStatus.APPROVED,
  repositoryId: REPO_ID,
  projectId: PROJECT_ID,
  title: "Implement user authentication",
};

// ─── Fake Implementations ───────────────────────────────────────────────────

/**
 * Create an in-memory source task repository for testing.
 * Validates that the source task lookup works correctly.
 */
function createFakeSourceTaskPort(tasks: Map<string, FollowUpSourceTask>): FollowUpSourceTaskPort {
  return {
    findById(id: string): FollowUpSourceTask | undefined {
      return tasks.get(id);
    },
  };
}

/**
 * Create a fake task creation port that records created tasks.
 * Validates that follow-up tasks are inserted with the correct data.
 */
function createFakeTaskCreationPort(
  createdTasks: CreatedFollowUpTaskRecord[],
): FollowUpTaskCreationPort {
  return {
    create(data: NewFollowUpTaskRecord): CreatedFollowUpTaskRecord {
      const record: CreatedFollowUpTaskRecord = {
        ...data,
        createdAt: FIXED_DATE,
      };
      createdTasks.push(record);
      return record;
    },
  };
}

/**
 * Create a fake dependency creation port that records created edges.
 * Validates that follow-up tasks get linked to source tasks correctly.
 */
function createFakeDependencyPort(
  createdDeps: CreatedFollowUpDependency[],
): FollowUpDependencyCreationPort {
  return {
    create(data: NewFollowUpDependency): CreatedFollowUpDependency {
      const record: CreatedFollowUpDependency = {
        ...data,
        createdAt: FIXED_DATE,
      };
      createdDeps.push(record);
      return record;
    },
  };
}

/**
 * Create a fake audit event port that records audit events.
 * Validates that follow-up creation is audited for traceability.
 */
function createFakeAuditPort(events: FollowUpAuditEvent[]): FollowUpAuditEventPort {
  let nextId = 1;
  return {
    create(event: {
      readonly entityType: string;
      readonly entityId: string;
      readonly eventType: string;
      readonly actorType: string;
      readonly actorId: string;
      readonly oldState: string | null;
      readonly newState: string;
      readonly metadata: string;
    }): FollowUpAuditEvent {
      const record: FollowUpAuditEvent = {
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
 * Test state container for the follow-up task service.
 */
interface TestState {
  tasks: Map<string, FollowUpSourceTask>;
  createdTasks: CreatedFollowUpTaskRecord[];
  createdDeps: CreatedFollowUpDependency[];
  auditEvents: FollowUpAuditEvent[];
  domainEvents: DomainEvent[];
}

/**
 * Create a fresh test state with default source task.
 */
function createTestState(overrides?: Partial<{ sourceTasks: FollowUpSourceTask[] }>): TestState {
  const tasks = new Map<string, FollowUpSourceTask>();
  const sourceTasks = overrides?.sourceTasks ?? [DEFAULT_SOURCE_TASK];
  for (const task of sourceTasks) {
    tasks.set(task.id, task);
  }

  return {
    tasks,
    createdTasks: [],
    createdDeps: [],
    auditEvents: [],
    domainEvents: [],
  };
}

/**
 * Create a service instance with the given test state.
 * Returns both the service and the state for assertions.
 */
function createServiceWithState(state: TestState): {
  service: FollowUpTaskService;
  state: TestState;
} {
  let idCounter = 1;

  const unitOfWork: FollowUpUnitOfWork = {
    runInTransaction<T>(fn: (repos: FollowUpTransactionRepositories) => T): T {
      const repos: FollowUpTransactionRepositories = {
        sourceTask: createFakeSourceTaskPort(state.tasks),
        task: createFakeTaskCreationPort(state.createdTasks),
        dependency: createFakeDependencyPort(state.createdDeps),
        auditEvent: createFakeAuditPort(state.auditEvents),
      };
      return fn(repos);
    },
  };

  const service = createFollowUpTaskService({
    unitOfWork,
    eventEmitter: {
      emit(event: DomainEvent): void {
        state.domainEvents.push(event);
      },
    },
    idGenerator: () => `gen-id-${idCounter++}`,
    clock: () => FIXED_DATE,
  });

  return { service, state };
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("FollowUpTaskService", () => {
  // ── Review Follow-Ups ───────────────────────────────────────────────────

  describe("review follow-ups (approved_with_follow_up)", () => {
    /**
     * Validates that each follow_up_task_ref from a lead review decision
     * becomes a separate follow-up task in BACKLOG state. This is the primary
     * mechanism for tracking review-requested improvements.
     */
    it("creates one task per follow_up_task_ref", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "review",
          followUpTaskRefs: ["Add input validation", "Update API docs", "Add retry logic"],
          reviewCycleId: REVIEW_CYCLE_ID,
        },
        actor: DEFAULT_ACTOR,
      });

      expect(result.count).toBe(3);
      expect(result.followUps).toHaveLength(3);
      expect(result.followUps[0].task.title).toBe("Add input validation");
      expect(result.followUps[1].task.title).toBe("Update API docs");
      expect(result.followUps[2].task.title).toBe("Add retry logic");
    });

    /**
     * Validates that review follow-up tasks have the correct metadata:
     * BACKLOG status, follow_up source, chore type, medium priority.
     * These defaults match the design table in the service JSDoc.
     */
    it("sets correct metadata for review follow-ups", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "review",
          followUpTaskRefs: ["Add input validation"],
          reviewCycleId: REVIEW_CYCLE_ID,
        },
        actor: DEFAULT_ACTOR,
      });

      const task = result.followUps[0].task;
      expect(task.status).toBe(TaskStatus.BACKLOG);
      expect(task.source).toBe(TaskSource.FOLLOW_UP);
      expect(task.taskType).toBe(TaskType.CHORE);
      expect(task.priority).toBe(TaskPriority.MEDIUM);
      expect(task.repositoryId).toBe(REPO_ID);
      expect(task.projectId).toBe(PROJECT_ID);
    });

    /**
     * Validates that the description includes review context (source task
     * title, ID, and review cycle ID) so operators can understand why the
     * follow-up was created without looking up the original review.
     */
    it("includes review context in task description", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "review",
          followUpTaskRefs: ["Add input validation"],
          reviewCycleId: REVIEW_CYCLE_ID,
        },
        actor: DEFAULT_ACTOR,
      });

      const description = result.followUps[0].task.description;
      expect(description).toContain(SOURCE_TASK_ID);
      expect(description).toContain("Implement user authentication");
      expect(description).toContain(REVIEW_CYCLE_ID);
      expect(description).toContain("approved");
    });

    /**
     * Validates that an empty follow_up_task_refs array produces zero
     * follow-up tasks. This is a valid edge case — the service should
     * handle it gracefully rather than erroring.
     */
    it("creates zero tasks for empty follow_up_task_refs", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "review",
          followUpTaskRefs: [],
          reviewCycleId: REVIEW_CYCLE_ID,
        },
        actor: DEFAULT_ACTOR,
      });

      expect(result.count).toBe(0);
      expect(result.followUps).toHaveLength(0);
    });
  });

  // ── Revert Tasks ────────────────────────────────────────────────────────

  describe("revert tasks (post-merge failure)", () => {
    /**
     * Validates that critical post-merge failures produce a revert task
     * with critical priority and bug_fix type. Revert tasks must get the
     * highest priority to ensure rapid remediation per §9.11.3.
     */
    it("creates a revert task with critical priority for critical severity", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "revert",
          revertDescription: "Security check failed after merge",
          severity: "critical",
        },
        actor: DEFAULT_ACTOR,
      });

      expect(result.count).toBe(1);
      const task = result.followUps[0].task;
      expect(task.taskType).toBe(TaskType.BUG_FIX);
      expect(task.priority).toBe(TaskPriority.CRITICAL);
      expect(task.status).toBe(TaskStatus.BACKLOG);
      expect(task.source).toBe(TaskSource.FOLLOW_UP);
      expect(task.title).toContain("Revert");
      expect(task.title).toContain("critical");
    });

    /**
     * Validates that high-severity failures also produce revert tasks.
     * High severity uses the same priority as critical since both require
     * urgent remediation.
     */
    it("creates a revert task for high severity", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "revert",
          revertDescription: "Required check failed",
          severity: "high",
        },
        actor: DEFAULT_ACTOR,
      });

      expect(result.count).toBe(1);
      const task = result.followUps[0].task;
      expect(task.title).toContain("high");
    });

    /**
     * Validates that the revert scope (commits and files) is included
     * in the task description when provided. This gives operators and
     * future workers the specific remediation scope.
     */
    it("includes revert scope in description when provided", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "revert",
          revertDescription: "Security check failed",
          severity: "critical",
          revertScope: {
            commits: ["abc123", "def456"],
            files: ["src/auth.ts", "src/middleware.ts"],
          },
        },
        actor: DEFAULT_ACTOR,
      });

      const description = result.followUps[0].task.description;
      expect(description).toContain("abc123");
      expect(description).toContain("def456");
      expect(description).toContain("src/auth.ts");
      expect(description).toContain("src/middleware.ts");
    });

    /**
     * Validates that the revert description from the caller is included
     * in the task description for context.
     */
    it("includes revert description in task description", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "revert",
          revertDescription: "Security check failed after merge",
          severity: "critical",
        },
        actor: DEFAULT_ACTOR,
      });

      expect(result.followUps[0].task.description).toContain("Security check failed after merge");
    });
  });

  // ── Diagnostic Tasks ──────────────────────────────────────────────────

  describe("diagnostic tasks (low-severity failure)", () => {
    /**
     * Validates that low-severity post-merge failures produce a diagnostic
     * task with low priority and chore type. Diagnostic tasks are
     * informational and don't block the merge queue per §9.11.2.
     */
    it("creates a diagnostic task with low priority", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "diagnostic",
          diagnosticDescription: "Optional linting checks failed",
          failedChecks: ["eslint-warnings", "spell-check"],
        },
        actor: DEFAULT_ACTOR,
      });

      expect(result.count).toBe(1);
      const task = result.followUps[0].task;
      expect(task.taskType).toBe(TaskType.CHORE);
      expect(task.priority).toBe(TaskPriority.LOW);
      expect(task.status).toBe(TaskStatus.BACKLOG);
      expect(task.source).toBe(TaskSource.FOLLOW_UP);
    });

    /**
     * Validates that the failed check names are included in the diagnostic
     * task description for investigative context.
     */
    it("includes failed check names in description", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "diagnostic",
          diagnosticDescription: "Optional linting checks failed",
          failedChecks: ["eslint-warnings", "spell-check"],
        },
        actor: DEFAULT_ACTOR,
      });

      const description = result.followUps[0].task.description;
      expect(description).toContain("eslint-warnings");
      expect(description).toContain("spell-check");
    });
  });

  // ── Hotfix Tasks ──────────────────────────────────────────────────────

  describe("hotfix tasks (analysis agent recommendation)", () => {
    /**
     * Validates that hotfix recommendations from the analysis agent produce
     * a bug_fix task with high priority. Hotfix tasks are an alternative to
     * reverts when the analysis agent determines in-place fixing is viable.
     */
    it("creates a hotfix task with high priority", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "hotfix",
          hotfixDescription: "Fix null check in auth middleware",
          failureAttribution: "Missing null guard on user.permissions",
        },
        actor: DEFAULT_ACTOR,
      });

      expect(result.count).toBe(1);
      const task = result.followUps[0].task;
      expect(task.taskType).toBe(TaskType.BUG_FIX);
      expect(task.priority).toBe(TaskPriority.HIGH);
      expect(task.status).toBe(TaskStatus.BACKLOG);
      expect(task.source).toBe(TaskSource.FOLLOW_UP);
    });

    /**
     * Validates that the hotfix description and failure attribution from
     * the analysis agent are included in the task description so the
     * follow-up worker knows exactly what to fix and why.
     */
    it("includes hotfix description and failure attribution", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "hotfix",
          hotfixDescription: "Fix null check in auth middleware",
          failureAttribution: "Missing null guard on user.permissions",
        },
        actor: DEFAULT_ACTOR,
      });

      const description = result.followUps[0].task.description;
      expect(description).toContain("Fix null check in auth middleware");
      expect(description).toContain("Missing null guard on user.permissions");
    });
  });

  // ── Dependencies ──────────────────────────────────────────────────────

  describe("dependency creation", () => {
    /**
     * Validates that every follow-up task gets a relates_to dependency
     * linking it to the source task. This dependency is informational
     * (not hard-blocking) per the task spec — follow-ups should be
     * schedulable independently but traceable to their origin.
     */
    it("creates relates_to dependency from follow-up to source task", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "review",
          followUpTaskRefs: ["Add validation"],
          reviewCycleId: REVIEW_CYCLE_ID,
        },
        actor: DEFAULT_ACTOR,
      });

      const dep = result.followUps[0].dependency;
      expect(dep.taskId).toBe(result.followUps[0].task.taskId);
      expect(dep.dependsOnTaskId).toBe(SOURCE_TASK_ID);
      expect(dep.dependencyType).toBe(DependencyType.RELATES_TO);
      expect(dep.isHardBlock).toBe(false);
    });

    /**
     * Validates that multiple follow-ups each get their own dependency edge.
     * This is important for review follow-ups where multiple refs produce
     * multiple tasks.
     */
    it("creates one dependency per follow-up task", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "review",
          followUpTaskRefs: ["Task A", "Task B"],
          reviewCycleId: REVIEW_CYCLE_ID,
        },
        actor: DEFAULT_ACTOR,
      });

      expect(state.createdDeps).toHaveLength(2);
      expect(state.createdDeps[0].dependsOnTaskId).toBe(SOURCE_TASK_ID);
      expect(state.createdDeps[1].dependsOnTaskId).toBe(SOURCE_TASK_ID);
      // Each dependency references a different follow-up task
      expect(state.createdDeps[0].taskId).not.toBe(state.createdDeps[1].taskId);
    });
  });

  // ── Audit Trail ───────────────────────────────────────────────────────

  describe("audit events", () => {
    /**
     * Validates that every follow-up task creation produces an audit event.
     * The audit trail is critical for traceability — operators need to know
     * what follow-ups were created, why, and by whom.
     */
    it("records an audit event for each follow-up created", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "review",
          followUpTaskRefs: ["Task A", "Task B"],
          reviewCycleId: REVIEW_CYCLE_ID,
        },
        actor: DEFAULT_ACTOR,
      });

      expect(state.auditEvents).toHaveLength(2);
      expect(state.auditEvents[0].eventType).toBe("task.follow-up-created.review");
      expect(state.auditEvents[0].actorType).toBe("system");
      expect(state.auditEvents[0].actorId).toBe("orchestrator");
      expect(state.auditEvents[0].newState).toBe(TaskStatus.BACKLOG);
      expect(state.auditEvents[0].oldState).toBeNull();
    });

    /**
     * Validates that audit event metadata contains source-specific context.
     * For review follow-ups: reviewCycleId and followUpRefCount.
     */
    it("includes source-specific metadata in review audit events", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "review",
          followUpTaskRefs: ["Task A"],
          reviewCycleId: REVIEW_CYCLE_ID,
        },
        actor: DEFAULT_ACTOR,
      });

      const metadata = JSON.parse(state.auditEvents[0].metadata);
      expect(metadata.sourceTaskId).toBe(SOURCE_TASK_ID);
      expect(metadata.followUpType).toBe("review");
      expect(metadata.reviewCycleId).toBe(REVIEW_CYCLE_ID);
      expect(metadata.followUpRefCount).toBe(1);
    });

    /**
     * Validates that revert audit events include severity information.
     */
    it("includes severity in revert audit event metadata", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "revert",
          revertDescription: "Critical failure",
          severity: "critical",
        },
        actor: DEFAULT_ACTOR,
      });

      const metadata = JSON.parse(state.auditEvents[0].metadata);
      expect(metadata.severity).toBe("critical");
      expect(metadata.followUpType).toBe("revert");
    });

    /**
     * Validates that the event type discriminates by follow-up source.
     */
    it("uses source-specific event types", () => {
      // Test each source type
      const sources: Array<{
        source:
          | ReviewFollowUpSource
          | RevertFollowUpSource
          | DiagnosticFollowUpSource
          | HotfixFollowUpSource;
        expectedType: string;
      }> = [
        {
          source: { type: "review", followUpTaskRefs: ["A"], reviewCycleId: "c" },
          expectedType: "task.follow-up-created.review",
        },
        {
          source: { type: "revert", revertDescription: "x", severity: "critical" },
          expectedType: "task.follow-up-created.revert",
        },
        {
          source: { type: "diagnostic", diagnosticDescription: "x", failedChecks: [] },
          expectedType: "task.follow-up-created.diagnostic",
        },
        {
          source: { type: "hotfix", hotfixDescription: "x", failureAttribution: "y" },
          expectedType: "task.follow-up-created.hotfix",
        },
      ];

      for (const { source, expectedType } of sources) {
        const localState = createTestState();
        const { service: localService } = createServiceWithState(localState);

        localService.createFollowUpTasks({
          sourceTaskId: SOURCE_TASK_ID,
          source,
          actor: DEFAULT_ACTOR,
        });

        expect(localState.auditEvents[0].eventType).toBe(expectedType);
      }
    });
  });

  // ── Domain Events ─────────────────────────────────────────────────────

  describe("domain events", () => {
    /**
     * Validates that a task.transitioned domain event is emitted for each
     * follow-up task after the transaction commits. Downstream consumers
     * (scheduler, notifications) rely on these events to pick up new tasks.
     */
    it("emits task.transitioned event for each follow-up", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "review",
          followUpTaskRefs: ["Task A", "Task B"],
          reviewCycleId: REVIEW_CYCLE_ID,
        },
        actor: DEFAULT_ACTOR,
      });

      expect(state.domainEvents).toHaveLength(2);
      for (const event of state.domainEvents) {
        expect(event.type).toBe("task.transitioned");
        expect(event.entityType).toBe("task");
        expect(event.actor).toEqual(DEFAULT_ACTOR);
      }
    });

    /**
     * Validates that domain events reference the correct follow-up task IDs,
     * not the source task ID. This ensures the scheduler picks up the right
     * entity.
     */
    it("domain events reference follow-up task IDs", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "review",
          followUpTaskRefs: ["Task A"],
          reviewCycleId: REVIEW_CYCLE_ID,
        },
        actor: DEFAULT_ACTOR,
      });

      expect(state.domainEvents[0].entityId).toBe(result.followUps[0].task.taskId);
    });
  });

  // ── Error Handling ────────────────────────────────────────────────────

  describe("error handling", () => {
    /**
     * Validates that a missing source task throws EntityNotFoundError.
     * This prevents orphaned follow-ups that reference nonexistent tasks.
     */
    it("throws EntityNotFoundError when source task does not exist", () => {
      const state = createTestState({ sourceTasks: [] });
      const { service } = createServiceWithState(state);

      expect(() =>
        service.createFollowUpTasks({
          sourceTaskId: "nonexistent-task",
          source: {
            type: "review",
            followUpTaskRefs: ["Task A"],
            reviewCycleId: REVIEW_CYCLE_ID,
          },
          actor: DEFAULT_ACTOR,
        }),
      ).toThrow(EntityNotFoundError);
    });

    /**
     * Validates that the error message includes the missing task ID
     * for diagnostic purposes.
     */
    it("error includes the missing task ID", () => {
      const state = createTestState({ sourceTasks: [] });
      const { service } = createServiceWithState(state);

      expect(() =>
        service.createFollowUpTasks({
          sourceTaskId: "nonexistent-task",
          source: {
            type: "review",
            followUpTaskRefs: ["Task A"],
            reviewCycleId: REVIEW_CYCLE_ID,
          },
          actor: DEFAULT_ACTOR,
        }),
      ).toThrow(/nonexistent-task/);
    });
  });

  // ── Atomicity ─────────────────────────────────────────────────────────

  describe("atomicity", () => {
    /**
     * Validates that all task creation, dependency creation, and audit
     * recording happen within the same transaction call. This is verified
     * by checking that the unit of work's runInTransaction is called
     * exactly once per createFollowUpTasks invocation.
     */
    it("executes all operations within a single transaction", () => {
      let transactionCallCount = 0;
      const state = createTestState();

      const unitOfWork: FollowUpUnitOfWork = {
        runInTransaction<T>(fn: (repos: FollowUpTransactionRepositories) => T): T {
          transactionCallCount++;
          const repos: FollowUpTransactionRepositories = {
            sourceTask: createFakeSourceTaskPort(state.tasks),
            task: createFakeTaskCreationPort(state.createdTasks),
            dependency: createFakeDependencyPort(state.createdDeps),
            auditEvent: createFakeAuditPort(state.auditEvents),
          };
          return fn(repos);
        },
      };

      const service = createFollowUpTaskService({
        unitOfWork,
        eventEmitter: { emit: () => {} },
        idGenerator: () => crypto.randomUUID(),
        clock: () => FIXED_DATE,
      });

      service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "review",
          followUpTaskRefs: ["A", "B", "C"],
          reviewCycleId: REVIEW_CYCLE_ID,
        },
        actor: DEFAULT_ACTOR,
      });

      expect(transactionCallCount).toBe(1);
      // All 3 tasks, 3 deps, 3 audits created within that single transaction
      expect(state.createdTasks).toHaveLength(3);
      expect(state.createdDeps).toHaveLength(3);
      expect(state.auditEvents).toHaveLength(3);
    });
  });

  // ── Source Task Context ───────────────────────────────────────────────

  describe("source task context", () => {
    /**
     * Validates that the result includes the source task record so callers
     * can reference it without a second lookup.
     */
    it("returns the source task in the result", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "review",
          followUpTaskRefs: ["Task A"],
          reviewCycleId: REVIEW_CYCLE_ID,
        },
        actor: DEFAULT_ACTOR,
      });

      expect(result.sourceTask.id).toBe(SOURCE_TASK_ID);
      expect(result.sourceTask.title).toBe("Implement user authentication");
    });

    /**
     * Validates that follow-up tasks inherit the repository and project
     * from the source task. This ensures follow-ups are correctly scoped
     * to the same repository and project context.
     */
    it("inherits repository and project from source task", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "hotfix",
          hotfixDescription: "Fix the issue",
          failureAttribution: "Bad null check",
        },
        actor: DEFAULT_ACTOR,
      });

      expect(result.followUps[0].task.repositoryId).toBe(REPO_ID);
      expect(result.followUps[0].task.projectId).toBe(PROJECT_ID);
    });
  });

  // ── ID Generation ─────────────────────────────────────────────────────

  describe("ID generation", () => {
    /**
     * Validates that each follow-up task and dependency gets a unique ID
     * from the injected ID generator. Two tasks and two dependencies from
     * two refs should produce 4 unique IDs.
     */
    it("generates unique IDs for tasks and dependencies", () => {
      const state = createTestState();
      const { service } = createServiceWithState(state);

      const result = service.createFollowUpTasks({
        sourceTaskId: SOURCE_TASK_ID,
        source: {
          type: "review",
          followUpTaskRefs: ["Task A", "Task B"],
          reviewCycleId: REVIEW_CYCLE_ID,
        },
        actor: DEFAULT_ACTOR,
      });

      const allIds = [
        result.followUps[0].task.taskId,
        result.followUps[0].dependency.taskDependencyId,
        result.followUps[1].task.taskId,
        result.followUps[1].dependency.taskDependencyId,
      ];

      // All IDs should be unique
      expect(new Set(allIds).size).toBe(4);
    });
  });
});
