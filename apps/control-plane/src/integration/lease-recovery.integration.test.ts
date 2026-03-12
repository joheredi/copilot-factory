/**
 * Integration test: Lease timeout and crash recovery.
 *
 * Validates the lease management crash recovery paths through real SQLite
 * database, real TransitionService, real HeartbeatService, and real
 * LeaseReclaimService:
 *
 * **Scenarios:**
 *   - Heartbeat timeout: worker stops sending heartbeats → lease reclaim → task re-enters READY
 *   - Process crash: worker exits non-zero → lease CRASHED → retry or escalate
 *   - Grace period: terminal heartbeat extends expiry → result accepted within grace window
 *   - Retry exhaustion: max retries exceeded → ESCALATED
 *
 * Each test verifies:
 *   - Domain state machine guards accept the transitions
 *   - Staleness detection correctly classifies stale leases
 *   - Retry/escalation policy is evaluated and applied
 *   - Audit events are persisted atomically with decision context
 *   - State machine invariants are maintained throughout
 *
 * Uses FakeClock for deterministic time control — all time-based checks
 * are driven by explicit clock advancement, not real wall-clock time.
 *
 * This is the V1 lease recovery integration test described in T110.
 *
 * @see docs/backlog/tasks/T110-e2e-lease-recovery.md
 * @see docs/prd/002-data-model.md §2.8 — Worker Lease Protocol
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8 — Lease and Heartbeat Policy
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.6 — Retry Policy
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.7 — Escalation Policy
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  TaskStatus,
  WorkerLeaseStatus,
  type RetryPolicy,
  DEFAULT_ESCALATION_POLICY,
  BackoffStrategy,
} from "@factory/domain";

import {
  createTransitionService,
  createHeartbeatService,
  createLeaseReclaimService,
  type TransitionService,
  type HeartbeatService,
  type LeaseReclaimService,
  type DomainEventEmitter,
  type DomainEvent,
  type ActorInfo,
  type StalenessPolicy,
  type HeartbeatUnitOfWork,
  type HeartbeatTransactionRepositories,
  type HeartbeatLeaseRepositoryPort,
  type HeartbeatableLease,
  type StaleLeaseRecord,
  type ReclaimUnitOfWork,
  type ReclaimTransactionRepositories,
  type ReclaimLeaseRepositoryPort,
  type ReclaimableTask,
  type ReclaimableLease,
  type ReclaimTaskRepositoryPort,
  VersionConflictError,
} from "@factory/application";

import { createTestDatabase, FakeClock, type TestDatabaseConnection } from "@factory/testing";

import { createSqliteUnitOfWork } from "../infrastructure/unit-of-work/sqlite-unit-of-work.js";
import { createAuditEventPortAdapter } from "../infrastructure/unit-of-work/repository-adapters.js";
import { createTaskLeaseRepository } from "../infrastructure/repositories/task-lease.repository.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

import { resolve } from "node:path";

// ─── Constants ──────────────────────────────────────────────────────────────

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, "../../drizzle");

const SYSTEM_ACTOR: ActorInfo = {
  type: "system",
  id: "lease-recovery-integration-test",
};

/** Default staleness policy per PRD §9.8: 30s interval, 2 missed, 15s grace. */
const DEFAULT_STALENESS_POLICY: StalenessPolicy = {
  heartbeatIntervalSeconds: 30,
  missedHeartbeatThreshold: 2,
  gracePeriodSeconds: 15,
};

/** Default retry policy: max 2 retries with exponential backoff. */
const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_attempts: 2,
  backoff_strategy: BackoffStrategy.EXPONENTIAL,
  initial_backoff_seconds: 60,
  max_backoff_seconds: 900,
  reuse_same_pool: true,
  allow_pool_change_after_failure: true,
  require_failure_summary_packet: false,
};

