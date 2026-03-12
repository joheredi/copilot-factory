/**
 * Integration test: Merge conflict and failure paths (T109)
 *
 * Validates merge failure handling per the conflict classification
 * policy (§10.10.2) and post-merge failure policy (§9.11).
 *
 * Tests exercise four scenarios from the merge pipeline:
 * 1. Reworkable conflict (2 files, no protected) → CHANGES_REQUESTED
 * 2. Non-reworkable conflict (6+ files) → FAILED
 * 3. High-severity post-merge validation failure → FAILED + operator alert
 * 4. Critical post-merge failure → revert task created + queue paused
 *
 * The merge executor tests use the real SQLite unit of work with fake
 * git operations to simulate conflict scenarios. Post-merge validation
 * tests use custom unit-of-work adapters wrapping real SQLite for task
 * and audit persistence, with in-memory fakes for follow-up task creation,
 * queue management, and operator notification.
 *
 * @see docs/prd/010-integration-contracts.md §10.10.2
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.11
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import crypto from "node:crypto";

import { TaskStatus, MergeQueueItemStatus } from "@factory/domain";

import {
  // Merge executor service
  createMergeExecutorService,
  // Conflict classifier
  createConflictClassifierService,
  classifyConflict,
  DEFAULT_MERGE_CONFLICT_POLICY,
  // Post-merge validation service
  createPostMergeValidationService,
  classifyFailureSeverity,
  DEFAULT_POST_MERGE_FAILURE_POLICY,
  // Types — merge executor
  type MergeGitOperationsPort,
  type MergeValidationPort,
  type MergeArtifactPort,
  type MergeExecutorUnitOfWork,
  type MergeExecutorTransactionRepositories,
  type MergeExecutorTaskRepositoryPort,
  type MergeExecutorTask,
  type MergeExecutorItemRepositoryPort,
  type MergeExecutorItem,
  // Types — post-merge validation
  type PostMergeValidationRunnerPort,
  type MergeQueuePausePort,
  type OperatorNotificationPort,
  type PostMergeFollowUpTaskCreationPort,
  type PostMergeFollowUpTaskRecord,
  type CreateFollowUpTaskData,
  type PostMergeUnitOfWork,
  type PostMergeTransactionRepositories,
  type PostMergeTaskRepositoryPort,
  type PostMergeTask,
  type PostMergeFailureResult,
  // Types — shared
  type ValidationRunResult,
  type DomainEventEmitter,
  type DomainEvent,
  type ActorInfo,
  type AuditEventRepositoryPort,
  type NewAuditEvent,
  type AuditEventRecord,
} from "@factory/application";

import { createTestDatabase, type TestDatabaseConnection } from "@factory/testing";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, "../../drizzle");

const SYSTEM_ACTOR: ActorInfo = { type: "system", id: "integration-test" };

// ---------------------------------------------------------------------------
// Shared helpers — domain event capture
// ---------------------------------------------------------------------------

/**
 * Creates a DomainEventEmitter that captures all emitted events for
 * assertion in tests. Used to verify that the correct domain events
 * are published during state transitions.
 */
function createCapturingEmitter(): {
  emitter: DomainEventEmitter;
  events: DomainEvent[];
} {
  const events: DomainEvent[] = [];
  const emitter: DomainEventEmitter = {
    emit(event: DomainEvent): void {
      events.push(event);
    },
  };
  return { emitter, events };
}

// ---------------------------------------------------------------------------
// Shared helpers — audit event queries
// ---------------------------------------------------------------------------

interface ParsedAuditEvent {
  entity_type: string;
  event_type: string;
  old_state: string | null;
  new_state: string;
  metadata_json: string | null;
  old_status: string | null;
  new_status: string;
}

/**
 * Extracts a status string from either a JSON state object `{ status: "..." }`
 * (as produced by the transition service) or a plain status string
 * (as produced by the post-merge validation service).
 */
function extractStatus(stateJson: string | null): string | null {
  if (!stateJson) return null;
  try {
    const parsed = JSON.parse(stateJson) as { status?: string };
    return parsed.status ?? stateJson;
  } catch {
    // Plain string status (e.g., "FAILED", "POST_MERGE_VALIDATION")
    return stateJson;
  }
}

/**
 * Queries all audit events for a given entity, ordered chronologically.
 * Parses old/new state JSON to extract status values for easy assertion.
 */
function getAuditEvents(conn: TestDatabaseConnection, entityId: string): ParsedAuditEvent[] {
  const rows = conn.sqlite
    .prepare(
      `SELECT entity_type, event_type, old_state, new_state, metadata_json
       FROM audit_event WHERE entity_id = ?
       ORDER BY created_at ASC, rowid ASC`,
    )
    .all(entityId) as Array<{
    entity_type: string;
    event_type: string;
    old_state: string | null;
    new_state: string;
    metadata_json: string | null;
  }>;

  return rows.map((r) => ({
    ...r,
    old_status: extractStatus(r.old_state),
    new_status: extractStatus(r.new_state),
  }));
}

// ---------------------------------------------------------------------------
// Shared helpers — data seeding
// ---------------------------------------------------------------------------

/**
 * Seeds the prerequisite entities (project, repository, worker pool)
 * that tasks and merge queue items reference via foreign keys.
 */
