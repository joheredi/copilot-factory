/**
 * Tests for the merge executor service.
 *
 * Validates the merge pipeline for all three strategies:
 * - Rebase-and-merge: rebase → validate → push source branch → MERGED
 * - Squash: squash merge → validate → push target branch → MERGED
 * - Merge-commit: merge --no-ff → validate → push target branch → MERGED
 *
 * Also validates:
 * - Rebase/merge conflict with reworkable classification → CHANGES_REQUESTED
 * - Rebase/merge conflict with non-reworkable classification → FAILED
 * - Merge-gate validation failure → item FAILED
 * - Git push failure → item FAILED
 * - Error cases: item not found, wrong status, task not found
 * - Strategy defaults to rebase-and-merge when not specified
 * - Push branch varies per strategy (source for rebase, target for squash/merge-commit)
 *
 * Each test uses fake implementations of all ports (git, validation,
 * conflict classifier, artifact store) to verify orchestration logic
 * without real I/O.
 *
 * @module @factory/application/services/merge-executor.service.test
 */

import { describe, it, expect } from "vitest";
import { TaskStatus, MergeQueueItemStatus, MergeStrategy, PacketStatus } from "@factory/domain";

import { EntityNotFoundError } from "../errors.js";
import type { AuditEventRecord, NewAuditEvent } from "../ports/repository.ports.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { DomainEvent, ActorInfo } from "../events/domain-events.js";
import type {
  ValidationRunResult,
  ValidationCheckOutcome,
} from "../ports/validation-runner.ports.js";
import type {
  MergeExecutorUnitOfWork,
  MergeExecutorTransactionRepositories,
  MergeExecutorTask,
  MergeExecutorItem,
  MergeGitOperationsPort,
  MergeValidationPort,
  MergeArtifactPort,
  ConflictClassifierPort,
  ConflictClassification,
  RebaseResult,
  MergeOperationResult,
  MergeExecutorTaskRepositoryPort,
  MergeExecutorItemRepositoryPort,
} from "../ports/merge-executor.ports.js";

import {
  createMergeExecutorService,
  MergeItemNotPreparingError,
  TaskNotQueuedForMergeError,
  type ExecuteMergeParams,
  type MergeExecutorService,
  type MergeSuccessResult,
  type RebaseConflictResult,
  type ValidationFailedResult,
  type PushFailedResult,
} from "./merge-executor.service.js";

// ─── Test Constants ─────────────────────────────────────────────────────────

const TASK_ID = "task-001";
const ITEM_ID = "mqi-001";
const REPO_ID = "repo-001";
const WORKSPACE = "/workspaces/repo-001/task-001/worktree";
const TARGET_BRANCH = "main";
const SOURCE_BRANCH = "factory/task-001";
const APPROVED_SHA = "abc123";
const MERGED_SHA = "def456";
const FIXED_DATE = new Date("2025-06-15T10:00:00.000Z");

const ACTOR: ActorInfo = { type: "system", id: "merge-executor" };

// ─── Fake Implementations ───────────────────────────────────────────────────

/**
 * Creates a fake in-memory task repository for testing.
 * Tracks tasks by ID and supports status/version updates.
 */
function createFakeTaskRepo(
  tasks: Map<string, MergeExecutorTask>,
): MergeExecutorTaskRepositoryPort {
  return {
    findById(id: string): MergeExecutorTask | undefined {
      return tasks.get(id);
    },
    updateStatus(id: string, expectedVersion: number, newStatus: TaskStatus): MergeExecutorTask {
      const task = tasks.get(id);
      if (!task) throw new EntityNotFoundError("Task", id);
      if (task.version !== expectedVersion) {
        throw new Error(`Version conflict: expected ${expectedVersion}, got ${task.version}`);
      }
      const updated: MergeExecutorTask = {
        ...task,
        status: newStatus,
        version: task.version + 1,
      };
      tasks.set(id, updated);
      return updated;
    },
  };
}

/**
 * Creates a fake in-memory merge queue item repository for testing.
 * Tracks items by ID and supports status updates.
 */
function createFakeItemRepo(
  items: Map<string, MergeExecutorItem>,
): MergeExecutorItemRepositoryPort {
  return {
    findById(id: string): MergeExecutorItem | undefined {
      return items.get(id);
    },
    updateStatus(
      mergeQueueItemId: string,
      expectedStatus: MergeQueueItemStatus,
      newStatus: MergeQueueItemStatus,
      _additionalFields?: { startedAt?: Date; completedAt?: Date },
    ): MergeExecutorItem {
      const item = items.get(mergeQueueItemId);
      if (!item) throw new EntityNotFoundError("MergeQueueItem", mergeQueueItemId);
      if (item.status !== expectedStatus) {
        throw new Error(`Status conflict: expected ${expectedStatus}, got ${item.status}`);
      }
      const updated: MergeExecutorItem = { ...item, status: newStatus };
      items.set(mergeQueueItemId, updated);
      return updated;
    },
  };
}

/**
 * Creates a fake audit event repository that records events.
 */
function createFakeAuditRepo(events: AuditEventRecord[]) {
  let nextId = 1;
  return {
    create(data: NewAuditEvent): AuditEventRecord {
      const record: AuditEventRecord = {
        auditEventId: `audit-${String(nextId++)}`,
        ...data,
        metadata: data.metadata ?? null,
        occurredAt: FIXED_DATE,
      };
      events.push(record);
      return record;
    },
  };
}