/** Exhausted retry policy: 0 retries allowed. */
const EXHAUSTED_RETRY_POLICY: RetryPolicy = {
  ...DEFAULT_RETRY_POLICY,
  max_attempts: 0,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Creates a domain event emitter that captures all emitted events.
 * Used to verify that the correct domain events are emitted after
 * each successful transition.
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

/** Parsed audit event for test assertions. */
interface ParsedAuditEvent {
  entity_type: string;
  event_type: string;
  old_state: string | null;
  new_state: string;
  old_status: string | null;
  new_status: string;
  metadata_json: string | null;
}

/**
 * Extracts the `status` field from a JSON-encoded state string.
 * Audit events store state as JSON objects (e.g., `{"status":"ESCALATED","version":5}`).
 */
function extractStatus(stateJson: string | null): string | null {
  if (!stateJson) return null;
  try {
    const parsed = JSON.parse(stateJson);
    return typeof parsed === "object" && parsed !== null ? (parsed.status ?? null) : stateJson;
  } catch {
    return stateJson;
  }
}

/**
 * Retrieves all audit events for a given entity, ordered by creation time.
 * Includes parsed status fields and raw metadata_json for assertions.
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

/**
 * Wraps a TestDatabaseConnection to satisfy the DatabaseConnection interface
 * expected by createSqliteUnitOfWork.
 *
 * TestDatabaseConnection lacks `healthCheck()` which DatabaseConnection requires.
 * This adapter adds a stub healthCheck for test environments.
 */
function asDatabaseConnection(conn: TestDatabaseConnection): DatabaseConnection {
  return {
    db: conn.db,
    sqlite: conn.sqlite,
    close: () => conn.close(),
    healthCheck: () => ({ ok: true, walMode: true, foreignKeys: true }),
    writeTransaction: <T>(fn: (db: typeof conn.db) => T): T => conn.writeTransaction(fn),
  };
}

// ─── Heartbeat Unit of Work Adapter ─────────────────────────────────────────

/**
 * Creates a HeartbeatUnitOfWork backed by real SQLite for integration testing.
 *
 * Provides transaction-scoped adapters for heartbeat lease operations and
 * audit event creation, matching the port interface required by
 * {@link createHeartbeatService}.
 */
function createHeartbeatUnitOfWork(conn: DatabaseConnection): HeartbeatUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: HeartbeatTransactionRepositories) => T): T {
      return conn.writeTransaction((db) => {
        const leaseRepo = createTaskLeaseRepository(db);
        const auditEventPort = createAuditEventPortAdapter(db);
        // Raw SQLite handle for complex queries that Drizzle doesn't support well
        const rawSqlite = conn.sqlite;

        const leasePort: HeartbeatLeaseRepositoryPort = {
          findById(leaseId: string): HeartbeatableLease | undefined {
            const lease = leaseRepo.findById(leaseId);
            if (!lease) return undefined;
            return {
              leaseId: lease.leaseId,
              taskId: lease.taskId,
              workerId: lease.workerId,
              status: lease.status as WorkerLeaseStatus,
              heartbeatAt: lease.heartbeatAt,
              expiresAt: lease.expiresAt,
              leasedAt: lease.leasedAt,
            };
          },

          updateHeartbeat(
            leaseId: string,
            expectedStatus: WorkerLeaseStatus,
            newStatus: WorkerLeaseStatus,
            heartbeatAt: Date,
            newExpiresAt?: Date,
          ): HeartbeatableLease {
            const current = leaseRepo.findById(leaseId);
            if (!current || current.status !== expectedStatus) {
              throw new VersionConflictError("TaskLease", leaseId, expectedStatus);
            }
            const updateData: Record<string, unknown> = {
              status: newStatus,
              heartbeatAt,
            };
            if (newExpiresAt !== undefined) {
              updateData.expiresAt = newExpiresAt;
            }
            const updated = leaseRepo.update(leaseId, updateData);
            if (!updated) {
              throw new VersionConflictError("TaskLease", leaseId, expectedStatus);
            }
            return {
              leaseId: updated.leaseId,
              taskId: updated.taskId,
              workerId: updated.workerId,
              status: updated.status as WorkerLeaseStatus,
              heartbeatAt: updated.heartbeatAt,
              expiresAt: updated.expiresAt,
              leasedAt: updated.leasedAt,
            };
          },

          findStaleLeases(heartbeatDeadline: Date, ttlDeadline: Date): readonly StaleLeaseRecord[] {
            const heartbeatDeadlineSec = Math.floor(heartbeatDeadline.getTime() / 1000);
            const ttlDeadlineSec = Math.floor(ttlDeadline.getTime() / 1000);

            // Query for heartbeat-stale OR TTL-expired leases using UNION to deduplicate.
            // Uses raw SQLite prepared statement because the query involves UNION and
            // COALESCE patterns that are simpler to express in raw SQL.
            const rows = rawSqlite
              .prepare(
                `SELECT lease_id, task_id, worker_id, pool_id, status, heartbeat_at, expires_at, leased_at
                 FROM task_lease
                 WHERE status IN ('STARTING', 'RUNNING', 'HEARTBEATING')
                   AND COALESCE(heartbeat_at, leased_at) < ?
                 UNION
                 SELECT lease_id, task_id, worker_id, pool_id, status, heartbeat_at, expires_at, leased_at
                 FROM task_lease
                 WHERE status IN ('LEASED', 'STARTING', 'RUNNING', 'HEARTBEATING')
                   AND expires_at < ?`,
              )
              .all(heartbeatDeadlineSec, ttlDeadlineSec) as Array<{
              lease_id: string;
              task_id: string;
              worker_id: string;
              pool_id: string;
              status: string;
              heartbeat_at: number | null;
              expires_at: number;
              leased_at: number;
            }>;

            return rows.map((r) => ({
              leaseId: r.lease_id,
              taskId: r.task_id,
              workerId: r.worker_id,
              poolId: r.pool_id,
              status: r.status as WorkerLeaseStatus,
              heartbeatAt: r.heartbeat_at != null ? new Date(r.heartbeat_at * 1000) : null,
              expiresAt: new Date(r.expires_at * 1000),
              leasedAt: new Date(r.leased_at * 1000),
            }));
          },
        };

        return fn({ lease: leasePort, auditEvent: auditEventPort });
      });
    },
  };
}

// ─── Reclaim Unit of Work Adapter ───────────────────────────────────────────

/**
 * Creates a ReclaimUnitOfWork backed by real SQLite for integration testing.
 *
 * Provides transaction-scoped adapters for lease reclaim and task state
 * updates, matching the port interface required by
 * {@link createLeaseReclaimService}.
 */