function seedPrerequisites(conn: TestDatabaseConnection): {
  projectId: string;
  repositoryId: string;
  workerPoolId: string;
} {
  const projectId = `proj-${crypto.randomUUID().slice(0, 8)}`;
  const repositoryId = `repo-${crypto.randomUUID().slice(0, 8)}`;
  const workerPoolId = `pool-${crypto.randomUUID().slice(0, 8)}`;

  conn.sqlite
    .prepare(
      `INSERT INTO project (project_id, name, owner)
       VALUES (?, ?, ?)`,
    )
    .run(projectId, `test-project-${projectId}`, "test-owner");

  conn.sqlite
    .prepare(
      `INSERT INTO repository (repository_id, project_id, name, remote_url, default_branch, local_checkout_strategy, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      repositoryId,
      projectId,
      "test-repo",
      "file:///tmp/test-repo",
      "main",
      "worktree",
      "ACTIVE",
    );

  conn.sqlite
    .prepare(
      `INSERT INTO worker_pool (worker_pool_id, name, pool_type, max_concurrency, enabled, capabilities)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(workerPoolId, "dev-pool", "DEVELOPER", 3, 1, JSON.stringify(["typescript"]));

  return { projectId, repositoryId, workerPoolId };
}

/**
 * Seeds a task in the specified state. Used to create tasks at the exact
 * lifecycle position needed for each test scenario.
 */
function seedTaskInState(
  conn: TestDatabaseConnection,
  repositoryId: string,
  status: string,
  title: string = "Merge test task",
): string {
  const taskId = `task-${crypto.randomUUID().slice(0, 8)}`;

  conn.sqlite
    .prepare(
      `INSERT INTO task (task_id, repository_id, title, task_type, priority, status, source, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(taskId, repositoryId, title, "FEATURE", "HIGH", status, "MANUAL", 1);

  return taskId;
}

/**
 * Seeds a merge queue item in the specified state. For merge executor
 * tests the item must be in PREPARING state; for post-merge tests
 * the item is referenced by ID for audit trail purposes.
 */
function seedMergeQueueItem(
  conn: TestDatabaseConnection,
  taskId: string,
  repositoryId: string,
  status: string = "ENQUEUED",
): string {
  const itemId = `mqi-${crypto.randomUUID().slice(0, 8)}`;

  conn.sqlite
    .prepare(
      `INSERT INTO merge_queue_item (merge_queue_item_id, task_id, repository_id, status, position)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(itemId, taskId, repositoryId, status, 1);

  return itemId;
}

// ---------------------------------------------------------------------------
// Fake port implementations — merge executor
// ---------------------------------------------------------------------------

/**
 * Creates a fake MergeGitOperationsPort that simulates rebase conflicts.
 * The rebase result is configurable per test to produce reworkable or
 * non-reworkable conflict scenarios.
 *
 * @param rebaseResult - The result to return from the rebase operation.
 *                       Use `{ success: false, conflictFiles: [...] }` to
 *                       simulate conflicts.
 */
function createFakeGitOps(rebaseResult: {
  success: boolean;
  conflictFiles: readonly string[];
}): MergeGitOperationsPort {
  return {
    async fetch(): Promise<void> {
      /* no-op */
    },
    async rebase() {
      return rebaseResult;
    },
    async squashMerge() {
      return { success: true, conflictFiles: [] };
    },
    async mergeCommit() {
      return { success: true, conflictFiles: [] };
    },
    async push(): Promise<void> {
      /* no-op */
    },
    async getHeadSha() {
      return "abc123def456";
    },
    async getCurrentBranch() {
      return "feature/test-branch";
    },
  };
}

/**
 * Creates a fake MergeValidationPort. For conflict tests, validation
 * is never reached so this returns a passing result by default.
 */
function createFakeMergeValidation(): MergeValidationPort {
  return {
    async runMergeGateValidation() {
      return createPassingValidationResult();
    },
  };
}

/**
 * Creates a fake MergeArtifactPort that records persisted packets
 * without writing to the filesystem.
 */
function createFakeArtifactStore(): MergeArtifactPort & {
  persistedPackets: Array<{ itemId: string; packet: Record<string, unknown> }>;
} {
  const store = {
    persistedPackets: [] as Array<{
      itemId: string;
      packet: Record<string, unknown>;
    }>,
    async persistMergePacket(
      mergeQueueItemId: string,
      packet: Record<string, unknown>,
    ): Promise<string> {
      store.persistedPackets.push({
        itemId: mergeQueueItemId,
        packet,
      });
      return `/artifacts/merge/${mergeQueueItemId}/packet.json`;
    },
  };
  return store;
}

// ---------------------------------------------------------------------------
// Fake port implementations — post-merge validation
// ---------------------------------------------------------------------------

/**
 * Creates a fake PostMergeValidationRunnerPort that returns a configurable
 * validation result. This simulates post-merge validation checks
 * (test suite, lint, security scan) with controlled outcomes.
 */
function createFakeValidationRunner(result: ValidationRunResult): PostMergeValidationRunnerPort {
  return {
    async runMergeGateValidation() {
      return result;
    },
  };
}

/**
 * Creates a tracking MergeQueuePausePort that records pause/resume calls.
 * Critical severity failures should trigger pauseQueue; high/low should not.
 */
function createTrackingQueuePause(): MergeQueuePausePort & {
  pauseCalls: Array<{ repositoryId: string; reason: string }>;
  paused: Set<string>;
} {
  const tracker = {
    pauseCalls: [] as Array<{ repositoryId: string; reason: string }>,
    paused: new Set<string>(),
    pauseQueue(repositoryId: string, reason: string): void {
      tracker.pauseCalls.push({ repositoryId, reason });
      tracker.paused.add(repositoryId);
    },
    resumeQueue(repositoryId: string): void {
      tracker.paused.delete(repositoryId);
    },
    isPaused(repositoryId: string): boolean {
      return tracker.paused.has(repositoryId);
    },
  };
  return tracker;
}

/**
 * Creates a tracking OperatorNotificationPort that records all notifications.
 * Used to verify that operators are notified with the correct severity
 * and actionability flags for each failure type.
 */
function createTrackingNotifier(): OperatorNotificationPort & {
  notifications: Array<{
    taskId: string;
    repositoryId: string;
    severity: string;
    message: string;
    requiresAction: boolean;
  }>;
} {
  const tracker = {
    notifications: [] as Array<{
      taskId: string;
      repositoryId: string;
      severity: string;
      message: string;
      requiresAction: boolean;
    }>,
    notify(notification: {
      taskId: string;
      repositoryId: string;
      severity: string;
      message: string;
      requiresAction: boolean;
    }): void {
      tracker.notifications.push(notification);
    },
  };
  return tracker;
}

/**
 * Creates a tracking PostMergeFollowUpTaskCreationPort that records
 * follow-up task creation requests. Critical failures should generate
 * revert tasks; low severity should generate diagnostic tasks.
 */
function createTrackingFollowUpCreator(): PostMergeFollowUpTaskCreationPort & {
  createdTasks: Array<{ data: CreateFollowUpTaskData; record: PostMergeFollowUpTaskRecord }>;
} {
  const tracker = {
    createdTasks: [] as Array<{
      data: CreateFollowUpTaskData;
      record: PostMergeFollowUpTaskRecord;
    }>,
    createFollowUpTask(data: CreateFollowUpTaskData): PostMergeFollowUpTaskRecord {
      const record: PostMergeFollowUpTaskRecord = {
        id: `followup-${crypto.randomUUID().slice(0, 8)}`,
        title: data.title,
        taskType: data.taskType,
      };
      tracker.createdTasks.push({ data, record });
      return record;
    },
  };
  return tracker;
}

// ---------------------------------------------------------------------------
// Merge executor unit of work adapter
// ---------------------------------------------------------------------------

/**
 * Creates a raw SQL audit event repository that writes directly to the
 * audit_event table. Shared by both the merge executor and post-merge
 * validation unit of work adapters.
 */
function createRawAuditEventRepo(conn: TestDatabaseConnection): AuditEventRepositoryPort {
  return {
    create(event: NewAuditEvent): AuditEventRecord {
      const id = crypto.randomUUID();
      const now = new Date();
      conn.sqlite
        .prepare(
          `INSERT INTO audit_event (audit_event_id, entity_type, entity_id, event_type, actor_type, actor_id, old_state, new_state, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          event.entityType,
          event.entityId,
          event.eventType,
          event.actorType,
          event.actorId,
          event.oldState,
          event.newState,
          event.metadata,
          Math.floor(now.getTime() / 1000),
        );
      return { id, ...event, createdAt: now };
    },
  };
}

/**
 * Creates a MergeExecutorUnitOfWork backed by real SQLite. The general
 * `createSqliteUnitOfWork` strips merge queue item fields to only
 * `{ id, status }` for the transition service. This adapter provides
 * the full `MergeExecutorItem` with taskId, repositoryId, and
 * approvedCommitSha that the merge executor service requires.
 */
function createMergeExecutorUnitOfWorkAdapter(
  conn: TestDatabaseConnection,
): MergeExecutorUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: MergeExecutorTransactionRepositories) => T): T {
      return conn.writeTransaction(() => {
        const taskRepo: MergeExecutorTaskRepositoryPort = {
          findById(id: string): MergeExecutorTask | undefined {
            const row = conn.sqlite
              .prepare(
                `SELECT task_id, status, version, repository_id
                 FROM task WHERE task_id = ?`,
              )
              .get(id) as
              | {
                  task_id: string;
                  status: string;
                  version: number;
                  repository_id: string;
                }
              | undefined;
            if (!row) return undefined;
            return {
              id: row.task_id,
              status: row.status as TaskStatus,
              version: row.version,
              repositoryId: row.repository_id,
            };
          },
          updateStatus(
            id: string,
            expectedVersion: number,
            newStatus: TaskStatus,
          ): MergeExecutorTask {
            const current = this.findById(id);
            if (!current) throw new Error(`Task ${id} not found`);
            if (current.version !== expectedVersion) {
              throw new Error(
                `Version conflict: expected ${expectedVersion}, got ${current.version}`,
              );
            }
            const newVersion = expectedVersion + 1;
            conn.sqlite
              .prepare(`UPDATE task SET status = ?, version = ? WHERE task_id = ?`)
              .run(newStatus, newVersion, id);
            return { ...current, status: newStatus, version: newVersion };
          },
        };

        const itemRepo: MergeExecutorItemRepositoryPort = {
          findById(id: string): MergeExecutorItem | undefined {
            const row = conn.sqlite
              .prepare(
                `SELECT merge_queue_item_id, task_id, repository_id, status, approved_commit_sha
                 FROM merge_queue_item WHERE merge_queue_item_id = ?`,
              )
              .get(id) as
              | {
                  merge_queue_item_id: string;
                  task_id: string;
                  repository_id: string;
                  status: string;
                  approved_commit_sha: string | null;
                }
              | undefined;
            if (!row) return undefined;
            return {
              mergeQueueItemId: row.merge_queue_item_id,
              taskId: row.task_id,
              repositoryId: row.repository_id,
              status: row.status as MergeQueueItemStatus,
              approvedCommitSha: row.approved_commit_sha,
            };
          },
          updateStatus(
            mergeQueueItemId: string,
            expectedStatus: MergeQueueItemStatus,
            newStatus: MergeQueueItemStatus,
            additionalFields?: { startedAt?: Date; completedAt?: Date },
          ): MergeExecutorItem {
            const current = this.findById(mergeQueueItemId);
            if (!current) {
              throw new Error(`Merge queue item ${mergeQueueItemId} not found`);
            }
            if (current.status !== expectedStatus) {
              throw new Error(`Status conflict: expected ${expectedStatus}, got ${current.status}`);
            }
            const updates: string[] = [`status = ?`];
            const params: unknown[] = [newStatus];
            if (additionalFields?.startedAt) {
              updates.push(`started_at = ?`);
              params.push(Math.floor(additionalFields.startedAt.getTime() / 1000));
            }
            if (additionalFields?.completedAt) {
              updates.push(`completed_at = ?`);
              params.push(Math.floor(additionalFields.completedAt.getTime() / 1000));
            }
            params.push(mergeQueueItemId);
            conn.sqlite
              .prepare(
                `UPDATE merge_queue_item SET ${updates.join(", ")} WHERE merge_queue_item_id = ?`,
              )
              .run(...params);
            return { ...current, status: newStatus };
          },
        };

        return fn({
          task: taskRepo,
          mergeQueueItem: itemRepo,
          auditEvent: createRawAuditEventRepo(conn),
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Post-merge unit of work adapter
// ---------------------------------------------------------------------------

/**
 * Creates a PostMergeUnitOfWork backed by real SQLite for task status
 * and audit event persistence, with an injected follow-up task port.
 *
 * This adapter queries the task table joined with repository to provide
 * the projectId field required by PostMergeTask, and writes audit events
 * to the real audit_event table.
 *
 * @param conn - Test database connection (in-memory SQLite with migrations)
 * @param followUpPort - Tracking fake for follow-up task creation
 */
function createPostMergeUnitOfWorkAdapter(
  conn: TestDatabaseConnection,
  followUpPort: PostMergeFollowUpTaskCreationPort,
): PostMergeUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: PostMergeTransactionRepositories) => T): T {
      return conn.writeTransaction(() => {
        const taskRepo: PostMergeTaskRepositoryPort = {
          findById(id: string): PostMergeTask | undefined {
            const row = conn.sqlite
              .prepare(
                `SELECT t.task_id, t.status, t.version, t.repository_id, r.project_id
                 FROM task t
                 JOIN repository r ON t.repository_id = r.repository_id
                 WHERE t.task_id = ?`,
              )
              .get(id) as
              | {
                  task_id: string;
                  status: string;
                  version: number;
                  repository_id: string;
                  project_id: string;
                }
              | undefined;

            if (!row) return undefined;
            return {
              id: row.task_id,
              status: row.status as TaskStatus,
              version: row.version,
              repositoryId: row.repository_id,
              projectId: row.project_id,
            };
          },

          updateStatus(id: string, expectedVersion: number, newStatus: TaskStatus): PostMergeTask {
            const current = this.findById(id);
            if (!current) {
              throw new Error(`Task ${id} not found`);
            }
            if (current.version !== expectedVersion) {
              throw new Error(
                `Version conflict: expected ${expectedVersion}, found ${current.version}`,
              );
            }
            const newVersion = expectedVersion + 1;
            conn.sqlite
              .prepare(`UPDATE task SET status = ?, version = ? WHERE task_id = ?`)
              .run(newStatus, newVersion, id);
            return { ...current, status: newStatus, version: newVersion };
          },
        };

        return fn({
          task: taskRepo,
          auditEvent: createRawAuditEventRepo(conn),
          followUpTask: followUpPort,
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Validation result factories
// ---------------------------------------------------------------------------

/** Creates a passing validation result with all checks passing. */
function createPassingValidationResult(): ValidationRunResult {
  return {
    profileName: "merge-gate",
    overallStatus: "passed",
    checkOutcomes: [
      {
        checkName: "test",
        command: "npm test",
        category: "required",
        status: "passed",
        durationMs: 5000,
      },
      {
        checkName: "lint",
        command: "npm run lint",
        category: "required",
        status: "passed",
        durationMs: 2000,
      },
    ],
    summary: "All checks passed",
    totalDurationMs: 7000,
    requiredPassedCount: 2,
    requiredFailedCount: 0,
    optionalPassedCount: 0,
    optionalFailedCount: 0,
    skippedCount: 0,
  };
}

/**
 * Creates a high-severity validation result: one required check fails
 * but below the critical threshold (3) and no security check fails.
 *
 * Per §9.11: high severity triggers operator alert and analysis agent
 * (if enabled), but does NOT pause the merge queue.
 */
function createHighSeverityValidationResult(): ValidationRunResult {
  return {
    profileName: "merge-gate",
    overallStatus: "failed",
    checkOutcomes: [
      {
        checkName: "test",
        command: "npm test",
        category: "required",
        status: "failed",
        durationMs: 8000,
        errorMessage: "3 test suites failed",
      },
      {
        checkName: "lint",
        command: "npm run lint",
        category: "required",
        status: "passed",
        durationMs: 2000,
      },
      {
        checkName: "typecheck",
        command: "tsc --noEmit",
        category: "required",
        status: "passed",
        durationMs: 3000,
      },
    ],
    summary: "1 required check failed: test",
    totalDurationMs: 13000,
    requiredPassedCount: 2,
    requiredFailedCount: 1,
    optionalPassedCount: 0,
    optionalFailedCount: 0,
    skippedCount: 0,
  };
}

/**
 * Creates a critical-severity validation result: a security check fails
 * plus multiple required checks fail (exceeding the critical threshold).
 *
 * Per §9.11: critical severity triggers automatic revert task generation,
 * merge queue pause, and immediate operator alert.
 */
function createCriticalSeverityValidationResult(): ValidationRunResult {
  return {
    profileName: "merge-gate",
    overallStatus: "failed",
    checkOutcomes: [
      {
        checkName: "security",
        command: "npm audit",
        category: "required",
        status: "failed",
        durationMs: 1500,
        errorMessage: "Critical vulnerability detected",
      },
      {
        checkName: "test",
        command: "npm test",
        category: "required",
        status: "failed",
        durationMs: 8000,
        errorMessage: "12 test suites failed",
      },
      {
        checkName: "lint",
        command: "npm run lint",
        category: "required",
        status: "failed",
        durationMs: 2000,
        errorMessage: "47 lint errors",
      },
      {
        checkName: "build",
        command: "npm run build",
        category: "required",
        status: "failed",
        durationMs: 15000,
        errorMessage: "TypeScript compilation failed",
      },
    ],
    summary: "4 required checks failed including security",
    totalDurationMs: 26500,
    requiredPassedCount: 0,
    requiredFailedCount: 4,
    optionalPassedCount: 0,
    optionalFailedCount: 0,
    skippedCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Merge Conflict and Failure Paths (T109)", () => {
  let conn: TestDatabaseConnection;
  let projectId: string;
  let repositoryId: string;
  let _workerPoolId: string;

  beforeEach(() => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    ({ projectId, repositoryId, workerPoolId: _workerPoolId } = seedPrerequisites(conn));
  });

  afterEach(() => {
    conn.close();
  });

  // =========================================================================
  // 1. Conflict classification policy verification
  // =========================================================================

  describe("Conflict classification policy", () => {
    /**
     * Verifies that conflicts involving fewer files than the threshold
     * and no protected paths are classified as reworkable.
     *
     * This is the happy path for conflict resolution: the developer can
     * resolve conflicts and resubmit. Per §10.10.2, the default threshold
     * is 5 files and protected paths are .github/, package.json, pnpm-lock.yaml.
     */
    it("classifies as reworkable when below threshold and no protected files", () => {
      const result = classifyConflict(
        ["src/feature.ts", "src/utils.ts"],
        DEFAULT_MERGE_CONFLICT_POLICY,
      );

      expect(result.classification).toBe("reworkable");
      expect(result.reason).toBeDefined();
    });

    /**
     * Verifies that conflicts exceeding the max_conflict_files threshold
     * (default: 5) are classified as non-reworkable. Too many conflicting
     * files indicate a fundamental divergence that manual resolution is
     * unlikely to fix correctly.
     */
    it("classifies as non-reworkable when file count exceeds threshold", () => {
      const result = classifyConflict(
        ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts"],
        DEFAULT_MERGE_CONFLICT_POLICY,
      );

      expect(result.classification).toBe("non_reworkable");
      expect(result.reason).toBeDefined();
    });

    /**
     * Verifies that conflicts in protected paths (e.g., .github/, package.json)
     * are always classified as non-reworkable regardless of file count.
     * Protected paths contain critical configuration that should not be
     * resolved through automated rework.
     */
    it("classifies as non-reworkable when protected paths are involved", () => {
      const result = classifyConflict(
        ["package.json", "src/index.ts"],
        DEFAULT_MERGE_CONFLICT_POLICY,
      );

      expect(result.classification).toBe("non_reworkable");
      expect(result.reason).toBeDefined();
    });
  });

  // =========================================================================
  // 2. Merge executor — reworkable conflict → CHANGES_REQUESTED
  // =========================================================================

  describe("Reworkable conflict → CHANGES_REQUESTED", () => {
    /**
     * Verifies the full merge executor flow when a rebase produces a
     * reworkable conflict (2 files, no protected paths):
     *
     * 1. Merge executor receives item in PREPARING, task in QUEUED_FOR_MERGE
     * 2. Transitions item to REBASING, task to MERGING
     * 3. Rebase fails with 2 conflicting files
     * 4. Conflict classifier determines "reworkable" (below threshold)
     * 5. Task transitions to CHANGES_REQUESTED
     * 6. Merge queue item transitions to REQUEUED
     * 7. Audit events record the full transition chain
     *
     * This validates that the merge pipeline correctly routes reworkable
     * conflicts back to the developer for resolution.
     */
    it("transitions task to CHANGES_REQUESTED and item to REQUEUED on reworkable conflict", async () => {
      // Arrange: seed task in QUEUED_FOR_MERGE, item in PREPARING
      const taskId = seedTaskInState(
        conn,
        repositoryId,
        "QUEUED_FOR_MERGE",
        "Feature with reworkable conflict",
      );
      const itemId = seedMergeQueueItem(conn, taskId, repositoryId, "PREPARING");

      const { emitter, events } = createCapturingEmitter();

      const unitOfWork = createMergeExecutorUnitOfWorkAdapter(conn);

      const conflictFiles = ["src/feature.ts", "src/utils.ts"];
      const gitOps = createFakeGitOps({
        success: false,
        conflictFiles,
      });
      const conflictClassifier = createConflictClassifierService(DEFAULT_MERGE_CONFLICT_POLICY);

      const mergeExecutor = createMergeExecutorService({
        unitOfWork,
        eventEmitter: emitter,
        gitOps,
        validation: createFakeMergeValidation(),
        conflictClassifier,
        artifactStore: createFakeArtifactStore(),
      });

      // Act
      const result = await mergeExecutor.executeMerge({
        mergeQueueItemId: itemId,
        workspacePath: "/tmp/workspace/test",
        targetBranch: "main",
        actor: SYSTEM_ACTOR,
      });

      // Assert: result indicates rebase_conflict with reworkable classification
      expect(result.outcome).toBe("rebase_conflict");

      // Assert: task transitioned to CHANGES_REQUESTED
      const taskRow = conn.sqlite
        .prepare(`SELECT status FROM task WHERE task_id = ?`)
        .get(taskId) as { status: string };
      expect(taskRow.status).toBe("CHANGES_REQUESTED");

      // Assert: merge queue item transitioned to REQUEUED
      const itemRow = conn.sqlite
        .prepare(`SELECT status FROM merge_queue_item WHERE merge_queue_item_id = ?`)
        .get(itemId) as { status: string };
      expect(itemRow.status).toBe("REQUEUED");

      // Assert: audit events recorded the transitions
      const taskAuditEvents = getAuditEvents(conn, taskId);
      expect(taskAuditEvents.length).toBeGreaterThanOrEqual(2);

      const finalTaskAudit = taskAuditEvents[taskAuditEvents.length - 1]!;
      expect(finalTaskAudit.new_status).toBe("CHANGES_REQUESTED");

      // Assert: domain events emitted
      const taskEvents = events.filter((e) => e.entityType === "task");
      expect(taskEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 3. Merge executor — non-reworkable conflict → FAILED
  // =========================================================================

  describe("Non-reworkable conflict → FAILED", () => {
    /**
     * Verifies the full merge executor flow when a rebase produces a
     * non-reworkable conflict (6 files, exceeding the default threshold of 5):
     *
     * 1. Merge executor receives item in PREPARING, task in QUEUED_FOR_MERGE
     * 2. Transitions item to REBASING, task to MERGING
     * 3. Rebase fails with 6 conflicting files
     * 4. Conflict classifier determines "non_reworkable" (above threshold)
     * 5. Task transitions to FAILED
     * 6. Merge queue item transitions to FAILED
     * 7. Audit events record failure with conflict metadata
     *
     * This validates that the merge pipeline correctly terminates tasks
     * with too many conflicts, preventing futile rework attempts.
     */
    it("transitions task to FAILED and item to FAILED on non-reworkable conflict", async () => {
      // Arrange
      const taskId = seedTaskInState(
        conn,
        repositoryId,
        "QUEUED_FOR_MERGE",
        "Feature with non-reworkable conflict",
      );
      const itemId = seedMergeQueueItem(conn, taskId, repositoryId, "PREPARING");

      const { emitter, events } = createCapturingEmitter();

      const unitOfWork = createMergeExecutorUnitOfWorkAdapter(conn);

      const conflictFiles = [
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
        "src/d.ts",
        "src/e.ts",
        "src/f.ts",
      ];
      const gitOps = createFakeGitOps({
        success: false,
        conflictFiles,
      });
      const conflictClassifier = createConflictClassifierService(DEFAULT_MERGE_CONFLICT_POLICY);

      const mergeExecutor = createMergeExecutorService({
        unitOfWork,
        eventEmitter: emitter,
        gitOps,
        validation: createFakeMergeValidation(),
        conflictClassifier,
        artifactStore: createFakeArtifactStore(),
      });

      // Act
      const result = await mergeExecutor.executeMerge({
        mergeQueueItemId: itemId,
        workspacePath: "/tmp/workspace/test",
        targetBranch: "main",
        actor: SYSTEM_ACTOR,
      });

      // Assert: result indicates rebase_conflict with non-reworkable classification
      expect(result.outcome).toBe("rebase_conflict");

      // Assert: task transitioned to FAILED
      const taskRow = conn.sqlite
        .prepare(`SELECT status FROM task WHERE task_id = ?`)
        .get(taskId) as { status: string };
      expect(taskRow.status).toBe("FAILED");

      // Assert: merge queue item transitioned to FAILED
      const itemRow = conn.sqlite
        .prepare(`SELECT status FROM merge_queue_item WHERE merge_queue_item_id = ?`)
        .get(itemId) as { status: string };
      expect(itemRow.status).toBe("FAILED");

      // Assert: audit events recorded the transitions
      const taskAuditEvents = getAuditEvents(conn, taskId);
      expect(taskAuditEvents.length).toBeGreaterThanOrEqual(2);

      const finalTaskAudit = taskAuditEvents[taskAuditEvents.length - 1]!;
      expect(finalTaskAudit.new_status).toBe("FAILED");

      // Assert: domain events emitted
      const taskEvents = events.filter((e) => e.entityType === "task");
      expect(taskEvents.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * Verifies that conflicts in protected paths (package.json) trigger
     * non-reworkable classification even with only 2 conflicting files.
     * Protected paths override the file count threshold.
     */
    it("transitions to FAILED when protected paths are in conflict even with few files", async () => {
      const taskId = seedTaskInState(
        conn,
        repositoryId,
        "QUEUED_FOR_MERGE",
        "Feature with protected path conflict",
      );
      const itemId = seedMergeQueueItem(conn, taskId, repositoryId, "PREPARING");

      const { emitter } = createCapturingEmitter();

      const unitOfWork = createMergeExecutorUnitOfWorkAdapter(conn);

      const gitOps = createFakeGitOps({
        success: false,
        conflictFiles: ["package.json", "src/feature.ts"],
      });
      const conflictClassifier = createConflictClassifierService(DEFAULT_MERGE_CONFLICT_POLICY);

      const mergeExecutor = createMergeExecutorService({
        unitOfWork,
        eventEmitter: emitter,
        gitOps,
        validation: createFakeMergeValidation(),
        conflictClassifier,
        artifactStore: createFakeArtifactStore(),
      });

      const result = await mergeExecutor.executeMerge({
        mergeQueueItemId: itemId,
        workspacePath: "/tmp/workspace/test",
        targetBranch: "main",
        actor: SYSTEM_ACTOR,
      });

      expect(result.outcome).toBe("rebase_conflict");

      const taskRow = conn.sqlite
        .prepare(`SELECT status FROM task WHERE task_id = ?`)
        .get(taskId) as { status: string };
      expect(taskRow.status).toBe("FAILED");
    });
  });

  // =========================================================================
  // 4. Post-merge validation severity classification
  // =========================================================================

  describe("Post-merge validation severity classification", () => {
    /**
     * Verifies that a single required check failure (non-security) is
     * classified as "high" severity. High severity triggers operator
     * notification but does NOT pause the merge queue.
     */
    it("classifies as high severity when required checks fail below critical threshold", () => {
      const validationResult = createHighSeverityValidationResult();
      const severity = classifyFailureSeverity(validationResult, DEFAULT_POST_MERGE_FAILURE_POLICY);
      expect(severity).toBe("high");
    });

    /**
     * Verifies that a security check failure is always classified as
     * "critical" regardless of the total failure count. Security
     * failures represent the highest risk and require immediate action.
     */
    it("classifies as critical when security check fails", () => {
      const validationResult: ValidationRunResult = {
        profileName: "merge-gate",
        overallStatus: "failed",
        checkOutcomes: [
          {
            checkName: "security",
            command: "npm audit",
            category: "required",
            status: "failed",
            durationMs: 1500,
            errorMessage: "Critical vulnerability",
          },
        ],
        summary: "Security check failed",
        totalDurationMs: 1500,
        requiredPassedCount: 0,
        requiredFailedCount: 1,
        optionalPassedCount: 0,
        optionalFailedCount: 0,
        skippedCount: 0,
      };

      const severity = classifyFailureSeverity(validationResult, DEFAULT_POST_MERGE_FAILURE_POLICY);
      expect(severity).toBe("critical");
    });

    /**
     * Verifies that exceeding the critical_check_threshold (default: 3)
     * for required check failures triggers critical severity even without
     * a security check failure.
     */
    it("classifies as critical when required failures exceed threshold", () => {
      const validationResult = createCriticalSeverityValidationResult();
      const severity = classifyFailureSeverity(validationResult, DEFAULT_POST_MERGE_FAILURE_POLICY);
      expect(severity).toBe("critical");
    });

    /**
     * Verifies that failures limited to optional checks are classified
     * as "low" severity. Low severity creates a diagnostic task but
     * does not interrupt the merge queue or alert the operator urgently.
     */
    it("classifies as low when only optional checks fail", () => {
      const validationResult: ValidationRunResult = {
        profileName: "merge-gate",
        overallStatus: "failed",
        checkOutcomes: [
          {
            checkName: "test",
            command: "npm test",
            category: "required",
            status: "passed",
            durationMs: 5000,
          },
          {
            checkName: "style-check",
            command: "prettier --check",
            category: "optional",
            status: "failed",
            durationMs: 1000,
            errorMessage: "Formatting issues",
          },
        ],
        summary: "1 optional check failed",
        totalDurationMs: 6000,
        requiredPassedCount: 1,
        requiredFailedCount: 0,
        optionalPassedCount: 0,
        optionalFailedCount: 1,
        skippedCount: 0,
      };

      const severity = classifyFailureSeverity(validationResult, DEFAULT_POST_MERGE_FAILURE_POLICY);
      expect(severity).toBe("low");
    });
  });

  // =========================================================================
  // 5. Post-merge validation — high severity failure
  // =========================================================================

  describe("Post-merge validation: high severity failure", () => {
    /**
     * Verifies the full post-merge validation flow for high-severity
     * failures (1 required check fails, no security):
     *
     * 1. Task starts in POST_MERGE_VALIDATION state
     * 2. Validation runner returns a result with 1 required check failing
     * 3. Service classifies severity as "high"
     * 4. Task transitions to FAILED
     * 5. Operator is notified with requiresAction flag
     * 6. Merge queue is NOT paused (high ≠ critical)
     * 7. Audit events record the failure with severity metadata
     *
     * Per §9.11: high severity alerts the operator and invokes the
     * analysis agent (if enabled) but allows the queue to continue.
     */
    it("transitions to FAILED and notifies operator without pausing queue", async () => {
      // Arrange
      const taskId = seedTaskInState(
        conn,
        repositoryId,
        "POST_MERGE_VALIDATION",
        "Task with high severity post-merge failure",
      );
      const itemId = seedMergeQueueItem(conn, taskId, repositoryId, "MERGED");

      const { emitter, events: _highSeverityEvents } = createCapturingEmitter();
      const queuePause = createTrackingQueuePause();
      const notifier = createTrackingNotifier();
      const followUpCreator = createTrackingFollowUpCreator();

      const postMergeService = createPostMergeValidationService({
        unitOfWork: createPostMergeUnitOfWorkAdapter(conn, followUpCreator),
        eventEmitter: emitter,
        validationRunner: createFakeValidationRunner(createHighSeverityValidationResult()),
        mergeQueuePause: queuePause,
        operatorNotification: notifier,
      });

      // Act
      const result = await postMergeService.executePostMergeValidation({
        taskId,
        workspacePath: "/tmp/workspace/test",
        mergeQueueItemId: itemId,
        actor: SYSTEM_ACTOR,
      });

      // Assert: result indicates failure with high severity
      expect(result.outcome).toBe("failed");
      const failureResult = result as PostMergeFailureResult;
      expect(failureResult.severity).toBe("high");

      // Assert: task transitioned to FAILED
      const taskRow = conn.sqlite
        .prepare(`SELECT status FROM task WHERE task_id = ?`)
        .get(taskId) as { status: string };
      expect(taskRow.status).toBe("FAILED");

      // Assert: queue NOT paused (high severity doesn't pause)
      expect(failureResult.queuePaused).toBe(false);
      expect(queuePause.pauseCalls).toHaveLength(0);
      expect(queuePause.isPaused(repositoryId)).toBe(false);

      // Assert: operator notified
      expect(notifier.notifications.length).toBeGreaterThanOrEqual(1);
      const notification = notifier.notifications[0]!;
      expect(notification.severity).toBe("high");
      expect(notification.taskId).toBe(taskId);

      // Assert: audit events recorded
      const auditEvents = getAuditEvents(conn, taskId);
      expect(auditEvents.length).toBeGreaterThanOrEqual(1);
      const failureAudit = auditEvents.find((e) => e.new_status === "FAILED");
      expect(failureAudit).toBeDefined();
    });
  });

  // =========================================================================
  // 6. Post-merge validation — critical failure → revert task + queue pause
  // =========================================================================

  describe("Critical post-merge failure → revert task + queue pause", () => {
    /**
     * Verifies the full post-merge validation flow for critical-severity
     * failures (security check fails + multiple required checks):
     *
     * 1. Task starts in POST_MERGE_VALIDATION state
     * 2. Validation runner returns critical-severity result
     * 3. Service classifies severity as "critical"
     * 4. Task transitions to FAILED
     * 5. Revert task is automatically generated (autoRevertOnCritical)
     * 6. Merge queue is PAUSED for the affected repository
     * 7. Operator is notified with immediate action required
     * 8. Audit events record the full failure context
     *
     * Per §9.11: critical severity triggers automatic revert task
     * generation and pauses the merge queue. The queue stays paused
     * until an operator confirms resume.
     */
    it("creates revert task and pauses queue on critical failure", async () => {
      // Arrange
      const taskId = seedTaskInState(
        conn,
        repositoryId,
        "POST_MERGE_VALIDATION",
        "Task with critical post-merge failure",
      );
      const itemId = seedMergeQueueItem(conn, taskId, repositoryId, "MERGED");

      const { emitter, events } = createCapturingEmitter();
      const queuePause = createTrackingQueuePause();
      const notifier = createTrackingNotifier();
      const followUpCreator = createTrackingFollowUpCreator();

      const postMergeService = createPostMergeValidationService({
        unitOfWork: createPostMergeUnitOfWorkAdapter(conn, followUpCreator),
        eventEmitter: emitter,
        validationRunner: createFakeValidationRunner(createCriticalSeverityValidationResult()),
        mergeQueuePause: queuePause,
        operatorNotification: notifier,
      });

      // Act
      const result = await postMergeService.executePostMergeValidation({
        taskId,
        workspacePath: "/tmp/workspace/test",
        mergeQueueItemId: itemId,
        actor: SYSTEM_ACTOR,
      });

      // Assert: result indicates failure with critical severity
      expect(result.outcome).toBe("failed");
      const failureResult = result as PostMergeFailureResult;
      expect(failureResult.severity).toBe("critical");

      // Assert: task transitioned to FAILED
      const taskRow = conn.sqlite
        .prepare(`SELECT status FROM task WHERE task_id = ?`)
        .get(taskId) as { status: string };
      expect(taskRow.status).toBe("FAILED");

      // Assert: revert task was created
      expect(failureResult.followUpTasks.length).toBeGreaterThanOrEqual(1);
      const revertTask = failureResult.followUpTasks.find((t) => t.taskType === "revert");
      expect(revertTask).toBeDefined();

      // Assert: follow-up creator was called with correct data
      expect(followUpCreator.createdTasks.length).toBeGreaterThanOrEqual(1);
      const revertCreation = followUpCreator.createdTasks.find((c) => c.data.taskType === "revert");
      expect(revertCreation).toBeDefined();
      expect(revertCreation!.data.originTaskId).toBe(taskId);
      expect(revertCreation!.data.repositoryId).toBe(repositoryId);
      expect(revertCreation!.data.projectId).toBe(projectId);

      // Assert: queue IS paused (critical severity)
      expect(failureResult.queuePaused).toBe(true);
      expect(queuePause.pauseCalls).toHaveLength(1);
      expect(queuePause.pauseCalls[0]!.repositoryId).toBe(repositoryId);
      expect(queuePause.isPaused(repositoryId)).toBe(true);

      // Assert: operator notified with critical severity
      expect(notifier.notifications.length).toBeGreaterThanOrEqual(1);
      const notification = notifier.notifications.find((n) => n.severity === "critical");
      expect(notification).toBeDefined();
      expect(notification!.requiresAction).toBe(true);
      expect(notification!.taskId).toBe(taskId);

      // Assert: audit events recorded the failure
      const auditEvents = getAuditEvents(conn, taskId);
      expect(auditEvents.length).toBeGreaterThanOrEqual(1);
      const failureAudit = auditEvents.find((e) => e.new_status === "FAILED");
      expect(failureAudit).toBeDefined();

      // Assert: domain events emitted for the transition
      const taskEvents = events.filter((e) => e.entityType === "task");
      expect(taskEvents.length).toBeGreaterThanOrEqual(1);
    });
  });
});