/**
 * Creates a fake unit of work that runs the callback synchronously
 * with shared fake repositories.
 */
function createFakeUnitOfWork(
  tasks: Map<string, MergeExecutorTask>,
  items: Map<string, MergeExecutorItem>,
  auditEvents: AuditEventRecord[],
): MergeExecutorUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: MergeExecutorTransactionRepositories) => T): T {
      const repos: MergeExecutorTransactionRepositories = {
        task: createFakeTaskRepo(tasks),
        mergeQueueItem: createFakeItemRepo(items),
        auditEvent: createFakeAuditRepo(auditEvents),
      };
      return fn(repos);
    },
  };
}

/**
 * Creates a fake git operations port with configurable behavior.
 * Supports all three merge strategies: rebase-and-merge, squash, merge-commit.
 */
function createFakeGitOps(overrides?: {
  rebaseResult?: RebaseResult;
  squashMergeResult?: MergeOperationResult;
  mergeCommitResult?: MergeOperationResult;
  pushError?: Error;
  headSha?: string;
  currentBranch?: string;
}): MergeGitOperationsPort {
  return {
    async fetch(_workspacePath: string, _remote: string): Promise<void> {
      // no-op
    },
    async rebase(_workspacePath: string, _onto: string): Promise<RebaseResult> {
      return overrides?.rebaseResult ?? { success: true, conflictFiles: [] };
    },
    async squashMerge(
      _workspacePath: string,
      _sourceBranch: string,
      _targetBranch: string,
      _commitMessage: string,
    ): Promise<MergeOperationResult> {
      return overrides?.squashMergeResult ?? { success: true, conflictFiles: [] };
    },
    async mergeCommit(
      _workspacePath: string,
      _sourceBranch: string,
      _targetBranch: string,
    ): Promise<MergeOperationResult> {
      return overrides?.mergeCommitResult ?? { success: true, conflictFiles: [] };
    },
    async push(_workspacePath: string, _remote: string, _branch: string): Promise<void> {
      if (overrides?.pushError) {
        throw overrides.pushError;
      }
    },
    async getHeadSha(_workspacePath: string): Promise<string> {
      return overrides?.headSha ?? MERGED_SHA;
    },
    async getCurrentBranch(_workspacePath: string): Promise<string> {
      return overrides?.currentBranch ?? SOURCE_BRANCH;
    },
  };
}

/**
 * Creates a fake validation port with configurable pass/fail behavior.
 */
function createFakeValidation(passed = true): MergeValidationPort {
  const checkOutcomes: ValidationCheckOutcome[] = [
    {
      checkName: "test",
      command: "pnpm test",
      category: "required",
      status: passed ? "passed" : "failed",
      durationMs: 1000,
      output: passed ? "All tests passed" : "3 tests failed",
    },
    {
      checkName: "lint",
      command: "pnpm lint",
      category: "required",
      status: "passed",
      durationMs: 500,
      output: "No lint errors",
    },
  ];

  return {
    async runMergeGateValidation(_params): Promise<ValidationRunResult> {
      return {
        profileName: "merge-gate",
        overallStatus: passed ? "passed" : "failed",
        checkOutcomes,
        summary: passed ? "All checks passed" : "1 required check failed",
        totalDurationMs: 1500,
        requiredPassedCount: passed ? 2 : 1,
        requiredFailedCount: passed ? 0 : 1,
        optionalPassedCount: 0,
        optionalFailedCount: 0,
        skippedCount: 0,
      };
    },
  };
}

/**
 * Creates a fake conflict classifier with a fixed classification.
 */
function createFakeClassifier(
  classification: ConflictClassification = "non_reworkable",
): ConflictClassifierPort {
  return {
    async classify(_conflictFiles: readonly string[]): Promise<ConflictClassification> {
      return classification;
    },
  };
}

/**
 * Creates a fake artifact store that records persisted packets.
 */
function createFakeArtifactStore(
  persistedPackets: Array<{ id: string; packet: Record<string, unknown> }>,
): MergeArtifactPort {
  return {
    async persistMergePacket(
      mergeQueueItemId: string,
      packet: Record<string, unknown>,
    ): Promise<string> {
      persistedPackets.push({ id: mergeQueueItemId, packet });
      return `/artifacts/merge/${mergeQueueItemId}/merge-packet.json`;
    },
  };
}

/**
 * Creates a fake event emitter that captures emitted events.
 */
function createFakeEventEmitter(events: DomainEvent[]): DomainEventEmitter {
  return {
    emit(event: DomainEvent): void {
      events.push(event);
    },
  };
}

// ─── Test Fixtures ──────────────────────────────────────────────────────────

interface TestFixture {
  tasks: Map<string, MergeExecutorTask>;
  items: Map<string, MergeExecutorItem>;
  auditEvents: AuditEventRecord[];
  domainEvents: DomainEvent[];
  persistedPackets: Array<{ id: string; packet: Record<string, unknown> }>;
  service: MergeExecutorService;
  defaultParams: ExecuteMergeParams;
}

