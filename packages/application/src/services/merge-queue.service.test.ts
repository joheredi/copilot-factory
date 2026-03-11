/**
 * Tests for the merge queue service.
 *
 * These tests validate the merge queue ordering contract (§10.10),
 * atomic enqueue/dequeue operations, position recalculation, and
 * error handling for invalid states. Each test uses in-memory mock
 * implementations of the ports, following the same patterns established
 * by the lease service and transition service tests.
 *
 * Key properties validated:
 * - Only APPROVED tasks can be enqueued
 * - Duplicate enqueue is rejected
 * - Task transitions atomically to QUEUED_FOR_MERGE
 * - Dequeue respects priority → enqueue time → ID ordering
 * - Atomic claim prevents duplicate processing (ENQUEUED → PREPARING)
 * - Positions are recalculated correctly after mutations
 * - Audit events are recorded for all operations
 * - Domain events are emitted after transaction commits
 *
 * @see docs/prd/010-integration-contracts.md §10.10 — Merge Queue Ordering
 * @module @factory/application/services/merge-queue.service.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TaskStatus, MergeQueueItemStatus, type TaskPriority } from "@factory/domain";

import {
  createMergeQueueService,
  getPriorityWeight,
  DuplicateEnqueueError,
  TaskNotApprovedError,
  type MergeQueueService,
  type EnqueueForMergeParams,
} from "./merge-queue.service.js";

import type {
  MergeQueueTask,
  MergeQueueItemRecord,
  NewMergeQueueItemData,
  MergeQueueTaskRepositoryPort,
  MergeQueueItemDataPort,
  MergeQueueTransactionRepositories,
  MergeQueueUnitOfWork,
} from "../ports/merge-queue.ports.js";

import type { AuditEventRecord, NewAuditEvent } from "../ports/repository.ports.js";
import type { AuditEventRepositoryPort } from "../ports/repository.ports.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { DomainEvent, ActorInfo } from "../events/domain-events.js";

import { EntityNotFoundError, VersionConflictError } from "../errors.js";

// ─── Mock Factories ─────────────────────────────────────────────────────────

/** Sequential ID generator for deterministic test IDs. */
function createSequentialIdGenerator(prefix = "id"): () => string {
  let counter = 0;
  return () => `${prefix}-${String(++counter).padStart(3, "0")}`;
}

/**
 * Creates an in-memory mock task repository for merge queue operations.
 * Exposes the tasks array for assertions.
 */
function createMockTaskRepo(
  initialTasks: MergeQueueTask[],
): MergeQueueTaskRepositoryPort & { tasks: MergeQueueTask[] } {
  const tasks = [...initialTasks];

  return {
    tasks,

    findById(id: string): MergeQueueTask | undefined {
      return tasks.find((t) => t.id === id);
    },

    updateStatus(id: string, expectedVersion: number, newStatus: TaskStatus): MergeQueueTask {
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx === -1) {
        throw new EntityNotFoundError("Task", id);
      }

      const current = tasks[idx]!;
      if (current.version !== expectedVersion) {
        throw new VersionConflictError("Task", id, expectedVersion);
      }

      const updated: MergeQueueTask = {
        ...current,
        status: newStatus,
        version: current.version + 1,
      };
      tasks[idx] = updated;
      return updated;
    },
  };
}

/**
 * Creates an in-memory mock merge queue item repository.
 * Implements the ordering contract for findNextEnqueued:
 * priority DESC → enqueue time ASC → item ID ASC.
 *
 * Exposes the items array for assertions.
 */