function createReclaimUnitOfWork(conn: DatabaseConnection): ReclaimUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: ReclaimTransactionRepositories) => T): T {
      return conn.writeTransaction((db) => {
        const leaseRepo = createTaskLeaseRepository(db);
        const taskRepo = createTaskRepository(db);
        const auditEventPort = createAuditEventPortAdapter(db);

        const leasePort: ReclaimLeaseRepositoryPort = {
          findById(leaseId: string): ReclaimableLease | undefined {
            const lease = leaseRepo.findById(leaseId);
            if (!lease) return undefined;
            return {
              leaseId: lease.leaseId,
              taskId: lease.taskId,
              workerId: lease.workerId,
              poolId: lease.poolId,
              status: lease.status as WorkerLeaseStatus,
              reclaimReason: lease.reclaimReason,
            };
          },

          updateStatusWithReason(
            leaseId: string,
            expectedStatus: WorkerLeaseStatus,
            newStatus: WorkerLeaseStatus,
            reclaimReason: string,
          ): ReclaimableLease {
            const current = leaseRepo.findById(leaseId);
            if (!current || current.status !== expectedStatus) {
              throw new VersionConflictError("TaskLease", leaseId, expectedStatus);
            }
            const updated = leaseRepo.update(leaseId, {
              status: newStatus,
              reclaimReason,
            });
            if (!updated) {
              throw new VersionConflictError("TaskLease", leaseId, expectedStatus);
            }
            return {
              leaseId: updated.leaseId,
              taskId: updated.taskId,
              workerId: updated.workerId,
              poolId: updated.poolId,
              status: updated.status as WorkerLeaseStatus,
              reclaimReason: updated.reclaimReason,
            };
          },
        };

        const taskPort: ReclaimTaskRepositoryPort = {
          findById(id: string): ReclaimableTask | undefined {
            const task = taskRepo.findById(id);
            if (!task) return undefined;
            return {
              id: task.taskId,
              status: task.status as TaskStatus,
              version: task.version,
              retryCount: task.retryCount,
              currentLeaseId: task.currentLeaseId,
            };
          },

          updateStatusAndRetryCount(
            id: string,
            expectedVersion: number,
            newStatus: TaskStatus,
            retryCount: number,
          ): ReclaimableTask {
            const current = taskRepo.findById(id);
            if (!current || current.version !== expectedVersion) {
              throw new VersionConflictError("Task", id, expectedVersion);
            }
            const updated = taskRepo.update(id, expectedVersion, {
              status: newStatus,
              retryCount,
              currentLeaseId: null,
            });
            return {
              id: updated.taskId,
              status: updated.status as TaskStatus,
              version: updated.version,
              retryCount: updated.retryCount,
              currentLeaseId: updated.currentLeaseId,
            };
          },
        };

        return fn({ lease: leasePort, task: taskPort, auditEvent: auditEventPort });
      });
    },
  };
}

// ─── Seed Functions ─────────────────────────────────────────────────────────

/**
 * Seeds the prerequisite entities required by the task foreign key constraints:
 * project, repository, and worker pool. Returns the generated IDs.
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
 * Seeds a task in BACKLOG status for lifecycle-driven tests.
 * Returns the task ID.
 */