function createDefaultFixture(overrides?: {
  gitOps?: MergeGitOperationsPort;
  validation?: MergeValidationPort;
  conflictClassifier?: ConflictClassifierPort;
  artifactStore?: MergeArtifactPort;
}): TestFixture {
  const tasks = new Map<string, MergeExecutorTask>([
    [
      TASK_ID,
      {
        id: TASK_ID,
        status: TaskStatus.QUEUED_FOR_MERGE,
        version: 5,
        repositoryId: REPO_ID,
      },
    ],
  ]);

  const items = new Map<string, MergeExecutorItem>([
    [
      ITEM_ID,
      {
        mergeQueueItemId: ITEM_ID,
        taskId: TASK_ID,
        repositoryId: REPO_ID,
        status: MergeQueueItemStatus.PREPARING,
        approvedCommitSha: APPROVED_SHA,
      },
    ],
  ]);

  const auditEvents: AuditEventRecord[] = [];
  const domainEvents: DomainEvent[] = [];
  const persistedPackets: Array<{ id: string; packet: Record<string, unknown> }> = [];

  const service = createMergeExecutorService({
    unitOfWork: createFakeUnitOfWork(tasks, items, auditEvents),
    eventEmitter: createFakeEventEmitter(domainEvents),
    gitOps: overrides?.gitOps ?? createFakeGitOps(),
    validation: overrides?.validation ?? createFakeValidation(true),
    conflictClassifier: overrides?.conflictClassifier ?? createFakeClassifier(),
    artifactStore: overrides?.artifactStore ?? createFakeArtifactStore(persistedPackets),
    clock: () => FIXED_DATE,
  });

  const defaultParams: ExecuteMergeParams = {
    mergeQueueItemId: ITEM_ID,
    workspacePath: WORKSPACE,
    targetBranch: TARGET_BRANCH,
    actor: ACTOR,
  };

  return { tasks, items, auditEvents, domainEvents, persistedPackets, service, defaultParams };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("MergeExecutorService", () => {
  describe("executeMerge — happy path", () => {
    /**
     * Validates the full successful rebase-and-merge pipeline.
     *
     * This is the primary correctness test: verifies that the merge executor
     * correctly orchestrates rebase, validation, push, state transitions,
     * and MergePacket emission for a clean merge operation.
     */
    it("should complete the full rebase-and-merge pipeline successfully", async () => {
      const fixture = createDefaultFixture();
      const result = await fixture.service.executeMerge(fixture.defaultParams);

      expect(result.outcome).toBe("merged");
      const merged = result as MergeSuccessResult;

      // Final item should be MERGED
      expect(merged.item.status).toBe(MergeQueueItemStatus.MERGED);

      // Final task should be POST_MERGE_VALIDATION
      expect(merged.task.status).toBe(TaskStatus.POST_MERGE_VALIDATION);

      // Merged commit SHA should be captured
      expect(merged.mergedCommitSha).toBe(MERGED_SHA);

      // Artifact path should be set
      expect(merged.artifactPath).toContain("merge-packet.json");
    });

    /**
     * Validates that the MergePacket is correctly assembled with all
     * required fields per the schema (§8.8).
     *
     * Important because the MergePacket is the canonical record of the
     * merge operation consumed by downstream processes.
     */
    it("should emit a valid MergePacket with correct details", async () => {
      const fixture = createDefaultFixture();
      const result = await fixture.service.executeMerge(fixture.defaultParams);

      const merged = result as MergeSuccessResult;
      const packet = merged.mergePacket;

      expect(packet.packet_type).toBe("merge_packet");
      expect(packet.schema_version).toBe("1.0");
      expect(packet.task_id).toBe(TASK_ID);
      expect(packet.repository_id).toBe(REPO_ID);
      expect(packet.merge_queue_item_id).toBe(ITEM_ID);
      expect(packet.status).toBe(PacketStatus.SUCCESS);
      expect(packet.details.source_branch).toBe(SOURCE_BRANCH);
      expect(packet.details.target_branch).toBe(TARGET_BRANCH);
      expect(packet.details.approved_commit_sha).toBe(APPROVED_SHA);
      expect(packet.details.merged_commit_sha).toBe(MERGED_SHA);
      expect(packet.details.merge_strategy).toBe(MergeStrategy.REBASE_AND_MERGE);
      expect(packet.details.rebase_performed).toBe(true);
      expect(packet.details.validation_results).toHaveLength(2);
    });

    /**
     * Validates that all intermediate and final state transitions produce
     * audit events, preserving the full audit trail.
     *
     * Important because audit events are the system's accountability record —
     * every state mutation must be traceable.
     */
    it("should record audit events for all state transitions", async () => {
      const fixture = createDefaultFixture();
      await fixture.service.executeMerge(fixture.defaultParams);

      // Expected audit events:
      // 1. item PREPARING → REBASING
      // 2. task QUEUED_FOR_MERGE → MERGING
      // 3. item REBASING → VALIDATING
      // 4. item VALIDATING → MERGING
      // 5. item MERGING → MERGED
      // 6. task MERGING → POST_MERGE_VALIDATION
      expect(fixture.auditEvents).toHaveLength(6);

      const entityTypes = fixture.auditEvents.map(
        (e) => `${e.entityType}:${e.oldState}→${e.newState}`,
      );
      expect(entityTypes).toContain(
        `merge-queue-item:${MergeQueueItemStatus.PREPARING}→${MergeQueueItemStatus.REBASING}`,
      );
      expect(entityTypes).toContain(`task:${TaskStatus.QUEUED_FOR_MERGE}→${TaskStatus.MERGING}`);
      expect(entityTypes).toContain(
        `merge-queue-item:${MergeQueueItemStatus.REBASING}→${MergeQueueItemStatus.VALIDATING}`,
      );
      expect(entityTypes).toContain(
        `merge-queue-item:${MergeQueueItemStatus.VALIDATING}→${MergeQueueItemStatus.MERGING}`,
      );
      expect(entityTypes).toContain(
        `merge-queue-item:${MergeQueueItemStatus.MERGING}→${MergeQueueItemStatus.MERGED}`,
      );
      expect(entityTypes).toContain(
        `task:${TaskStatus.MERGING}→${TaskStatus.POST_MERGE_VALIDATION}`,
      );
    });

    /**
     * Validates that domain events are emitted after each transaction commits.
     *
     * Important because downstream consumers (scheduler, notification service,
     * metrics) depend on domain events for eventual consistency.
     */
    it("should emit domain events for all transitions", async () => {
      const fixture = createDefaultFixture();
      await fixture.service.executeMerge(fixture.defaultParams);

      // Should emit events for each transition
      const itemEvents = fixture.domainEvents.filter((e) => e.entityType === "merge-queue-item");
      const taskEvents = fixture.domainEvents.filter((e) => e.entityType === "task");

      // Item: PREPARING→REBASING, REBASING→VALIDATING, VALIDATING→MERGING, MERGING→MERGED
      expect(itemEvents).toHaveLength(4);

      // Task: QUEUED_FOR_MERGE→MERGING, MERGING→POST_MERGE_VALIDATION
      expect(taskEvents).toHaveLength(2);
    });

    /**
     * Validates that the MergePacket is persisted via the artifact store.
     *
     * Important because artifacts must survive process restarts and be
     * retrievable for audit, debugging, and downstream processing.
     */
    it("should persist the MergePacket via the artifact store", async () => {
      const fixture = createDefaultFixture();
      await fixture.service.executeMerge(fixture.defaultParams);

      expect(fixture.persistedPackets).toHaveLength(1);
      expect(fixture.persistedPackets[0]!.id).toBe(ITEM_ID);
      expect(fixture.persistedPackets[0]!.packet).toHaveProperty("packet_type", "merge_packet");
    });
  });

  describe("executeMerge — rebase conflict", () => {
    /**
     * Validates that a non-reworkable rebase conflict transitions the task
     * to FAILED and the item to FAILED.
     *
     * Important because non-reworkable conflicts (too many files, protected
     * paths affected) indicate irrecoverable merge failures that should
     * stop the pipeline.
     */
    it("should handle non-reworkable rebase conflict correctly", async () => {
      const conflictFiles = ["src/index.ts", "package.json", ".github/workflows/ci.yml"];
      const fixture = createDefaultFixture({
        gitOps: createFakeGitOps({
          rebaseResult: { success: false, conflictFiles },
        }),
        conflictClassifier: createFakeClassifier("non_reworkable"),
      });

      const result = await fixture.service.executeMerge(fixture.defaultParams);

      expect(result.outcome).toBe("rebase_conflict");
      const conflict = result as RebaseConflictResult;

      expect(conflict.classification).toBe("non_reworkable");
      expect(conflict.conflictFiles).toEqual(conflictFiles);
      expect(conflict.item.status).toBe(MergeQueueItemStatus.FAILED);
      expect(conflict.task.status).toBe(TaskStatus.FAILED);
    });

    /**
     * Validates that a reworkable rebase conflict transitions the task
     * to CHANGES_REQUESTED and the item to REQUEUED.
     *
     * Important because reworkable conflicts should send the task back
     * for developer fix rather than failing permanently.
     */
    it("should handle reworkable rebase conflict correctly", async () => {
      const conflictFiles = ["src/utils.ts"];
      const fixture = createDefaultFixture({
        gitOps: createFakeGitOps({
          rebaseResult: { success: false, conflictFiles },
        }),
        conflictClassifier: createFakeClassifier("reworkable"),
      });

      const result = await fixture.service.executeMerge(fixture.defaultParams);

      expect(result.outcome).toBe("rebase_conflict");
      const conflict = result as RebaseConflictResult;

      expect(conflict.classification).toBe("reworkable");
      expect(conflict.conflictFiles).toEqual(conflictFiles);
      expect(conflict.item.status).toBe(MergeQueueItemStatus.REQUEUED);
      expect(conflict.task.status).toBe(TaskStatus.CHANGES_REQUESTED);
    });

    /**
     * Validates that rebase conflict audit events include conflict details.
     *
     * Important because operators need to understand what went wrong in
     * the merge to take corrective action.
     */
    it("should include conflict details in audit events", async () => {
      const conflictFiles = ["src/main.ts"];
      const fixture = createDefaultFixture({
        gitOps: createFakeGitOps({
          rebaseResult: { success: false, conflictFiles },
        }),
        conflictClassifier: createFakeClassifier("non_reworkable"),
      });

      await fixture.service.executeMerge(fixture.defaultParams);

      // Find the item failure audit event
      const itemFailAudit = fixture.auditEvents.find(
        (e) => e.entityType === "merge-queue-item" && e.newState === MergeQueueItemStatus.FAILED,
      );
      expect(itemFailAudit).toBeDefined();
      const meta = JSON.parse(itemFailAudit!.metadata!) as Record<string, unknown>;
      expect(meta).toHaveProperty("conflictFiles");
      expect(meta).toHaveProperty("classification", "non_reworkable");
    });
  });

  describe("executeMerge — validation failure", () => {
    /**
     * Validates that a merge-gate validation failure transitions the item
     * to FAILED while the task stays in MERGING (for T067 to handle).
     *
     * Important because validation failures after rebase indicate the
     * rebased code doesn't pass quality gates, preventing bad code from
     * being pushed.
     */
    it("should handle validation failure and transition item to FAILED", async () => {
      const fixture = createDefaultFixture({
        validation: createFakeValidation(false),
      });

      const result = await fixture.service.executeMerge(fixture.defaultParams);

      expect(result.outcome).toBe("validation_failed");
      const valFail = result as ValidationFailedResult;

      expect(valFail.item.status).toBe(MergeQueueItemStatus.FAILED);
      // Task stays in MERGING (validation fail doesn't transition task,
      // that's T067's responsibility)
      expect(valFail.task.status).toBe(TaskStatus.MERGING);
      expect(valFail.validationResult.overallStatus).toBe("failed");
    });

    /**
     * Validates that the validation result details are preserved in the
     * failure result for diagnostic purposes.
     */
    it("should include validation run result in the failure", async () => {
      const fixture = createDefaultFixture({
        validation: createFakeValidation(false),
      });

      const result = await fixture.service.executeMerge(fixture.defaultParams);
      const valFail = result as ValidationFailedResult;

      expect(valFail.validationResult.checkOutcomes).toHaveLength(2);
      expect(valFail.validationResult.summary).toContain("failed");
    });
  });

  describe("executeMerge — push failure", () => {
    /**
     * Validates that a git push failure transitions the item to FAILED.
     *
     * Important because push failures (network issues, force-push protection,
     * etc.) are a real failure mode that must be handled gracefully.
     */
    it("should handle push failure and transition item to FAILED", async () => {
      const fixture = createDefaultFixture({
        gitOps: createFakeGitOps({
          pushError: new Error("remote: refusing to update checked out branch"),
        }),
      });

      const result = await fixture.service.executeMerge(fixture.defaultParams);

      expect(result.outcome).toBe("push_failed");
      const pushFail = result as PushFailedResult;

      expect(pushFail.item.status).toBe(MergeQueueItemStatus.FAILED);
      expect(pushFail.pushError).toContain("refusing to update");
    });
  });

  describe("executeMerge — error cases", () => {
    /**
     * Validates that attempting to execute merge on a non-existent item
     * throws EntityNotFoundError.
     *
     * Important because merge execution requires a valid dequeued item —
     * stale references must be caught early.
     */
    it("should throw EntityNotFoundError if item does not exist", async () => {
      const fixture = createDefaultFixture();

      await expect(
        fixture.service.executeMerge({
          ...fixture.defaultParams,
          mergeQueueItemId: "non-existent",
        }),
      ).rejects.toThrow(EntityNotFoundError);
    });

    /**
     * Validates that an item not in PREPARING state is rejected.
     *
     * Important because only dequeued items (PREPARING) should enter the
     * merge pipeline — this guards against double-execution.
     */
    it("should throw MergeItemNotPreparingError if item is not in PREPARING state", async () => {
      const fixture = createDefaultFixture();
      fixture.items.set(ITEM_ID, {
        ...fixture.items.get(ITEM_ID)!,
        status: MergeQueueItemStatus.ENQUEUED,
      });

      await expect(fixture.service.executeMerge(fixture.defaultParams)).rejects.toThrow(
        MergeItemNotPreparingError,
      );
    });

    /**
     * Validates that a task not in QUEUED_FOR_MERGE state is rejected.
     *
     * Important because the task must be in the correct state for the
     * merge pipeline to proceed — prevents state corruption.
     */
    it("should throw TaskNotQueuedForMergeError if task is not in QUEUED_FOR_MERGE state", async () => {
      const fixture = createDefaultFixture();
      fixture.tasks.set(TASK_ID, {
        ...fixture.tasks.get(TASK_ID)!,
        status: TaskStatus.MERGING,
      });

      await expect(fixture.service.executeMerge(fixture.defaultParams)).rejects.toThrow(
        TaskNotQueuedForMergeError,
      );
    });

    /**
     * Validates that a missing task for the item throws EntityNotFoundError.
     *
     * Important because data integrity requires the task-item relationship
     * to be valid at execution time.
     */
    it("should throw EntityNotFoundError if task does not exist", async () => {
      const fixture = createDefaultFixture();
      fixture.tasks.clear();

      await expect(fixture.service.executeMerge(fixture.defaultParams)).rejects.toThrow(
        EntityNotFoundError,
      );
    });
  });

  describe("executeMerge — git operations", () => {
    /**
     * Validates that git fetch is called with the correct remote before rebase.
     *
     * Important because the rebase must operate on the latest remote refs
     * to avoid stale-base merges.
     */
    it("should call git fetch before rebase", async () => {
      const fetchCalls: Array<{ workspacePath: string; remote: string }> = [];
      const rebaseCalls: Array<{ workspacePath: string; onto: string }> = [];

      const gitOps = createFakeGitOps();
      const trackedGitOps: MergeGitOperationsPort = {
        ...gitOps,
        async fetch(workspacePath, remote) {
          fetchCalls.push({ workspacePath, remote });
          return gitOps.fetch(workspacePath, remote);
        },
        async rebase(workspacePath, onto) {
          rebaseCalls.push({ workspacePath, onto });
          return gitOps.rebase(workspacePath, onto);
        },
      };

      const fixture = createDefaultFixture({ gitOps: trackedGitOps });
      await fixture.service.executeMerge(fixture.defaultParams);

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]!.workspacePath).toBe(WORKSPACE);
      expect(fetchCalls[0]!.remote).toBe("origin");

      expect(rebaseCalls).toHaveLength(1);
      expect(rebaseCalls[0]!.onto).toBe(`origin/${TARGET_BRANCH}`);
    });

    /**
     * Validates that git push uses the correct branch name.
     *
     * Important because pushing to the wrong branch could corrupt the
     * repository state.
     */
    it("should push the correct branch after validation passes", async () => {
      const pushCalls: Array<{ remote: string; branch: string }> = [];

      const gitOps = createFakeGitOps({ currentBranch: "factory/task-001" });
      const trackedGitOps: MergeGitOperationsPort = {
        ...gitOps,
        async push(_wp, remote, branch) {
          pushCalls.push({ remote, branch });
        },
      };

      const fixture = createDefaultFixture({ gitOps: trackedGitOps });
      await fixture.service.executeMerge(fixture.defaultParams);

      expect(pushCalls).toHaveLength(1);
      expect(pushCalls[0]!.remote).toBe("origin");
      expect(pushCalls[0]!.branch).toBe("factory/task-001");
    });
  });

  describe("executeMerge — metadata propagation", () => {
    /**
     * Validates that optional metadata is included in audit events.
     *
     * Important because operators and debugging tools rely on metadata
     * for context about why transitions occurred.
     */
    it("should include metadata in audit events when provided", async () => {
      const fixture = createDefaultFixture();

      await fixture.service.executeMerge({
        ...fixture.defaultParams,
        metadata: { requestedBy: "operator-1" },
      });

      // Check that at least some audit events have the metadata
      const eventsWithMetadata = fixture.auditEvents.filter(
        (e) => e.metadata && e.metadata.includes("requestedBy"),
      );
      expect(eventsWithMetadata.length).toBeGreaterThan(0);
    });
  });

  describe("executeMerge — squash strategy", () => {
    /**
     * Validates the full successful squash merge pipeline.
     *
     * Squash merges combine all feature branch commits into a single commit
     * on the target branch. This test verifies the executor correctly calls
     * squashMerge instead of rebase, pushes the target branch (not source),
     * and records the correct strategy in the MergePacket.
     *
     * @see docs/prd/010-integration-contracts.md §10.10.1
     */
    it("should complete the full squash merge pipeline successfully", async () => {
      const fixture = createDefaultFixture();
      const result = await fixture.service.executeMerge({
        ...fixture.defaultParams,
        mergeStrategy: MergeStrategy.SQUASH,
      });

      expect(result.outcome).toBe("merged");
      const merged = result as MergeSuccessResult;

      expect(merged.item.status).toBe(MergeQueueItemStatus.MERGED);
      expect(merged.task.status).toBe(TaskStatus.POST_MERGE_VALIDATION);
      expect(merged.mergedCommitSha).toBe(MERGED_SHA);
      expect(merged.artifactPath).toContain("merge-packet.json");
    });

    /**
     * Validates that the MergePacket records the squash strategy and
     * rebase_performed=false, since squash merges do not rebase.
     *
     * Important because downstream consumers use the MergePacket to
     * understand exactly how the merge was performed.
     */
    it("should emit a MergePacket with squash strategy and rebase_performed=false", async () => {
      const fixture = createDefaultFixture();
      const result = await fixture.service.executeMerge({
        ...fixture.defaultParams,
        mergeStrategy: MergeStrategy.SQUASH,
      });

      const merged = result as MergeSuccessResult;
      const packet = merged.mergePacket;

      expect(packet.details.merge_strategy).toBe(MergeStrategy.SQUASH);
      expect(packet.details.rebase_performed).toBe(false);
      expect(packet.summary).toContain("Squash merge");
    });

    /**
     * Validates that squash merge calls squashMerge (not rebase) on the
     * git operations port, and passes the correct arguments.
     *
     * Important because calling the wrong git operation would produce
     * incorrect repository state.
     */
    it("should call squashMerge instead of rebase", async () => {
      const squashCalls: Array<{
        workspacePath: string;
        sourceBranch: string;
        targetBranch: string;
        commitMessage: string;
      }> = [];
      const rebaseCalls: Array<{ workspacePath: string; onto: string }> = [];

      const gitOps = createFakeGitOps();
      const trackedGitOps: MergeGitOperationsPort = {
        ...gitOps,
        async rebase(workspacePath, onto) {
          rebaseCalls.push({ workspacePath, onto });
          return gitOps.rebase(workspacePath, onto);
        },
        async squashMerge(workspacePath, sourceBranch, targetBranch, commitMessage) {
          squashCalls.push({ workspacePath, sourceBranch, targetBranch, commitMessage });
          return gitOps.squashMerge(workspacePath, sourceBranch, targetBranch, commitMessage);
        },
      };

      const fixture = createDefaultFixture({ gitOps: trackedGitOps });
      await fixture.service.executeMerge({
        ...fixture.defaultParams,
        mergeStrategy: MergeStrategy.SQUASH,
      });

      expect(rebaseCalls).toHaveLength(0);
      expect(squashCalls).toHaveLength(1);
      expect(squashCalls[0]!.workspacePath).toBe(WORKSPACE);
      expect(squashCalls[0]!.sourceBranch).toBe(SOURCE_BRANCH);
      expect(squashCalls[0]!.targetBranch).toBe(`origin/${TARGET_BRANCH}`);
    });

    /**
     * Validates that squash merge pushes the target branch (not source).
     *
     * For squash merges, the squashed commit lives on the target branch,
     * so the target branch must be pushed to the remote.
     */
    it("should push the target branch for squash strategy", async () => {
      const pushCalls: Array<{ remote: string; branch: string }> = [];

      const gitOps = createFakeGitOps();
      const trackedGitOps: MergeGitOperationsPort = {
        ...gitOps,
        async push(_wp, remote, branch) {
          pushCalls.push({ remote, branch });
        },
      };

      const fixture = createDefaultFixture({ gitOps: trackedGitOps });
      await fixture.service.executeMerge({
        ...fixture.defaultParams,
        mergeStrategy: MergeStrategy.SQUASH,
      });

      expect(pushCalls).toHaveLength(1);
      expect(pushCalls[0]!.branch).toBe(TARGET_BRANCH);
    });

    /**
     * Validates that squash merge conflicts are handled identically to
     * rebase conflicts — classified and transitioned appropriately.
     *
     * Important because merge conflicts can occur with any strategy,
     * and the conflict classification pipeline must work for all of them.
     */
    it("should handle squash merge conflicts correctly", async () => {
      const conflictFiles = ["src/utils.ts"];
      const fixture = createDefaultFixture({
        gitOps: createFakeGitOps({
          squashMergeResult: { success: false, conflictFiles },
        }),
        conflictClassifier: createFakeClassifier("reworkable"),
      });

      const result = await fixture.service.executeMerge({
        ...fixture.defaultParams,
        mergeStrategy: MergeStrategy.SQUASH,
      });

      expect(result.outcome).toBe("rebase_conflict");
      const conflict = result as RebaseConflictResult;

      expect(conflict.classification).toBe("reworkable");
      expect(conflict.conflictFiles).toEqual(conflictFiles);
      expect(conflict.item.status).toBe(MergeQueueItemStatus.REQUEUED);
      expect(conflict.task.status).toBe(TaskStatus.CHANGES_REQUESTED);
    });
  });

  describe("executeMerge — merge-commit strategy", () => {
    /**
     * Validates the full successful merge-commit pipeline.
     *
     * Merge-commit creates a merge commit preserving the full branch
     * topology (git merge --no-ff). This test verifies the executor
     * correctly calls mergeCommit, pushes the target branch, and records
     * the correct strategy in the MergePacket.
     *
     * @see docs/prd/010-integration-contracts.md §10.10.1
     */
    it("should complete the full merge-commit pipeline successfully", async () => {
      const fixture = createDefaultFixture();
      const result = await fixture.service.executeMerge({
        ...fixture.defaultParams,
        mergeStrategy: MergeStrategy.MERGE_COMMIT,
      });

      expect(result.outcome).toBe("merged");
      const merged = result as MergeSuccessResult;

      expect(merged.item.status).toBe(MergeQueueItemStatus.MERGED);
      expect(merged.task.status).toBe(TaskStatus.POST_MERGE_VALIDATION);
      expect(merged.mergedCommitSha).toBe(MERGED_SHA);
      expect(merged.artifactPath).toContain("merge-packet.json");
    });

    /**
     * Validates that the MergePacket records the merge-commit strategy and
     * rebase_performed=false, since merge-commit does not rebase.
     *
     * Important because the MergePacket is the canonical record of the
     * merge operation, and downstream processes use it to understand
     * how the merge was performed.
     */
    it("should emit a MergePacket with merge-commit strategy and rebase_performed=false", async () => {
      const fixture = createDefaultFixture();
      const result = await fixture.service.executeMerge({
        ...fixture.defaultParams,
        mergeStrategy: MergeStrategy.MERGE_COMMIT,
      });

      const merged = result as MergeSuccessResult;
      const packet = merged.mergePacket;

      expect(packet.details.merge_strategy).toBe(MergeStrategy.MERGE_COMMIT);
      expect(packet.details.rebase_performed).toBe(false);
      expect(packet.summary).toContain("Merge commit");
    });

    /**
     * Validates that merge-commit calls mergeCommit (not rebase or squashMerge)
     * on the git operations port.
     *
     * Important because calling the wrong git operation would produce
     * incorrect repository history.
     */
    it("should call mergeCommit instead of rebase or squashMerge", async () => {
      const mergeCommitCalls: Array<{
        workspacePath: string;
        sourceBranch: string;
        targetBranch: string;
      }> = [];
      const rebaseCalls: Array<{ workspacePath: string; onto: string }> = [];
      const squashCalls: Array<{ workspacePath: string }> = [];

      const gitOps = createFakeGitOps();
      const trackedGitOps: MergeGitOperationsPort = {
        ...gitOps,
        async rebase(workspacePath, onto) {
          rebaseCalls.push({ workspacePath, onto });
          return gitOps.rebase(workspacePath, onto);
        },
        async squashMerge(workspacePath, s, t, m) {
          squashCalls.push({ workspacePath });
          return gitOps.squashMerge(workspacePath, s, t, m);
        },
        async mergeCommit(workspacePath, sourceBranch, targetBranch) {
          mergeCommitCalls.push({ workspacePath, sourceBranch, targetBranch });
          return gitOps.mergeCommit(workspacePath, sourceBranch, targetBranch);
        },
      };

      const fixture = createDefaultFixture({ gitOps: trackedGitOps });
      await fixture.service.executeMerge({
        ...fixture.defaultParams,
        mergeStrategy: MergeStrategy.MERGE_COMMIT,
      });

      expect(rebaseCalls).toHaveLength(0);
      expect(squashCalls).toHaveLength(0);
      expect(mergeCommitCalls).toHaveLength(1);
      expect(mergeCommitCalls[0]!.workspacePath).toBe(WORKSPACE);
      expect(mergeCommitCalls[0]!.sourceBranch).toBe(SOURCE_BRANCH);
      expect(mergeCommitCalls[0]!.targetBranch).toBe(`origin/${TARGET_BRANCH}`);
    });

    /**
     * Validates that merge-commit pushes the target branch (not source).
     *
     * For merge-commit, the merge commit lives on the target branch,
     * so the target branch must be pushed to the remote.
     */
    it("should push the target branch for merge-commit strategy", async () => {
      const pushCalls: Array<{ remote: string; branch: string }> = [];

      const gitOps = createFakeGitOps();
      const trackedGitOps: MergeGitOperationsPort = {
        ...gitOps,
        async push(_wp, remote, branch) {
          pushCalls.push({ remote, branch });
        },
      };

      const fixture = createDefaultFixture({ gitOps: trackedGitOps });
      await fixture.service.executeMerge({
        ...fixture.defaultParams,
        mergeStrategy: MergeStrategy.MERGE_COMMIT,
      });

      expect(pushCalls).toHaveLength(1);
      expect(pushCalls[0]!.branch).toBe(TARGET_BRANCH);
    });

    /**
     * Validates that merge-commit conflicts are handled identically to
     * rebase conflicts — classified and transitioned appropriately.
     */
    it("should handle merge-commit conflicts correctly", async () => {
      const conflictFiles = ["src/index.ts", "package.json"];
      const fixture = createDefaultFixture({
        gitOps: createFakeGitOps({
          mergeCommitResult: { success: false, conflictFiles },
        }),
        conflictClassifier: createFakeClassifier("non_reworkable"),
      });

      const result = await fixture.service.executeMerge({
        ...fixture.defaultParams,
        mergeStrategy: MergeStrategy.MERGE_COMMIT,
      });

      expect(result.outcome).toBe("rebase_conflict");
      const conflict = result as RebaseConflictResult;

      expect(conflict.classification).toBe("non_reworkable");
      expect(conflict.conflictFiles).toEqual(conflictFiles);
      expect(conflict.item.status).toBe(MergeQueueItemStatus.FAILED);
      expect(conflict.task.status).toBe(TaskStatus.FAILED);
    });
  });

  describe("executeMerge — strategy defaults", () => {
    /**
     * Validates that when no mergeStrategy is specified, the executor
     * defaults to rebase-and-merge per §10.10.1.
     *
     * Important because backward compatibility requires existing callers
     * (that don't pass mergeStrategy) to get the original behavior.
     */
    it("should default to rebase-and-merge when mergeStrategy is not specified", async () => {
      const fixture = createDefaultFixture();
      const result = await fixture.service.executeMerge(fixture.defaultParams);

      const merged = result as MergeSuccessResult;
      expect(merged.mergePacket.details.merge_strategy).toBe(MergeStrategy.REBASE_AND_MERGE);
      expect(merged.mergePacket.details.rebase_performed).toBe(true);
    });

    /**
     * Validates that push target differs per strategy:
     * rebase-and-merge pushes source branch, others push target branch.
     *
     * Important because pushing the wrong branch would corrupt the
     * repository state.
     */
    it("should push source branch for rebase-and-merge but target for other strategies", async () => {
      const pushBranches: string[] = [];

      const gitOps = createFakeGitOps({ currentBranch: "factory/task-001" });
      const trackedGitOps: MergeGitOperationsPort = {
        ...gitOps,
        async push(_wp, _remote, branch) {
          pushBranches.push(branch);
        },
      };

      // Rebase-and-merge: pushes source branch
      const fixture1 = createDefaultFixture({ gitOps: trackedGitOps });
      await fixture1.service.executeMerge({
        ...fixture1.defaultParams,
        mergeStrategy: MergeStrategy.REBASE_AND_MERGE,
      });
      expect(pushBranches[0]).toBe("factory/task-001");

      pushBranches.length = 0;

      // Squash: pushes target branch
      const fixture2 = createDefaultFixture({ gitOps: trackedGitOps });
      await fixture2.service.executeMerge({
        ...fixture2.defaultParams,
        mergeStrategy: MergeStrategy.SQUASH,
      });
      expect(pushBranches[0]).toBe(TARGET_BRANCH);

      pushBranches.length = 0;

      // Merge-commit: pushes target branch
      const fixture3 = createDefaultFixture({ gitOps: trackedGitOps });
      await fixture3.service.executeMerge({
        ...fixture3.defaultParams,
        mergeStrategy: MergeStrategy.MERGE_COMMIT,
      });
      expect(pushBranches[0]).toBe(TARGET_BRANCH);
    });
  });
});