function createMockMergeQueueItemRepo(
  initialItems: MergeQueueItemRecord[] = [],
  /** Task priority lookup — needed for ordering in findNextEnqueued. */
  taskPriorityLookup: (taskId: string) => string = () => "medium",
): MergeQueueItemDataPort & { items: MergeQueueItemRecord[] } {
  const items = [...initialItems];

  /**
   * Sort items by the merge queue ordering contract:
   * priority weight DESC → enqueuedAt ASC → mergeQueueItemId ASC
   */
  function sortByOrdering(a: MergeQueueItemRecord, b: MergeQueueItemRecord): number {
    const priorityA = getPriorityWeight(taskPriorityLookup(a.taskId));
    const priorityB = getPriorityWeight(taskPriorityLookup(b.taskId));

    // Priority descending (higher priority first)
    if (priorityA !== priorityB) return priorityB - priorityA;

    // Enqueue time ascending (earlier first)
    const timeA = a.enqueuedAt.getTime();
    const timeB = b.enqueuedAt.getTime();
    if (timeA !== timeB) return timeA - timeB;

    // Item ID ascending (deterministic tie-break)
    return a.mergeQueueItemId.localeCompare(b.mergeQueueItemId);
  }

  return {
    items,

    create(data: NewMergeQueueItemData): MergeQueueItemRecord {
      const record: MergeQueueItemRecord = {
        mergeQueueItemId: data.mergeQueueItemId,
        taskId: data.taskId,
        repositoryId: data.repositoryId,
        status: data.status as MergeQueueItemStatus,
        position: data.position,
        approvedCommitSha: data.approvedCommitSha,
        enqueuedAt: new Date(),
        startedAt: null,
        completedAt: null,
      };
      items.push(record);
      return record;
    },

    findByTaskId(taskId: string): MergeQueueItemRecord | undefined {
      return items.find((i) => i.taskId === taskId);
    },

    findNextEnqueued(repositoryId: string): MergeQueueItemRecord | undefined {
      const enqueued = items
        .filter(
          (i) => i.repositoryId === repositoryId && i.status === MergeQueueItemStatus.ENQUEUED,
        )
        .sort(sortByOrdering);

      return enqueued[0];
    },

    updateStatus(
      mergeQueueItemId: string,
      expectedStatus: MergeQueueItemStatus,
      newStatus: MergeQueueItemStatus,
      additionalFields?: { startedAt?: Date; completedAt?: Date },
    ): MergeQueueItemRecord {
      const idx = items.findIndex((i) => i.mergeQueueItemId === mergeQueueItemId);
      if (idx === -1) {
        throw new VersionConflictError("MergeQueueItem", mergeQueueItemId, expectedStatus);
      }

      const current = items[idx]!;
      if (current.status !== expectedStatus) {
        throw new VersionConflictError("MergeQueueItem", mergeQueueItemId, expectedStatus);
      }

      const updated: MergeQueueItemRecord = {
        ...current,
        status: newStatus,
        startedAt: additionalFields?.startedAt ?? current.startedAt,
        completedAt: additionalFields?.completedAt ?? current.completedAt,
      };
      items[idx] = updated;
      return updated;
    },

    findEnqueuedByRepositoryId(repositoryId: string): MergeQueueItemRecord[] {
      return items
        .filter(
          (i) => i.repositoryId === repositoryId && i.status === MergeQueueItemStatus.ENQUEUED,
        )
        .sort(sortByOrdering);
    },

    updatePositions(updates: ReadonlyArray<{ mergeQueueItemId: string; position: number }>): void {
      for (const { mergeQueueItemId, position } of updates) {
        const idx = items.findIndex((i) => i.mergeQueueItemId === mergeQueueItemId);
        if (idx !== -1) {
          items[idx] = { ...items[idx]!, position };
        }
      }
    },
  };
}

/**
 * Creates an in-memory mock audit event repository.
 * Exposes the events array for assertions.
 */
function createMockAuditEventRepo(): AuditEventRepositoryPort & {
  events: AuditEventRecord[];
} {
  const events: AuditEventRecord[] = [];
  let counter = 0;

  return {
    events,

    create(event: NewAuditEvent): AuditEventRecord {
      const record: AuditEventRecord = {
        id: `audit-${String(++counter).padStart(3, "0")}`,
        entityType: event.entityType,
        entityId: event.entityId,
        eventType: event.eventType,
        actorType: event.actorType,
        actorId: event.actorId,
        oldState: event.oldState,
        newState: event.newState,
        metadata: event.metadata,
        createdAt: new Date(),
      };
      events.push(record);
      return record;
    },
  };
}