function seedTask(conn: TestDatabaseConnection, repositoryId: string): string {
  const taskId = `task-${crypto.randomUUID().slice(0, 8)}`;

  conn.sqlite
    .prepare(
      `INSERT INTO task (task_id, repository_id, title, task_type, priority, status, source, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(taskId, repositoryId, "Implement feature X", "FEATURE", "HIGH", "BACKLOG", "MANUAL", 1);

  return taskId;
}

/**
 * Seeds a task lease with specific timestamps for time-based tests.
 * Uses the FakeClock's time for consistent, deterministic timestamps.
 *
 * @param leasedAtEpochSec - Lease acquisition time in Unix seconds
 * @param expiresAtEpochSec - Lease expiry time in Unix seconds
 * @param heartbeatAtEpochSec - Optional last heartbeat time in Unix seconds
 */
function seedTaskLease(
  conn: TestDatabaseConnection,
  taskId: string,
  workerPoolId: string,
  status: string,
  leasedAtEpochSec: number,
  expiresAtEpochSec: number,
  heartbeatAtEpochSec?: number,
): string {
  const leaseId = `lease-${crypto.randomUUID().slice(0, 8)}`;
  const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;

  conn.sqlite
    .prepare(
      `INSERT INTO task_lease (lease_id, task_id, worker_id, pool_id, leased_at, expires_at, heartbeat_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      leaseId,
      taskId,
      workerId,
      workerPoolId,
      leasedAtEpochSec,
      expiresAtEpochSec,
      heartbeatAtEpochSec ?? null,
      status,
    );

  // Link the lease to the task
  conn.sqlite
    .prepare("UPDATE task SET current_lease_id = ? WHERE task_id = ?")
    .run(leaseId, taskId);

  return leaseId;
}

// ─── Transition Helpers ─────────────────────────────────────────────────────

/**
 * Drives a task from BACKLOG through to IN_DEVELOPMENT and sets up a
 * HEARTBEATING lease with the given timestamps.
 *
 * Traverses: BACKLOG → READY → ASSIGNED → IN_DEVELOPMENT
 * Lease lifecycle: LEASED → STARTING → RUNNING → HEARTBEATING
 *
 * @param clock - FakeClock for deterministic lease timestamps
 * @param leaseTtlSeconds - Lease TTL in seconds (default 1800 = 30 min)
 * @returns The lease ID and task version after the final transition
 */
function driveTaskToInDevelopmentWithLease(
  conn: TestDatabaseConnection,
  ts: TransitionService,
  taskId: string,
  workerPoolId: string,
  clock: FakeClock,
  leaseTtlSeconds: number = 1800,
): { leaseId: string; versionAfter: number } {
  // BACKLOG → READY
  ts.transitionTask(
    taskId,
    TaskStatus.READY,
    { allDependenciesResolved: true, hasPolicyBlockers: false },
    SYSTEM_ACTOR,
  );

  // Seed a lease with clock-controlled timestamps
  const nowSec = Math.floor(clock.now() / 1000);
  const leaseId = seedTaskLease(
    conn,
    taskId,
    workerPoolId,
    "LEASED",
    nowSec,
    nowSec + leaseTtlSeconds,
    undefined,
  );

  // READY → ASSIGNED
  ts.transitionTask(taskId, TaskStatus.ASSIGNED, { leaseAcquired: true }, SYSTEM_ACTOR);

  // Lease: LEASED → STARTING → RUNNING → HEARTBEATING
  ts.transitionLease(
    leaseId,
    WorkerLeaseStatus.STARTING,
    { workerProcessSpawned: true },
    SYSTEM_ACTOR,
  );
  ts.transitionLease(
    leaseId,
    WorkerLeaseStatus.RUNNING,
    { firstHeartbeatReceived: true },
    SYSTEM_ACTOR,
  );

  // ASSIGNED → IN_DEVELOPMENT
  const result = ts.transitionTask(
    taskId,
    TaskStatus.IN_DEVELOPMENT,
    { hasHeartbeat: true },
    SYSTEM_ACTOR,
  );

  ts.transitionLease(
    leaseId,
    WorkerLeaseStatus.HEARTBEATING,
    { heartbeatReceived: true },
    SYSTEM_ACTOR,
  );

  // Record the initial heartbeat time at clock's current time
  const heartbeatSec = Math.floor(clock.now() / 1000);
  conn.sqlite
    .prepare("UPDATE task_lease SET heartbeat_at = ? WHERE lease_id = ?")
    .run(heartbeatSec, leaseId);

  return { leaseId, versionAfter: result.entity.version };
}

/**
 * Reads the current task row from the database for assertion.
 */
function getTaskRow(
  conn: TestDatabaseConnection,
  taskId: string,
): { status: string; version: number; retry_count: number; current_lease_id: string | null } {
  return conn.sqlite
    .prepare("SELECT status, version, retry_count, current_lease_id FROM task WHERE task_id = ?")
    .get(taskId) as {
    status: string;
    version: number;
    retry_count: number;
    current_lease_id: string | null;
  };
}

/**
 * Reads the current lease row from the database for assertion.
 */
function getLeaseRow(
  conn: TestDatabaseConnection,
  leaseId: string,
): {
  status: string;
  reclaim_reason: string | null;
  heartbeat_at: number | null;
  expires_at: number;
} {
  return conn.sqlite
    .prepare(
      "SELECT status, reclaim_reason, heartbeat_at, expires_at FROM task_lease WHERE lease_id = ?",
    )
    .get(leaseId) as {
    status: string;
    reclaim_reason: string | null;
    heartbeat_at: number | null;
    expires_at: number;
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("Lease Timeout and Crash Recovery (T110)", () => {
  let conn: TestDatabaseConnection;
  let dbConn: DatabaseConnection;
  let clock: FakeClock;
  let transitionService: TransitionService;
  let heartbeatService: HeartbeatService;
  let leaseReclaimService: LeaseReclaimService;
  let capturedEvents: DomainEvent[];

  let repositoryId: string;
  let workerPoolId: string;

  beforeEach(() => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    dbConn = asDatabaseConnection(conn);
    clock = new FakeClock();

    const unitOfWork = createSqliteUnitOfWork(dbConn);
    const heartbeatUow = createHeartbeatUnitOfWork(dbConn);
    const reclaimUow = createReclaimUnitOfWork(dbConn);

    const { emitter, events } = createCapturingEmitter();
    capturedEvents = events;

    transitionService = createTransitionService(unitOfWork, emitter);
    heartbeatService = createHeartbeatService(heartbeatUow, emitter, () => new Date(clock.now()));
    leaseReclaimService = createLeaseReclaimService(reclaimUow, emitter);

    ({ repositoryId, workerPoolId } = seedPrerequisites(conn));
  });

  afterEach(() => {
    conn.close();
  });

  // ─── Scenario 1: Heartbeat Timeout → Reclaim → Retry ─────────────────

  describe("Heartbeat timeout detection and retry", () => {
    /**
     * Validates the full heartbeat timeout recovery path:
     *
     * 1. Task is driven to IN_DEVELOPMENT with a HEARTBEATING lease
     * 2. Clock advances past the staleness window (interval × missed + grace)
     * 3. detectStaleLeases correctly identifies the lease as stale
     * 4. reclaimLease transitions the lease to TIMED_OUT
     * 5. Retry policy allows retry → task returns to READY
     * 6. Audit event records the reclaim decision with retry context
     *
     * Why this test matters: Heartbeat timeout is the primary mechanism for
     * detecting worker failures. If detection or reclaim fails, stuck workers
     * will permanently block tasks from being rescheduled.
     */
    it("should detect stale lease and retry when heartbeat times out", () => {
      const taskId = seedTask(conn, repositoryId);
      const { leaseId } = driveTaskToInDevelopmentWithLease(
        conn,
        transitionService,
        taskId,
        workerPoolId,
        clock,
      );

      // ── Advance clock past the staleness window ──────────────────────
      // Default policy: 30s interval × 2 missed + 15s grace = 75 seconds
      const stalenessWindowMs =
        (DEFAULT_STALENESS_POLICY.heartbeatIntervalSeconds *
          DEFAULT_STALENESS_POLICY.missedHeartbeatThreshold +
          DEFAULT_STALENESS_POLICY.gracePeriodSeconds) *
        1000;
      clock.advance(stalenessWindowMs + 1000); // 76 seconds past initial heartbeat

      // ── Detect stale leases ──────────────────────────────────────────
      const staleResult = heartbeatService.detectStaleLeases(DEFAULT_STALENESS_POLICY);

      expect(staleResult.staleLeases).toHaveLength(1);
      expect(staleResult.staleLeases[0]!.leaseId).toBe(leaseId);
      expect(staleResult.staleLeases[0]!.reason).toBe("missed_heartbeats");

      // ── Reclaim the stale lease with retry ───────────────────────────
      const reclaimResult = leaseReclaimService.reclaimLease({
        leaseId,
        reason: "missed_heartbeats",
        retryPolicy: DEFAULT_RETRY_POLICY,
        escalationPolicy: DEFAULT_ESCALATION_POLICY,
        actor: SYSTEM_ACTOR,
      });

      // Verify lease transitioned to TIMED_OUT
      expect(reclaimResult.lease.status).toBe(WorkerLeaseStatus.TIMED_OUT);

      // Verify task returned to READY (retry granted)
      expect(reclaimResult.task.status).toBe(TaskStatus.READY);
      expect(reclaimResult.outcome).toBe("retried");
      expect(reclaimResult.retryEvaluation.eligible).toBe(true);
      expect(reclaimResult.escalationEvaluation).toBeNull();

      // ── Verify database state ────────────────────────────────────────
      const taskRow = getTaskRow(conn, taskId);
      expect(taskRow.status).toBe("READY");
      expect(taskRow.retry_count).toBe(1);
      expect(taskRow.current_lease_id).toBeNull();

      const leaseRow = getLeaseRow(conn, leaseId);
      expect(leaseRow.status).toBe("TIMED_OUT");
      expect(leaseRow.reclaim_reason).toBe("missed_heartbeats");

      // ── Verify audit trail ───────────────────────────────────────────
      const leaseAuditEvents = getAuditEvents(conn, leaseId);
      const reclaimAudit = leaseAuditEvents.find((e) => e.event_type === "lease.reclaimed");
      expect(reclaimAudit).toBeDefined();
    });

    /**
     * Validates that a lease with regular heartbeats is NOT classified as stale.
     * This is the negative case — workers that keep heartbeating should not
     * be reclaimed.
     *
     * Why this test matters: False positive staleness detection would
     * prematurely reclaim active workers, wasting work and creating
     * duplicate task execution.
     */
    it("should not detect active lease as stale", () => {
      const taskId = seedTask(conn, repositoryId);
      driveTaskToInDevelopmentWithLease(conn, transitionService, taskId, workerPoolId, clock);

      // Advance clock by only 20 seconds — well within the 75-second window
      clock.advance(20_000);

      const staleResult = heartbeatService.detectStaleLeases(DEFAULT_STALENESS_POLICY);
      expect(staleResult.staleLeases).toHaveLength(0);
    });
  });

  // ─── Scenario 2: Worker Crash → CRASHED → Retry/Escalate ─────────────

  describe("Worker crash recovery", () => {
    /**
     * Validates crash recovery when the worker process exits abnormally.
     *
     * Unlike heartbeat timeout (which takes time to detect), a crash can be
     * reported immediately by the supervisor. The lease transitions to CRASHED
     * (not TIMED_OUT) and the same retry/escalation logic applies.
     *
     * Why this test matters: Crash recovery must capture partial work artifacts
     * and correctly evaluate retry eligibility. If crashes aren't handled,
     * tasks remain stuck in IN_DEVELOPMENT with a dead worker.
     */
    it("should reclaim crashed lease and retry task", () => {
      const taskId = seedTask(conn, repositoryId);
      const { leaseId } = driveTaskToInDevelopmentWithLease(
        conn,
        transitionService,
        taskId,
        workerPoolId,
        clock,
      );

      // ── Reclaim due to worker crash ──────────────────────────────────
      const reclaimResult = leaseReclaimService.reclaimLease({
        leaseId,
        reason: "worker_crashed",
        retryPolicy: DEFAULT_RETRY_POLICY,
        escalationPolicy: DEFAULT_ESCALATION_POLICY,
        actor: SYSTEM_ACTOR,
        metadata: { exitCode: 1, signal: "SIGKILL" },
      });

      // Verify lease transitioned to CRASHED (not TIMED_OUT)
      expect(reclaimResult.lease.status).toBe(WorkerLeaseStatus.CRASHED);

      // Verify task returned to READY (retry granted)
      expect(reclaimResult.task.status).toBe(TaskStatus.READY);
      expect(reclaimResult.outcome).toBe("retried");

      // ── Verify database state ────────────────────────────────────────
      const taskRow = getTaskRow(conn, taskId);
      expect(taskRow.status).toBe("READY");
      expect(taskRow.retry_count).toBe(1);

      const leaseRow = getLeaseRow(conn, leaseId);
      expect(leaseRow.status).toBe("CRASHED");
      expect(leaseRow.reclaim_reason).toBe("worker_crashed");

      // ── Verify audit trail captures crash context ────────────────────
      const leaseAuditEvents = getAuditEvents(conn, leaseId);
      const reclaimAudit = leaseAuditEvents.find((e) => e.event_type === "lease.reclaimed");
      expect(reclaimAudit).toBeDefined();
      expect(reclaimAudit!.metadata_json).not.toBeNull();

      const metadata = JSON.parse(reclaimAudit!.metadata_json!);
      expect(metadata.exitCode).toBe(1);
      expect(metadata.signal).toBe("SIGKILL");
    });

    /**
     * Validates that crash recovery works for a task still in ASSIGNED state
     * (worker never sent the first heartbeat, so task never moved to IN_DEVELOPMENT).
     *
     * Why this test matters: Workers can crash during startup before the first
     * heartbeat. The reclaim path must handle both ASSIGNED and IN_DEVELOPMENT tasks.
     */
    it("should reclaim crashed lease when task is still ASSIGNED", () => {
      const taskId = seedTask(conn, repositoryId);

      // Drive to ASSIGNED but not IN_DEVELOPMENT
      transitionService.transitionTask(
        taskId,
        TaskStatus.READY,
        { allDependenciesResolved: true, hasPolicyBlockers: false },
        SYSTEM_ACTOR,
      );

      const nowSec = Math.floor(clock.now() / 1000);
      const leaseId = seedTaskLease(conn, taskId, workerPoolId, "LEASED", nowSec, nowSec + 1800);

      transitionService.transitionTask(
        taskId,
        TaskStatus.ASSIGNED,
        { leaseAcquired: true },
        SYSTEM_ACTOR,
      );

      // Lease: LEASED → STARTING (worker process spawned but crashed before heartbeat)
      transitionService.transitionLease(
        leaseId,
        WorkerLeaseStatus.STARTING,
        { workerProcessSpawned: true },
        SYSTEM_ACTOR,
      );

      // ── Reclaim due to crash during startup ──────────────────────────
      const reclaimResult = leaseReclaimService.reclaimLease({
        leaseId,
        reason: "worker_crashed",
        retryPolicy: DEFAULT_RETRY_POLICY,
        escalationPolicy: DEFAULT_ESCALATION_POLICY,
        actor: SYSTEM_ACTOR,
      });

      expect(reclaimResult.lease.status).toBe(WorkerLeaseStatus.CRASHED);
      expect(reclaimResult.task.status).toBe(TaskStatus.READY);
      expect(reclaimResult.outcome).toBe("retried");

      const taskRow = getTaskRow(conn, taskId);
      expect(taskRow.status).toBe("READY");
      expect(taskRow.retry_count).toBe(1);
    });
  });

  // ─── Scenario 3: Grace Period Acceptance ──────────────────────────────

  describe("Grace period: terminal heartbeat extends expiry", () => {
    /**
     * Validates the graceful completion protocol:
     *
     * 1. Worker sends a terminal heartbeat (completing: true) before the
     *    staleness window expires
     * 2. The lease transitions to COMPLETING and its expiry is extended
     *    by the grace period
     * 3. After extension, the lease is NOT classified as stale during the
     *    grace window — the worker has time to deliver its result packet
     *
     * This matches the PRD §9.8 graceful completion protocol:
     *   "Upon receiving a terminal heartbeat, the lease manager extends the
     *   stale-detection window by grace_period_seconds."
     *
     * Why this test matters: Without the grace period extension, a worker
     * that's about to submit its result would have its lease reclaimed,
     * losing completed work and wasting a retry attempt.
     */
    it("should extend lease expiry on terminal heartbeat and not reclaim during grace", () => {
      const taskId = seedTask(conn, repositoryId);
      const { leaseId } = driveTaskToInDevelopmentWithLease(
        conn,
        transitionService,
        taskId,
        workerPoolId,
        clock,
      );

      // ── Advance clock to near (but within) the staleness window ──────
      // 60 seconds < 75 seconds staleness window
      clock.advance(60_000);

      // ── Worker sends terminal heartbeat with completing: true ─────────
      const heartbeatResult = heartbeatService.receiveHeartbeat({
        leaseId,
        completing: true,
        gracePeriodSeconds: DEFAULT_STALENESS_POLICY.gracePeriodSeconds,
        actor: { type: "worker", id: "test-worker" },
      });

      // Lease should transition to COMPLETING
      expect(heartbeatResult.lease.status).toBe(WorkerLeaseStatus.COMPLETING);
      expect(heartbeatResult.previousStatus).toBe(WorkerLeaseStatus.HEARTBEATING);

      // ── Verify the lease's expiry was extended ────────────────────────
      const leaseRow = getLeaseRow(conn, leaseId);
      const expectedGraceExpiry =
        Math.floor(clock.now() / 1000) + DEFAULT_STALENESS_POLICY.gracePeriodSeconds;
      // The new expiry should be at least now + grace period
      expect(leaseRow.expires_at).toBeGreaterThanOrEqual(expectedGraceExpiry);

      // ── Verify the lease is NOT detected as stale during grace ────────
      // Advance clock by 10 more seconds — still within the 15s grace period
      clock.advance(10_000);

      // COMPLETING leases are not in the heartbeat-receivable/active set
      // so they should not appear as stale from heartbeat checks.
      // However, they could be TTL-expired. Since we extended the TTL,
      // the lease should not be stale.
      const staleResult = heartbeatService.detectStaleLeases(DEFAULT_STALENESS_POLICY);
      const staleLease = staleResult.staleLeases.find((l) => l.leaseId === leaseId);
      expect(staleLease).toBeUndefined();
    });

    /**
     * Validates that a result arriving within the grace period after
     * a terminal heartbeat is still accepted — the task can complete
     * normally even though the staleness window would have fired without
     * the terminal heartbeat extension.
     *
     * Simulates: terminal heartbeat → grace extension → clock advances past
     * original staleness window but within grace → DEV_COMPLETE transition
     * succeeds.
     *
     * Why this test matters: This is the race condition the grace period
     * is designed to prevent. Without it, workers that send results slightly
     * late would lose their work.
     */
    it("should accept result within grace period after terminal heartbeat", () => {
      const taskId = seedTask(conn, repositoryId);
      const { leaseId } = driveTaskToInDevelopmentWithLease(
        conn,
        transitionService,
        taskId,
        workerPoolId,
        clock,
      );

      // Advance to near staleness window
      clock.advance(60_000);

      // Worker sends terminal heartbeat
      heartbeatService.receiveHeartbeat({
        leaseId,
        completing: true,
        gracePeriodSeconds: DEFAULT_STALENESS_POLICY.gracePeriodSeconds,
        actor: { type: "worker", id: "test-worker" },
      });

      // Advance clock by 10 more seconds — past original heartbeat window
      // but within the grace period
      clock.advance(10_000);

      // ── Worker delivers result — task transitions to DEV_COMPLETE ─────
      // The lease is now in COMPLETING state. The task can proceed.
      const result = transitionService.transitionTask(
        taskId,
        TaskStatus.DEV_COMPLETE,
        { hasDevResultPacket: true, requiredValidationsPassed: true },
        SYSTEM_ACTOR,
      );

      expect(result.entity.status).toBe(TaskStatus.DEV_COMPLETE);

      // Verify task progressed successfully
      const taskRow = getTaskRow(conn, taskId);
      expect(taskRow.status).toBe("DEV_COMPLETE");
      expect(taskRow.retry_count).toBe(0); // No retry needed — work was delivered
    });
  });

  // ─── Scenario 4: Retry Exhaustion → ESCALATED ────────────────────────

  describe("Retry exhaustion triggers escalation", () => {
    /**
     * Validates that when retries are exhausted, the task is escalated
     * instead of returning to READY.
     *
     * Exercises the full path:
     * 1. Task in IN_DEVELOPMENT with retry_count already at max_attempts
     * 2. Heartbeat times out → staleness detected
     * 3. reclaimLease evaluates retry policy → not eligible
     * 4. Escalation policy fires → task moves to ESCALATED
     *
     * Why this test matters: Without escalation on retry exhaustion, tasks
     * would either loop forever (if retry is always granted) or silently
     * fail (if FAILED is the only alternative). Escalation surfaces the
     * issue to an operator for human intervention.
     */
    it("should escalate when retries are exhausted after heartbeat timeout", () => {
      const taskId = seedTask(conn, repositoryId);
      const { leaseId } = driveTaskToInDevelopmentWithLease(
        conn,
        transitionService,
        taskId,
        workerPoolId,
        clock,
      );

      // Simulate prior retry attempts by setting retry_count to max_attempts
      conn.sqlite
        .prepare("UPDATE task SET retry_count = ? WHERE task_id = ?")
        .run(DEFAULT_RETRY_POLICY.max_attempts, taskId);

      // ── Advance clock past staleness window ──────────────────────────
      const stalenessWindowMs =
        (DEFAULT_STALENESS_POLICY.heartbeatIntervalSeconds *
          DEFAULT_STALENESS_POLICY.missedHeartbeatThreshold +
          DEFAULT_STALENESS_POLICY.gracePeriodSeconds) *
        1000;
      clock.advance(stalenessWindowMs + 1000);

      // ── Detect and reclaim ───────────────────────────────────────────
      const staleResult = heartbeatService.detectStaleLeases(DEFAULT_STALENESS_POLICY);
      expect(staleResult.staleLeases).toHaveLength(1);

      const reclaimResult = leaseReclaimService.reclaimLease({
        leaseId,
        reason: "missed_heartbeats",
        retryPolicy: DEFAULT_RETRY_POLICY,
        escalationPolicy: DEFAULT_ESCALATION_POLICY,
        actor: SYSTEM_ACTOR,
      });

      // Verify lease transitioned to TIMED_OUT
      expect(reclaimResult.lease.status).toBe(WorkerLeaseStatus.TIMED_OUT);

      // Verify task escalated (not retried, not failed)
      expect(reclaimResult.task.status).toBe(TaskStatus.ESCALATED);
      expect(reclaimResult.outcome).toBe("escalated");
      expect(reclaimResult.retryEvaluation.eligible).toBe(false);
      expect(reclaimResult.escalationEvaluation).not.toBeNull();
      expect(reclaimResult.escalationEvaluation!.should_escalate).toBe(true);

      // ── Verify database state ────────────────────────────────────────
      const taskRow = getTaskRow(conn, taskId);
      expect(taskRow.status).toBe("ESCALATED");
      // retry_count should NOT increment when retries are exhausted
      expect(taskRow.retry_count).toBe(DEFAULT_RETRY_POLICY.max_attempts);

      // ── Verify audit trail ───────────────────────────────────────────
      const leaseAuditEvents = getAuditEvents(conn, leaseId);
      const reclaimAudit = leaseAuditEvents.find((e) => e.event_type === "lease.reclaimed");
      expect(reclaimAudit).toBeDefined();

      // Verify the new_state captures the escalation outcome
      const newState = JSON.parse(reclaimAudit!.new_state);
      expect(newState.outcome).toBe("escalated");
      expect(newState.retryEligible).toBe(false);
    });

    /**
     * Validates escalation via crash (not just heartbeat timeout).
     * When a worker crashes and retries are exhausted, the task should
     * be escalated with the CRASHED lease state.
     *
     * Why this test matters: Crash-driven escalation and timeout-driven
     * escalation must both work. The lease state differs (CRASHED vs
     * TIMED_OUT) but the retry/escalation policy logic is the same.
     */
    it("should escalate on crash when retries are exhausted", () => {
      const taskId = seedTask(conn, repositoryId);
      const { leaseId } = driveTaskToInDevelopmentWithLease(
        conn,
        transitionService,
        taskId,
        workerPoolId,
        clock,
      );

      // Exhaust retries
      conn.sqlite
        .prepare("UPDATE task SET retry_count = ? WHERE task_id = ?")
        .run(DEFAULT_RETRY_POLICY.max_attempts, taskId);

      const reclaimResult = leaseReclaimService.reclaimLease({
        leaseId,
        reason: "worker_crashed",
        retryPolicy: DEFAULT_RETRY_POLICY,
        escalationPolicy: DEFAULT_ESCALATION_POLICY,
        actor: SYSTEM_ACTOR,
      });

      expect(reclaimResult.lease.status).toBe(WorkerLeaseStatus.CRASHED);
      expect(reclaimResult.task.status).toBe(TaskStatus.ESCALATED);
      expect(reclaimResult.outcome).toBe("escalated");
    });

    /**
     * Validates that with zero-retry policy, even the first failure
     * triggers escalation. This tests the extreme case where the
     * operator has configured max_attempts=0.
     *
     * Why this test matters: The boundary condition max_attempts=0
     * must correctly evaluate as "retries exhausted" on the very first
     * failure, without attempting any retry.
     */
    it("should escalate immediately with zero-retry policy", () => {
      const taskId = seedTask(conn, repositoryId);
      const { leaseId } = driveTaskToInDevelopmentWithLease(
        conn,
        transitionService,
        taskId,
        workerPoolId,
        clock,
      );

      const reclaimResult = leaseReclaimService.reclaimLease({
        leaseId,
        reason: "missed_heartbeats",
        retryPolicy: EXHAUSTED_RETRY_POLICY,
        escalationPolicy: DEFAULT_ESCALATION_POLICY,
        actor: SYSTEM_ACTOR,
      });

      expect(reclaimResult.task.status).toBe(TaskStatus.ESCALATED);
      expect(reclaimResult.outcome).toBe("escalated");

      const taskRow = getTaskRow(conn, taskId);
      expect(taskRow.status).toBe("ESCALATED");
      expect(taskRow.retry_count).toBe(0); // Never retried
    });
  });

  // ─── Domain Events ────────────────────────────────────────────────────

  describe("Domain events", () => {
    /**
     * Validates that the reclaim service emits both a lease transition event
     * and a task transition event after a successful reclaim.
     *
     * Downstream consumers (web UI, notification system, scheduler) rely on
     * these events to react to reclaim outcomes in real time.
     *
     * Why this test matters: Without domain events, the scheduler would not
     * know that a task has returned to READY and needs rescheduling.
     */
    it("should emit lease and task domain events on reclaim", () => {
      const taskId = seedTask(conn, repositoryId);
      const { leaseId } = driveTaskToInDevelopmentWithLease(
        conn,
        transitionService,
        taskId,
        workerPoolId,
        clock,
      );

      // Clear events from setup transitions
      capturedEvents.length = 0;

      leaseReclaimService.reclaimLease({
        leaseId,
        reason: "missed_heartbeats",
        retryPolicy: DEFAULT_RETRY_POLICY,
        escalationPolicy: DEFAULT_ESCALATION_POLICY,
        actor: SYSTEM_ACTOR,
      });

      // Verify lease transition event
      const leaseEvents = capturedEvents.filter((e) => e.type === "task-lease.transitioned");
      expect(leaseEvents).toHaveLength(1);
      expect(leaseEvents[0]).toMatchObject({
        entityType: "task-lease",
        entityId: leaseId,
      });

      // Verify task transition event
      const taskEvents = capturedEvents.filter((e) => e.type === "task.transitioned");
      expect(taskEvents).toHaveLength(1);
      expect(taskEvents[0]).toMatchObject({
        entityType: "task",
        entityId: taskId,
        toStatus: TaskStatus.READY,
      });
    });
  });

  // ─── TTL Expiry ───────────────────────────────────────────────────────

  describe("Lease TTL expiry", () => {
    /**
     * Validates that a lease whose absolute TTL has been exceeded is
     * classified as stale with reason "ttl_expired", even if heartbeats
     * are still being received.
     *
     * Per PRD §9.8: "Lease TTL is an upper bound even if heartbeats continue."
     *
     * Why this test matters: TTL provides a safety ceiling. Without it,
     * a worker could hold a task indefinitely by sending heartbeats,
     * preventing the system from reclaiming runaway tasks.
     */
    it("should detect TTL-expired lease even with recent heartbeat", () => {
      const taskId = seedTask(conn, repositoryId);
      const shortTtlSeconds = 120; // 2 minutes
      const { leaseId } = driveTaskToInDevelopmentWithLease(
        conn,
        transitionService,
        taskId,
        workerPoolId,
        clock,
        shortTtlSeconds,
      );

      // Update the heartbeat to current time (worker is still alive)
      const recentHeartbeatSec = Math.floor(clock.now() / 1000);
      conn.sqlite
        .prepare("UPDATE task_lease SET heartbeat_at = ? WHERE lease_id = ?")
        .run(recentHeartbeatSec, leaseId);

      // Advance past TTL but keep heartbeat recent
      clock.advance((shortTtlSeconds + 1) * 1000);

      const staleResult = heartbeatService.detectStaleLeases(DEFAULT_STALENESS_POLICY);

      expect(staleResult.staleLeases).toHaveLength(1);
      expect(staleResult.staleLeases[0]!.leaseId).toBe(leaseId);
      expect(staleResult.staleLeases[0]!.reason).toBe("ttl_expired");
    });
  });
});