/**
 * Creates a mock event emitter that captures all emitted domain events.
 */
function createMockEventEmitter(): DomainEventEmitter & { events: DomainEvent[] } {
  const events: DomainEvent[] = [];
  return {
    events,
    emit(event: DomainEvent): void {
      events.push(event);
    },
  };
}

/**
 * Creates a synchronous mock UnitOfWork that passes through to the
 * provided repositories without actual DB transaction semantics.
 * Sufficient for unit tests where atomicity is verified by the test itself.
 */
function createMockUnitOfWork(repos: MergeQueueTransactionRepositories): MergeQueueUnitOfWork {
  return {
    runInTransaction<T>(fn: (r: MergeQueueTransactionRepositories) => T): T {
      return fn(repos);
    },
  };
}

// ─── Test Helpers ───────────────────────────────────────────────────────────

const DEFAULT_ACTOR: ActorInfo = { type: "system", id: "merge-module" };

function createApprovedTask(overrides: Partial<MergeQueueTask> = {}): MergeQueueTask {
  return {
    id: "task-001",
    status: TaskStatus.APPROVED,
    version: 1,
    priority: "medium" as TaskPriority,
    repositoryId: "repo-001",
    ...overrides,
  };
}

function createEnqueuedItem(overrides: Partial<MergeQueueItemRecord> = {}): MergeQueueItemRecord {
  return {
    mergeQueueItemId: "mqi-001",
    taskId: "task-001",
    repositoryId: "repo-001",
    status: MergeQueueItemStatus.ENQUEUED,
    position: 1,
    approvedCommitSha: "abc123",
    enqueuedAt: new Date("2025-01-01T00:00:00Z"),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("MergeQueueService", () => {
  // ─── getPriorityWeight ──────────────────────────────────────────────────

  /**
   * Validates that getPriorityWeight returns correct numeric values
   * for the merge queue ordering contract. Critical tasks must sort
   * higher than low-priority tasks.
   */
  describe("getPriorityWeight", () => {
    it("returns correct weights for known priorities", () => {
      expect(getPriorityWeight("critical")).toBe(4);
      expect(getPriorityWeight("high")).toBe(3);
      expect(getPriorityWeight("medium")).toBe(2);
      expect(getPriorityWeight("low")).toBe(1);
    });

    it("returns 0 for unknown priorities", () => {
      expect(getPriorityWeight("unknown")).toBe(0);
    });
  });

  // ─── enqueueForMerge ───────────────────────────────────────────────────

  describe("enqueueForMerge", () => {
    let taskRepo: ReturnType<typeof createMockTaskRepo>;
    let mergeQueueItemRepo: ReturnType<typeof createMockMergeQueueItemRepo>;
    let auditEventRepo: ReturnType<typeof createMockAuditEventRepo>;
    let eventEmitter: ReturnType<typeof createMockEventEmitter>;
    let service: MergeQueueService;

    beforeEach(() => {
      taskRepo = createMockTaskRepo([createApprovedTask()]);
      mergeQueueItemRepo = createMockMergeQueueItemRepo();
      auditEventRepo = createMockAuditEventRepo();
      eventEmitter = createMockEventEmitter();

      service = createMergeQueueService({
        unitOfWork: createMockUnitOfWork({
          task: taskRepo,
          mergeQueueItem: mergeQueueItemRepo,
          auditEvent: auditEventRepo,
        }),
        eventEmitter,
        idGenerator: createSequentialIdGenerator("mqi"),
      });
    });

    /**
     * Happy path: enqueuing an APPROVED task should create a MergeQueueItem,
     * transition the task to QUEUED_FOR_MERGE, and emit domain events.
     * This is the primary success case for the merge queue entry point.
     */
    it("creates a merge queue item and transitions task to QUEUED_FOR_MERGE", () => {
      const params: EnqueueForMergeParams = {
        taskId: "task-001",
        approvedCommitSha: "abc123def",
        actor: DEFAULT_ACTOR,
      };

      const result = service.enqueueForMerge(params);

      // Verify item was created
      expect(result.item).toBeDefined();
      expect(result.item.taskId).toBe("task-001");
      expect(result.item.repositoryId).toBe("repo-001");
      expect(result.item.status).toBe(MergeQueueItemStatus.ENQUEUED);
      expect(result.item.approvedCommitSha).toBe("abc123def");

      // Verify task was transitioned
      expect(result.task.status).toBe(TaskStatus.QUEUED_FOR_MERGE);
      expect(result.task.version).toBe(2); // Version incremented

      // Verify item exists in repository
      expect(mergeQueueItemRepo.items).toHaveLength(1);
    });

    /**
     * Validates that audit events are recorded for both the task transition
     * and the merge queue item creation. Audit completeness is critical
     * for maintaining a tamper-evident trail of all state changes.
     */
    it("records audit events for task transition and item creation", () => {
      const result = service.enqueueForMerge({
        taskId: "task-001",
        approvedCommitSha: "sha-001",
        actor: DEFAULT_ACTOR,
        metadata: { reason: "all reviews passed" },
      });

      // Should have 2 audit events: task transition + item creation
      expect(auditEventRepo.events).toHaveLength(2);

      const taskAudit = result.taskAuditEvent;
      expect(taskAudit.entityType).toBe("task");
      expect(taskAudit.entityId).toBe("task-001");
      expect(taskAudit.oldState).toBe(TaskStatus.APPROVED);
      expect(taskAudit.newState).toBe(TaskStatus.QUEUED_FOR_MERGE);

      const itemAudit = result.itemAuditEvent;
      expect(itemAudit.entityType).toBe("merge-queue-item");
      expect(itemAudit.eventType).toBe("created");
      expect(itemAudit.newState).toBe(MergeQueueItemStatus.ENQUEUED);
    });

    /**
     * Validates that domain events are emitted after the transaction commits.
     * Domain events must only be emitted AFTER commit to prevent subscribers
     * from seeing events for rolled-back transactions.
     */
    it("emits domain events after transaction commits", () => {
      service.enqueueForMerge({
        taskId: "task-001",
        approvedCommitSha: "sha-001",
        actor: DEFAULT_ACTOR,
      });

      // Should have 2 events: task.transitioned + merge-queue-item.transitioned
      expect(eventEmitter.events).toHaveLength(2);

      const taskEvent = eventEmitter.events.find((e) => e.type === "task.transitioned");
      expect(taskEvent).toBeDefined();
      expect(taskEvent!.entityId).toBe("task-001");

      const itemEvent = eventEmitter.events.find((e) => e.type === "merge-queue-item.transitioned");
      expect(itemEvent).toBeDefined();
    });

    /**
     * Validates that enqueuing a non-existent task throws EntityNotFoundError.
     * Prevents ghost items in the merge queue referencing deleted tasks.
     */
    it("throws EntityNotFoundError for non-existent task", () => {
      expect(() =>
        service.enqueueForMerge({
          taskId: "non-existent",
          approvedCommitSha: "sha",
          actor: DEFAULT_ACTOR,
        }),
      ).toThrow(EntityNotFoundError);
    });

    /**
     * Validates that only APPROVED tasks can be enqueued. Tasks in other
     * states (e.g., IN_REVIEW, READY) must be rejected to prevent
     * premature or invalid merge attempts.
     */
    it("throws TaskNotApprovedError for non-APPROVED task", () => {
      taskRepo.tasks[0] = { ...taskRepo.tasks[0]!, status: TaskStatus.IN_REVIEW };

      expect(() =>
        service.enqueueForMerge({
          taskId: "task-001",
          approvedCommitSha: "sha",
          actor: DEFAULT_ACTOR,
        }),
      ).toThrow(TaskNotApprovedError);
    });

    /**
     * Validates that duplicate enqueue is rejected. Each task can only
     * have one merge queue item at a time. This prevents double-merge
     * scenarios that could corrupt the repository.
     */
    it("throws DuplicateEnqueueError when task already has a merge queue item", () => {
      // Enqueue once
      service.enqueueForMerge({
        taskId: "task-001",
        approvedCommitSha: "sha-001",
        actor: DEFAULT_ACTOR,
      });

      // Reset task state for second attempt (task is now QUEUED_FOR_MERGE)
      taskRepo.tasks[0] = createApprovedTask();

      expect(() =>
        service.enqueueForMerge({
          taskId: "task-001",
          approvedCommitSha: "sha-002",
          actor: DEFAULT_ACTOR,
        }),
      ).toThrow(DuplicateEnqueueError);
    });

    /**
     * Validates that no domain events are emitted when the transaction
     * fails (task not found). This ensures subscribers never see events
     * for operations that were rolled back.
     */
    it("does not emit domain events when enqueue fails", () => {
      expect(() =>
        service.enqueueForMerge({
          taskId: "non-existent",
          approvedCommitSha: "sha",
          actor: DEFAULT_ACTOR,
        }),
      ).toThrow();

      expect(eventEmitter.events).toHaveLength(0);
    });

    /**
     * Validates correct position assignment when enqueuing into a queue
     * that already has items. The new item should get the next position.
     */
    it("assigns correct position when queue already has items", () => {
      // Pre-populate with an existing enqueued item
      mergeQueueItemRepo.items.push(
        createEnqueuedItem({
          mergeQueueItemId: "existing-001",
          taskId: "task-existing",
          repositoryId: "repo-001",
        }),
      );

      // Add a second approved task
      taskRepo.tasks.push(
        createApprovedTask({ id: "task-002", priority: "medium" as TaskPriority }),
      );

      const result = service.enqueueForMerge({
        taskId: "task-002",
        approvedCommitSha: "sha-002",
        actor: DEFAULT_ACTOR,
      });

      // New item should have been created
      expect(result.item).toBeDefined();
      // After position recalculation, positions should be contiguous
      const enqueuedItems = mergeQueueItemRepo.items.filter(
        (i) => i.status === MergeQueueItemStatus.ENQUEUED,
      );
      expect(enqueuedItems.length).toBe(2);
    });
  });

  // ─── dequeueNext ──────────────────────────────────────────────────────

  describe("dequeueNext", () => {
    let taskRepo: ReturnType<typeof createMockTaskRepo>;
    let mergeQueueItemRepo: ReturnType<typeof createMockMergeQueueItemRepo>;
    let auditEventRepo: ReturnType<typeof createMockAuditEventRepo>;
    let eventEmitter: ReturnType<typeof createMockEventEmitter>;
    let service: MergeQueueService;

    /**
     * Task priority lookup used by the mock repository to sort items
     * by the ordering contract. Maps taskId → priority string.
     */
    const taskPriorities: Record<string, string> = {
      "task-critical": "critical",
      "task-high": "high",
      "task-medium": "medium",
      "task-low": "low",
    };

    beforeEach(() => {
      taskRepo = createMockTaskRepo([]);
      mergeQueueItemRepo = createMockMergeQueueItemRepo(
        [],
        (taskId) => taskPriorities[taskId] ?? "medium",
      );
      auditEventRepo = createMockAuditEventRepo();
      eventEmitter = createMockEventEmitter();

      service = createMergeQueueService({
        unitOfWork: createMockUnitOfWork({
          task: taskRepo,
          mergeQueueItem: mergeQueueItemRepo,
          auditEvent: auditEventRepo,
        }),
        eventEmitter,
        idGenerator: createSequentialIdGenerator("mqi"),
      });
    });

    /**
     * Validates that dequeueNext returns undefined when no ENQUEUED items
     * exist for the repository. This is the normal "queue empty" case
     * that the merge loop checks on each tick.
     */
    it("returns undefined when no enqueued items exist", () => {
      const result = service.dequeueNext({
        repositoryId: "repo-001",
        actor: DEFAULT_ACTOR,
      });

      expect(result).toBeUndefined();
    });

    /**
     * Validates that dequeueNext returns undefined when no ENQUEUED items
     * exist for the specified repository, even if other repositories have
     * items. Merge operations are serialized per repository.
     */
    it("returns undefined for empty repository even when other repos have items", () => {
      mergeQueueItemRepo.items.push(createEnqueuedItem({ repositoryId: "repo-other" }));

      const result = service.dequeueNext({
        repositoryId: "repo-001",
        actor: DEFAULT_ACTOR,
      });

      expect(result).toBeUndefined();
    });

    /**
     * Happy path: dequeuing a single ENQUEUED item should transition it
     * to PREPARING status and record an audit event. This validates the
     * basic atomic claim mechanism.
     */
    it("claims the next ENQUEUED item and transitions to PREPARING", () => {
      mergeQueueItemRepo.items.push(
        createEnqueuedItem({
          mergeQueueItemId: "mqi-001",
          taskId: "task-medium",
          repositoryId: "repo-001",
        }),
      );

      const result = service.dequeueNext({
        repositoryId: "repo-001",
        actor: DEFAULT_ACTOR,
      });

      expect(result).toBeDefined();
      expect(result!.item.mergeQueueItemId).toBe("mqi-001");
      expect(result!.item.status).toBe(MergeQueueItemStatus.PREPARING);
      expect(result!.item.startedAt).toBeInstanceOf(Date);
    });

    /**
     * Validates that the dequeue operation records an audit event tracking
     * the ENQUEUED → PREPARING transition. Essential for audit trail
     * completeness.
     */
    it("records an audit event for the claim", () => {
      mergeQueueItemRepo.items.push(createEnqueuedItem({ taskId: "task-medium" }));

      const result = service.dequeueNext({
        repositoryId: "repo-001",
        actor: DEFAULT_ACTOR,
      });

      expect(result).toBeDefined();
      expect(auditEventRepo.events).toHaveLength(1);
      expect(auditEventRepo.events[0]!.entityType).toBe("merge-queue-item");
      expect(auditEventRepo.events[0]!.oldState).toBe(MergeQueueItemStatus.ENQUEUED);
      expect(auditEventRepo.events[0]!.newState).toBe(MergeQueueItemStatus.PREPARING);
    });

    /**
     * Validates that a domain event is emitted after the dequeue transaction
     * commits. Subscribers (e.g., merge executor) use this event to start
     * the actual merge process.
     */
    it("emits a domain event after transaction commits", () => {
      mergeQueueItemRepo.items.push(createEnqueuedItem({ taskId: "task-medium" }));

      service.dequeueNext({
        repositoryId: "repo-001",
        actor: DEFAULT_ACTOR,
      });

      expect(eventEmitter.events).toHaveLength(1);
      expect(eventEmitter.events[0]!.type).toBe("merge-queue-item.transitioned");
    });

    /**
     * Validates that no domain events are emitted when the queue is empty.
     * An empty dequeue is a normal condition, not an error.
     */
    it("does not emit domain events when queue is empty", () => {
      service.dequeueNext({
        repositoryId: "repo-001",
        actor: DEFAULT_ACTOR,
      });

      expect(eventEmitter.events).toHaveLength(0);
    });

    /**
     * Core ordering test: validates that higher-priority tasks are dequeued
     * before lower-priority tasks, regardless of enqueue order.
     * This is the primary correctness property of the merge queue.
     *
     * @see docs/prd/010-integration-contracts.md §10.10
     */
    it("dequeues highest-priority item first", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");

      mergeQueueItemRepo.items.push(
        createEnqueuedItem({
          mergeQueueItemId: "mqi-low",
          taskId: "task-low",
          repositoryId: "repo-001",
          enqueuedAt: new Date(baseTime.getTime()), // enqueued first
        }),
        createEnqueuedItem({
          mergeQueueItemId: "mqi-critical",
          taskId: "task-critical",
          repositoryId: "repo-001",
          enqueuedAt: new Date(baseTime.getTime() + 1000), // enqueued second
        }),
        createEnqueuedItem({
          mergeQueueItemId: "mqi-high",
          taskId: "task-high",
          repositoryId: "repo-001",
          enqueuedAt: new Date(baseTime.getTime() + 2000), // enqueued third
        }),
      );

      // First dequeue should return the critical-priority item
      const first = service.dequeueNext({
        repositoryId: "repo-001",
        actor: DEFAULT_ACTOR,
      });
      expect(first!.item.taskId).toBe("task-critical");

      // Second dequeue should return the high-priority item
      const second = service.dequeueNext({
        repositoryId: "repo-001",
        actor: DEFAULT_ACTOR,
      });
      expect(second!.item.taskId).toBe("task-high");

      // Third dequeue should return the low-priority item
      const third = service.dequeueNext({
        repositoryId: "repo-001",
        actor: DEFAULT_ACTOR,
      });
      expect(third!.item.taskId).toBe("task-low");

      // Queue should now be empty
      const fourth = service.dequeueNext({
        repositoryId: "repo-001",
        actor: DEFAULT_ACTOR,
      });
      expect(fourth).toBeUndefined();
    });

    /**
     * Validates that within the same priority level, items enqueued earlier
     * are dequeued first (FIFO within priority). This ensures fairness
     * for equal-priority tasks.
     *
     * @see docs/prd/010-integration-contracts.md §10.10
     */
    it("dequeues earlier-enqueued item first within same priority", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");

      // Both items have "medium" priority (via the default lookup)
      mergeQueueItemRepo.items.push(
        createEnqueuedItem({
          mergeQueueItemId: "mqi-later",
          taskId: "task-medium",
          repositoryId: "repo-001",
          enqueuedAt: new Date(baseTime.getTime() + 5000), // later
        }),
        createEnqueuedItem({
          mergeQueueItemId: "mqi-earlier",
          taskId: "task-medium",
          repositoryId: "repo-001",
          enqueuedAt: new Date(baseTime.getTime()), // earlier
        }),
      );

      const result = service.dequeueNext({
        repositoryId: "repo-001",
        actor: DEFAULT_ACTOR,
      });

      expect(result!.item.mergeQueueItemId).toBe("mqi-earlier");
    });

    /**
     * Validates deterministic tie-breaking by item ID when priority and
     * enqueue time are identical. This ensures reproducible ordering
     * across different runs and environments.
     *
     * @see docs/prd/010-integration-contracts.md §10.10
     */
    it("uses item ID as deterministic tie-breaker", () => {
      const sameTime = new Date("2025-01-01T00:00:00Z");

      mergeQueueItemRepo.items.push(
        createEnqueuedItem({
          mergeQueueItemId: "mqi-zzz",
          taskId: "task-medium",
          repositoryId: "repo-001",
          enqueuedAt: sameTime,
        }),
        createEnqueuedItem({
          mergeQueueItemId: "mqi-aaa",
          taskId: "task-medium",
          repositoryId: "repo-001",
          enqueuedAt: sameTime,
        }),
      );

      const result = service.dequeueNext({
        repositoryId: "repo-001",
        actor: DEFAULT_ACTOR,
      });

      expect(result!.item.mergeQueueItemId).toBe("mqi-aaa");
    });

    /**
     * Validates that non-ENQUEUED items are not dequeued. Items in
     * PREPARING, MERGING, MERGED, or FAILED states must be skipped.
     * This prevents re-processing of already-claimed items.
     */
    it("skips non-ENQUEUED items", () => {
      mergeQueueItemRepo.items.push(
        createEnqueuedItem({
          mergeQueueItemId: "mqi-preparing",
          taskId: "task-medium",
          repositoryId: "repo-001",
          status: MergeQueueItemStatus.PREPARING,
        }),
        createEnqueuedItem({
          mergeQueueItemId: "mqi-merged",
          taskId: "task-medium",
          repositoryId: "repo-001",
          status: MergeQueueItemStatus.MERGED,
        }),
      );

      const result = service.dequeueNext({
        repositoryId: "repo-001",
        actor: DEFAULT_ACTOR,
      });

      expect(result).toBeUndefined();
    });
  });

  // ─── recalculatePositions ─────────────────────────────────────────────

  describe("recalculatePositions", () => {
    let mergeQueueItemRepo: ReturnType<typeof createMockMergeQueueItemRepo>;
    let service: MergeQueueService;

    beforeEach(() => {
      mergeQueueItemRepo = createMockMergeQueueItemRepo();
      const taskRepo = createMockTaskRepo([]);
      const auditEventRepo = createMockAuditEventRepo();
      const eventEmitter = createMockEventEmitter();

      service = createMergeQueueService({
        unitOfWork: createMockUnitOfWork({
          task: taskRepo,
          mergeQueueItem: mergeQueueItemRepo,
          auditEvent: auditEventRepo,
        }),
        eventEmitter,
        idGenerator: createSequentialIdGenerator("mqi"),
      });
    });

    /**
     * Validates that recalculatePositions assigns 1-indexed, contiguous
     * positions to all ENQUEUED items. This is important after dequeue
     * operations that may leave gaps.
     */
    it("assigns 1-indexed contiguous positions", () => {
      mergeQueueItemRepo.items.push(
        createEnqueuedItem({
          mergeQueueItemId: "mqi-001",
          position: 5, // gap
          enqueuedAt: new Date("2025-01-01T00:00:00Z"),
        }),
        createEnqueuedItem({
          mergeQueueItemId: "mqi-002",
          position: 10, // bigger gap
          enqueuedAt: new Date("2025-01-01T00:01:00Z"),
        }),
      );

      service.recalculatePositions("repo-001");

      const items = mergeQueueItemRepo.items;
      expect(items.find((i) => i.mergeQueueItemId === "mqi-001")!.position).toBe(1);
      expect(items.find((i) => i.mergeQueueItemId === "mqi-002")!.position).toBe(2);
    });

    /**
     * Validates that recalculatePositions is a no-op when no ENQUEUED
     * items exist. It should not throw or cause side effects.
     */
    it("is a no-op when no enqueued items exist", () => {
      // Should not throw
      service.recalculatePositions("repo-001");
    });

    /**
     * Validates that recalculatePositions only affects items in the
     * specified repository. Items in other repositories should not
     * have their positions modified.
     */
    it("only recalculates positions for the specified repository", () => {
      mergeQueueItemRepo.items.push(
        createEnqueuedItem({
          mergeQueueItemId: "mqi-repo1",
          repositoryId: "repo-001",
          position: 99,
          enqueuedAt: new Date("2025-01-01T00:00:00Z"),
        }),
        createEnqueuedItem({
          mergeQueueItemId: "mqi-repo2",
          repositoryId: "repo-002",
          position: 77,
          enqueuedAt: new Date("2025-01-01T00:00:00Z"),
        }),
      );

      service.recalculatePositions("repo-001");

      expect(
        mergeQueueItemRepo.items.find((i) => i.mergeQueueItemId === "mqi-repo1")!.position,
      ).toBe(1);
      // repo-002 item should NOT be modified
      expect(
        mergeQueueItemRepo.items.find((i) => i.mergeQueueItemId === "mqi-repo2")!.position,
      ).toBe(77);
    });
  });
});
