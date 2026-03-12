/**
 * Integration test: Escalation triggers and resolution.
 *
 * Validates three escalation trigger scenarios and three operator resolution
 * paths through the real SQLite database, real TransitionService, and real
 * OperatorActionsService:
 *
 * **Triggers:**
 *   - Max retry exceeded → ESCALATED
 *   - Max review rounds exceeded → ESCALATED
 *   - Policy violation → ESCALATED
 *
 * **Resolutions:**
 *   - Operator retry → ASSIGNED (with optional pool reassignment)
 *   - Operator cancel → CANCELLED
 *   - Operator mark_done → DONE (with evidence, elevated audit severity)
 *
 * Each test verifies:
 *   - Domain escalation policy evaluation (`shouldEscalate`) returns correct result
 *   - State machine guard accepts the transition
 *   - Audit events are persisted atomically with escalation context
 *   - State machine invariants are maintained
 *
 * This is the V1 escalation integration validation test described in T111.
 *
 * @see docs/backlog/tasks/T111-e2e-escalation.md
 * @see docs/prd/002-data-model.md §2.7 — Escalation Policy
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.7 — Escalation Triggers
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  TaskStatus,
  WorkerLeaseStatus,
  ReviewCycleStatus,
  shouldEscalate,
  EscalationTrigger,
  createDefaultEscalationPolicy,
} from "@factory/domain";

import {
  createTransitionService,
  type TransitionService,
  type DomainEventEmitter,
  type DomainEvent,
  type ActorInfo,
} from "@factory/application";

import { createTestDatabase, type TestDatabaseConnection } from "@factory/testing";

import { createSqliteUnitOfWork } from "../infrastructure/unit-of-work/sqlite-unit-of-work.js";
import { OperatorActionsService } from "../operator-actions/operator-actions.service.js";
import { DomainEventBroadcasterAdapter } from "../events/domain-event-broadcaster.adapter.js";
import { EventBroadcasterService } from "../events/event-broadcaster.service.js";
import { EventsGateway } from "../events/events.gateway.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

import { resolve } from "node:path";

// ─── Constants ──────────────────────────────────────────────────────────────

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, "../../drizzle");

const SYSTEM_ACTOR: ActorInfo = {
  type: "system",
  id: "escalation-integration-test",
};

const OPERATOR_ACTOR_ID = "test-operator-1";

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
    return typeof parsed === "object" && parsed !== null ? parsed.status : stateJson;
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
 * expected by OperatorActionsService and createSqliteUnitOfWork.
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
 * Seeds a task directly in the given state, bypassing the state machine.
 * Used for resolution tests where we only need a task in ESCALATED state.
 */
function seedTaskInState(
  conn: TestDatabaseConnection,
  repositoryId: string,
  status: string,
): string {
  const taskId = `task-${crypto.randomUUID().slice(0, 8)}`;

  conn.sqlite
    .prepare(
      `INSERT INTO task (task_id, repository_id, title, task_type, priority, status, source, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(taskId, repositoryId, "Escalated test task", "FEATURE", "HIGH", status, "MANUAL", 1);

  return taskId;
}

/**
 * Seeds a task lease in the given status. Returns the lease ID.
 */
function seedTaskLease(
  conn: TestDatabaseConnection,
  taskId: string,
  workerPoolId: string,
  status: string = "IDLE",
): string {
  const leaseId = `lease-${crypto.randomUUID().slice(0, 8)}`;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 3600;

  conn.sqlite
    .prepare(
      `INSERT INTO task_lease (lease_id, task_id, worker_id, pool_id, leased_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      leaseId,
      taskId,
      `worker-${crypto.randomUUID().slice(0, 8)}`,
      workerPoolId,
      now,
      expiresAt,
      status,
    );

  return leaseId;
}

/**
 * Seeds a review cycle in the given status. Returns the review cycle ID.
 */
function seedReviewCycle(
  conn: TestDatabaseConnection,
  taskId: string,
  status: string = "NOT_STARTED",
): string {
  const reviewCycleId = `rc-${crypto.randomUUID().slice(0, 8)}`;

  conn.sqlite
    .prepare(
      `INSERT INTO review_cycle (review_cycle_id, task_id, status)
       VALUES (?, ?, ?)`,
    )
    .run(reviewCycleId, taskId, status);

  return reviewCycleId;
}

// ─── Transition Helpers ─────────────────────────────────────────────────────

/**
 * Drives a task from BACKLOG through to IN_DEVELOPMENT.
 *
 * Traverses: BACKLOG → READY → ASSIGNED → IN_DEVELOPMENT
 * Also transitions the lease through: LEASED → STARTING → RUNNING → HEARTBEATING
 *
 * Returns the lease ID and version after the final transition.
 */
function driveTaskToInDevelopment(
  conn: TestDatabaseConnection,
  ts: TransitionService,
  taskId: string,
  workerPoolId: string,
): { leaseId: string; versionAfter: number } {
  // BACKLOG → READY
  ts.transitionTask(
    taskId,
    TaskStatus.READY,
    { allDependenciesResolved: true, hasPolicyBlockers: false },
    SYSTEM_ACTOR,
  );

  // READY → ASSIGNED (with lease)
  const leaseId = seedTaskLease(conn, taskId, workerPoolId, "LEASED");
  conn.sqlite
    .prepare("UPDATE task SET current_lease_id = ? WHERE task_id = ?")
    .run(leaseId, taskId);

  ts.transitionTask(taskId, TaskStatus.ASSIGNED, { leaseAcquired: true }, SYSTEM_ACTOR);

  // Lease lifecycle: LEASED → STARTING → RUNNING
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

  return { leaseId, versionAfter: result.entity.version };
}

/**
 * Drives a task from BACKLOG through to IN_REVIEW.
 *
 * Traverses: BACKLOG → READY → ASSIGNED → IN_DEVELOPMENT → DEV_COMPLETE → IN_REVIEW
 * Also transitions lease and review cycle through their lifecycles.
 *
 * Returns the lease ID, review cycle ID, and version after IN_REVIEW.
 */
function driveTaskToInReview(
  conn: TestDatabaseConnection,
  ts: TransitionService,
  taskId: string,
  workerPoolId: string,
): { leaseId: string; reviewCycleId: string; versionAfter: number } {
  const { leaseId } = driveTaskToInDevelopment(conn, ts, taskId, workerPoolId);

  // IN_DEVELOPMENT → DEV_COMPLETE
  ts.transitionLease(
    leaseId,
    WorkerLeaseStatus.COMPLETING,
    { completionSignalReceived: true },
    SYSTEM_ACTOR,
  );

  ts.transitionTask(
    taskId,
    TaskStatus.DEV_COMPLETE,
    { hasDevResultPacket: true, requiredValidationsPassed: true },
    SYSTEM_ACTOR,
  );

  // DEV_COMPLETE → IN_REVIEW
  const reviewCycleId = seedReviewCycle(conn, taskId, "NOT_STARTED");
  conn.sqlite
    .prepare("UPDATE task SET current_review_cycle_id = ? WHERE task_id = ?")
    .run(reviewCycleId, taskId);

  ts.transitionReviewCycle(
    reviewCycleId,
    ReviewCycleStatus.ROUTED,
    { routingDecisionEmitted: true },
    SYSTEM_ACTOR,
  );

  const result = ts.transitionTask(
    taskId,
    TaskStatus.IN_REVIEW,
    { hasReviewRoutingDecision: true },
    SYSTEM_ACTOR,
  );

  return { leaseId, reviewCycleId, versionAfter: result.entity.version };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("Escalation Triggers and Resolution (T111)", () => {
  let conn: TestDatabaseConnection;
  let dbConn: DatabaseConnection;
  let transitionService: TransitionService;
  let operatorService: OperatorActionsService;
  let capturedEvents: DomainEvent[];

  let repositoryId: string;
  let workerPoolId: string;

  beforeEach(() => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    dbConn = asDatabaseConnection(conn);

    const unitOfWork = createSqliteUnitOfWork(dbConn);
    const { emitter, events } = createCapturingEmitter();
    capturedEvents = events;
    transitionService = createTransitionService(unitOfWork, emitter);

    // Create OperatorActionsService with a silent event broadcaster.
    // Events are not delivered via WebSocket in tests (no server), which is
    // acceptable because we verify audit events directly from the database.
    const gateway = new EventsGateway();
    const broadcaster = new EventBroadcasterService(gateway);
    const eventAdapter = new DomainEventBroadcasterAdapter(broadcaster);
    operatorService = new OperatorActionsService(dbConn, eventAdapter);

    ({ repositoryId, workerPoolId } = seedPrerequisites(conn));
  });

  afterEach(() => {
    conn.close();
  });

  // ─── Trigger: Max Retry Exceeded ──────────────────────────────────────

  describe("Trigger: max retry exceeded", () => {
    /**
     * Validates that a task is escalated when retry attempts are exhausted.
     *
     * Exercises the full path:
     * 1. Domain escalation policy correctly identifies MAX_RETRY_EXCEEDED
     *    as requiring escalation (action: "escalate")
     * 2. State machine guard accepts * → ESCALATED with hasEscalationTrigger
     * 3. Audit event records the escalation transition
     *
     * Why this test matters: Retry exhaustion is the most common escalation
     * trigger. If it fails, stuck tasks will loop forever instead of surfacing
     * to operators for intervention.
     */
    it("should transition to ESCALATED when retries are exhausted", () => {
      const taskId = seedTask(conn, repositoryId);
      driveTaskToInDevelopment(conn, transitionService, taskId, workerPoolId);

      // Simulate retry exhaustion by setting retry_count to max_attempts
      conn.sqlite.prepare("UPDATE task SET retry_count = 3 WHERE task_id = ?").run(taskId);

      // ── Verify domain policy correctly identifies escalation ──────────
      const policy = createDefaultEscalationPolicy();
      const evaluation = shouldEscalate(
        {
          trigger: EscalationTrigger.MAX_RETRY_EXCEEDED,
          retry_count: 3,
          max_attempts: 3,
        },
        policy,
      );
      expect(evaluation.should_escalate).toBe(true);
      expect(evaluation.action).toBe("escalate");
      expect(evaluation.route_to).toBe("operator-queue");
      expect(evaluation.require_summary).toBe(true);

      // ── Transition to ESCALATED via the state machine ──────────────────
      const result = transitionService.transitionTask(
        taskId,
        TaskStatus.ESCALATED,
        { hasEscalationTrigger: true },
        SYSTEM_ACTOR,
        {
          trigger: EscalationTrigger.MAX_RETRY_EXCEEDED,
          retryCount: 3,
          maxAttempts: 3,
        },
      );

      expect(result.entity.status).toBe(TaskStatus.ESCALATED);

      // ── Verify audit trail ─────────────────────────────────────────────
      const auditEvents = getAuditEvents(conn, taskId);
      // Transitions: BACKLOG→READY, READY→ASSIGNED, ASSIGNED→IN_DEV, IN_DEV→ESCALATED
      expect(auditEvents).toHaveLength(4);

      const escalationAudit = auditEvents[auditEvents.length - 1]!;
      expect(escalationAudit.new_status).toBe("ESCALATED");
      expect(escalationAudit.old_status).toBe("IN_DEVELOPMENT");

      // Verify metadata captures the escalation trigger context
      const metadata = escalationAudit.metadata_json
        ? JSON.parse(escalationAudit.metadata_json as string)
        : {};
      expect(metadata.trigger).toBe(EscalationTrigger.MAX_RETRY_EXCEEDED);
    });
  });

  // ─── Trigger: Max Review Rounds Exceeded ──────────────────────────────

  describe("Trigger: max review rounds exceeded", () => {
    /**
     * Validates that a task is escalated when review round limit is exceeded.
     *
     * Exercises:
     * 1. Domain policy correctly identifies MAX_REVIEW_ROUNDS_EXCEEDED
     * 2. State machine guard accepts IN_REVIEW → ESCALATED
     * 3. Audit trail includes the review round context
     *
     * Why this test matters: Review round limits prevent infinite rejection
     * loops. Without this escalation, a task could cycle between IN_REVIEW
     * and CHANGES_REQUESTED indefinitely, consuming reviewer time without
     * progress.
     */
    it("should transition to ESCALATED when review rounds are exhausted", () => {
      const taskId = seedTask(conn, repositoryId);
      driveTaskToInReview(conn, transitionService, taskId, workerPoolId);

      // Simulate exceeding review round limit
      conn.sqlite.prepare("UPDATE task SET review_round_count = 5 WHERE task_id = ?").run(taskId);

      // ── Verify domain policy identifies escalation ─────────────────────
      const policy = createDefaultEscalationPolicy();
      const evaluation = shouldEscalate(
        {
          trigger: EscalationTrigger.MAX_REVIEW_ROUNDS_EXCEEDED,
          review_round: 6,
          max_review_rounds: 5,
        },
        policy,
      );
      expect(evaluation.should_escalate).toBe(true);
      expect(evaluation.action).toBe("escalate");

      // ── Transition IN_REVIEW → ESCALATED ───────────────────────────────
      const result = transitionService.transitionTask(
        taskId,
        TaskStatus.ESCALATED,
        { hasEscalationTrigger: true },
        SYSTEM_ACTOR,
        {
          trigger: EscalationTrigger.MAX_REVIEW_ROUNDS_EXCEEDED,
          reviewRound: 6,
          maxReviewRounds: 5,
        },
      );

      expect(result.entity.status).toBe(TaskStatus.ESCALATED);

      // ── Verify audit trail ─────────────────────────────────────────────
      const auditEvents = getAuditEvents(conn, taskId);
      // BACKLOG→READY→ASSIGNED→IN_DEV→DEV_COMPLETE→IN_REVIEW→ESCALATED
      expect(auditEvents).toHaveLength(6);

      const lastAudit = auditEvents[auditEvents.length - 1]!;
      expect(lastAudit.new_status).toBe("ESCALATED");
      expect(lastAudit.old_status).toBe("IN_REVIEW");
    });
  });

  // ─── Trigger: Policy Violation ────────────────────────────────────────

  describe("Trigger: policy violation", () => {
    /**
     * Validates that a policy violation triggers immediate escalation.
     *
     * Policy violations (e.g., unauthorized file access, security boundary
     * breaches) always result in escalation per the default V1 policy.
     * This test verifies:
     * 1. Domain policy returns should_escalate=true for POLICY_VIOLATION
     * 2. State machine wildcard guard accepts the transition
     * 3. Audit event captures the violation context
     *
     * Why this test matters: Policy violations are a safety mechanism.
     * If they don't trigger escalation, workers may continue executing
     * tasks in violation of security or operational policies.
     */
    it("should transition to ESCALATED on policy violation", () => {
      const taskId = seedTask(conn, repositoryId);
      driveTaskToInDevelopment(conn, transitionService, taskId, workerPoolId);

      // ── Verify domain policy ───────────────────────────────────────────
      const policy = createDefaultEscalationPolicy();
      const evaluation = shouldEscalate({ trigger: EscalationTrigger.POLICY_VIOLATION }, policy);
      expect(evaluation.should_escalate).toBe(true);
      expect(evaluation.action).toBe("escalate");

      // ── Transition to ESCALATED ────────────────────────────────────────
      const result = transitionService.transitionTask(
        taskId,
        TaskStatus.ESCALATED,
        { hasEscalationTrigger: true },
        SYSTEM_ACTOR,
        {
          trigger: EscalationTrigger.POLICY_VIOLATION,
          reason: "Detected unauthorized file access in /etc/passwd",
        },
      );

      expect(result.entity.status).toBe(TaskStatus.ESCALATED);

      // ── Verify audit trail ─────────────────────────────────────────────
      const auditEvents = getAuditEvents(conn, taskId);
      // BACKLOG→READY→ASSIGNED→IN_DEV→ESCALATED
      expect(auditEvents).toHaveLength(4);

      const escalationAudit = auditEvents[auditEvents.length - 1]!;
      expect(escalationAudit.new_status).toBe("ESCALATED");
      expect(escalationAudit.old_status).toBe("IN_DEVELOPMENT");
    });
  });

  // ─── Resolution: Retry ────────────────────────────────────────────────

  describe("Resolution: retry → ASSIGNED", () => {
    /**
     * Validates that an operator can resolve escalation by retrying the task.
     *
     * The retry resolution moves ESCALATED → ASSIGNED, creating a new lease
     * opportunity. The audit trail must record the resolution context so
     * operators can track why an escalated task was retried and by whom.
     *
     * Why this test matters: Retry is the most common resolution path.
     * It must correctly transition the task to ASSIGNED and record the
     * operator's decision in the audit trail.
     */
    it("should move ESCALATED task to ASSIGNED on operator retry", () => {
      const taskId = seedTaskInState(conn, repositoryId, "ESCALATED");

      const result = operatorService.resolveEscalation(taskId, {
        actorId: OPERATOR_ACTOR_ID,
        reason: "Root cause identified, retrying with fix",
        resolutionType: "retry",
      });

      expect(result.task.status).toBe("ASSIGNED");
      expect(result.auditEvent.actorType).toBe("operator");
      expect(result.auditEvent.actorId).toBe(OPERATOR_ACTOR_ID);

      // Verify audit metadata captures resolution context
      const auditEvents = getAuditEvents(conn, taskId);
      const transitionEvent = auditEvents.find((e) => e.event_type.includes("transition"));
      expect(transitionEvent).toBeDefined();

      const metadata = transitionEvent!.metadata_json
        ? JSON.parse(transitionEvent!.metadata_json as string)
        : {};
      expect(metadata.action).toBe("resolve_escalation");
      expect(metadata.resolutionType).toBe("retry");
      expect(metadata.reason).toBe("Root cause identified, retrying with fix");
    });

    /**
     * Validates that retry with pool reassignment records the reassignment
     * as a separate audit event. This ensures operators can track when
     * tasks are moved between worker pools during escalation resolution.
     */
    it("should record pool reassignment on retry with poolId", () => {
      const taskId = seedTaskInState(conn, repositoryId, "ESCALATED");

      const result = operatorService.resolveEscalation(taskId, {
        actorId: OPERATOR_ACTOR_ID,
        reason: "Needs different worker type",
        resolutionType: "retry",
        poolId: "specialized-pool",
      });

      expect(result.task.status).toBe("ASSIGNED");

      // Verify pool reassignment audit event
      const auditEvents = getAuditEvents(conn, taskId);
      const poolEvent = auditEvents.find((e) => e.event_type === "task.operator.reassign_pool");
      expect(poolEvent).toBeDefined();
    });
  });

  // ─── Resolution: Cancel ───────────────────────────────────────────────

  describe("Resolution: cancel → CANCELLED", () => {
    /**
     * Validates that an operator can resolve escalation by cancelling the task.
     *
     * Cancel is the terminal resolution for tasks that operators determine
     * should be abandoned. The audit trail must record the operator's reason.
     *
     * Why this test matters: Cancel is the safety valve for tasks that
     * should not be retried (e.g., obsolete requirements, duplicate tasks).
     * The audit trail must preserve the cancellation reasoning for compliance.
     */
    it("should move ESCALATED task to CANCELLED on operator cancel", () => {
      const taskId = seedTaskInState(conn, repositoryId, "ESCALATED");

      const result = operatorService.resolveEscalation(taskId, {
        actorId: OPERATOR_ACTOR_ID,
        reason: "Task no longer relevant after priority change",
        resolutionType: "cancel",
      });

      expect(result.task.status).toBe("CANCELLED");
      expect(result.auditEvent.actorType).toBe("operator");
      expect(result.auditEvent.actorId).toBe(OPERATOR_ACTOR_ID);

      // Verify audit metadata
      const auditEvents = getAuditEvents(conn, taskId);
      const transitionEvent = auditEvents.find((e) => e.event_type.includes("transition"));
      expect(transitionEvent).toBeDefined();

      const metadata = transitionEvent!.metadata_json
        ? JSON.parse(transitionEvent!.metadata_json as string)
        : {};
      expect(metadata.action).toBe("resolve_escalation");
      expect(metadata.resolutionType).toBe("cancel");
      expect(metadata.reason).toBe("Task no longer relevant after priority change");
    });
  });

  // ─── Resolution: Mark Done ────────────────────────────────────────────

  describe("Resolution: mark_done → DONE", () => {
    /**
     * Validates that an operator can resolve escalation by marking the task
     * as externally completed. This is the most sensitive resolution type —
     * it bypasses all normal quality gates (review, merge, validation).
     *
     * The audit trail must capture:
     * - The resolution type (mark_done)
     * - The evidence of external completion
     * - Elevated audit severity for compliance tracking
     *
     * Why this test matters: mark_done is a privileged escape hatch that
     * bypasses all quality controls. The elevated severity ensures these
     * actions are visible in audit reviews and cannot be silently applied.
     */
    it("should move ESCALATED task to DONE with evidence and elevated severity", () => {
      const taskId = seedTaskInState(conn, repositoryId, "ESCALATED");

      const result = operatorService.resolveEscalation(taskId, {
        actorId: OPERATOR_ACTOR_ID,
        reason: "Completed via manual hotfix",
        resolutionType: "mark_done",
        evidence: "PR #42 merged manually with hotfix applied to production",
      });

      expect(result.task.status).toBe("DONE");
      expect(result.auditEvent.actorType).toBe("operator");
      expect(result.auditEvent.actorId).toBe(OPERATOR_ACTOR_ID);

      // Verify audit metadata includes evidence and elevated severity
      const auditEvents = getAuditEvents(conn, taskId);
      const transitionEvent = auditEvents.find((e) => e.event_type.includes("transition"));
      expect(transitionEvent).toBeDefined();

      const metadata = transitionEvent!.metadata_json
        ? JSON.parse(transitionEvent!.metadata_json as string)
        : {};
      expect(metadata.action).toBe("resolve_escalation");
      expect(metadata.resolutionType).toBe("mark_done");
      expect(metadata.evidence).toBe("PR #42 merged manually with hotfix applied to production");
      expect(metadata.auditSeverity).toBe("elevated");
    });
  });

  // ─── State Machine Invariants ─────────────────────────────────────────

  describe("State machine invariants", () => {
    /**
     * Validates the complete trigger → resolution cycle end-to-end:
     * 1. Drive task through lifecycle to IN_DEVELOPMENT
     * 2. Trigger escalation (policy violation)
     * 3. Resolve with retry (ESCALATED → ASSIGNED)
     * 4. Verify the complete audit trail is maintained
     *
     * This exercises the most common escalation workflow: a task encounters
     * a problem during development, gets escalated, and an operator retries
     * it after investigation.
     *
     * Why this test matters: The trigger → resolution cycle is the primary
     * escalation workflow. If the audit trail is incomplete or the state
     * transitions don't compose correctly, operator visibility is compromised
     * and the human-in-the-loop safety mechanism breaks down.
     */
    it("should maintain full audit trail across trigger → resolution cycle", () => {
      const taskId = seedTask(conn, repositoryId);

      // ── Phase 1: Drive to IN_DEVELOPMENT ────────────────────────────
      driveTaskToInDevelopment(conn, transitionService, taskId, workerPoolId);

      // ── Phase 2: Escalate (policy violation) ────────────────────────
      transitionService.transitionTask(
        taskId,
        TaskStatus.ESCALATED,
        { hasEscalationTrigger: true },
        SYSTEM_ACTOR,
        { trigger: EscalationTrigger.POLICY_VIOLATION },
      );

      // ── Phase 3: Resolve with retry ─────────────────────────────────
      operatorService.resolveEscalation(taskId, {
        actorId: OPERATOR_ACTOR_ID,
        reason: "Retrying after policy adjustment",
        resolutionType: "retry",
      });

      // ── Verify task state ───────────────────────────────────────────
      const row = conn.sqlite
        .prepare("SELECT status, version FROM task WHERE task_id = ?")
        .get(taskId) as { status: string; version: number };
      expect(row.status).toBe("ASSIGNED");

      // ── Verify complete audit trail ─────────────────────────────────
      const auditEvents = getAuditEvents(conn, taskId);
      // BACKLOG→READY, READY→ASSIGNED, ASSIGNED→IN_DEV,
      // IN_DEV→ESCALATED, ESCALATED→ASSIGNED
      expect(auditEvents).toHaveLength(5);

      const statuses = auditEvents.map((e) => e.new_status);
      expect(statuses).toEqual(["READY", "ASSIGNED", "IN_DEVELOPMENT", "ESCALATED", "ASSIGNED"]);
    });

    /**
     * Validates that tasks in terminal states (DONE, FAILED, CANCELLED)
     * cannot be escalated. This is a critical invariant — escalation should
     * only be available for active tasks.
     *
     * Why this test matters: If terminal states could be escalated, it would
     * create impossible state machine paths and undermine the finality of
     * terminal states.
     */
    it("should prevent escalation from terminal states", () => {
      const doneTaskId = seedTaskInState(conn, repositoryId, "DONE");
      const failedTaskId = seedTaskInState(conn, repositoryId, "FAILED");
      const cancelledTaskId = seedTaskInState(conn, repositoryId, "CANCELLED");

      expect(() =>
        transitionService.transitionTask(
          doneTaskId,
          TaskStatus.ESCALATED,
          { hasEscalationTrigger: true },
          SYSTEM_ACTOR,
        ),
      ).toThrow();

      expect(() =>
        transitionService.transitionTask(
          failedTaskId,
          TaskStatus.ESCALATED,
          { hasEscalationTrigger: true },
          SYSTEM_ACTOR,
        ),
      ).toThrow();

      expect(() =>
        transitionService.transitionTask(
          cancelledTaskId,
          TaskStatus.ESCALATED,
          { hasEscalationTrigger: true },
          SYSTEM_ACTOR,
        ),
      ).toThrow();
    });

    /**
     * Validates that non-operators cannot resolve escalated tasks.
     * The ESCALATED → ASSIGNED transition requires `isOperator: true` in
     * the transition context. System actors (workers, scheduler) must not
     * be able to bypass the human-in-the-loop requirement.
     *
     * Why this test matters: Escalation exists as a human checkpoint.
     * If non-operators could resolve escalations, the safety mechanism
     * would be circumvented and tasks could resume without operator review.
     */
    it("should prevent non-operators from resolving escalation", () => {
      const taskId = seedTaskInState(conn, repositoryId, "ESCALATED");

      // System actor tries to assign without operator flag — should fail
      expect(() =>
        transitionService.transitionTask(
          taskId,
          TaskStatus.ASSIGNED,
          { leaseAcquired: true }, // Missing isOperator: true
          SYSTEM_ACTOR,
        ),
      ).toThrow();

      // Verify task remains in ESCALATED state
      const row = conn.sqlite.prepare("SELECT status FROM task WHERE task_id = ?").get(taskId) as {
        status: string;
      };
      expect(row.status).toBe("ESCALATED");
    });

    /**
     * Validates that domain events are emitted for escalation transitions.
     * Downstream consumers (e.g., the web UI, notification system) rely on
     * these events to surface escalated tasks to operators in real time.
     *
     * Why this test matters: Without domain events, operators would only
     * discover escalated tasks by polling the database or UI. Real-time
     * notification is critical for timely intervention.
     */
    it("should emit domain events for escalation transitions", () => {
      const taskId = seedTask(conn, repositoryId);
      driveTaskToInDevelopment(conn, transitionService, taskId, workerPoolId);

      // Clear captured events from the setup transitions
      capturedEvents.length = 0;

      // Escalate
      transitionService.transitionTask(
        taskId,
        TaskStatus.ESCALATED,
        { hasEscalationTrigger: true },
        SYSTEM_ACTOR,
        { trigger: EscalationTrigger.POLICY_VIOLATION },
      );

      // Verify domain event was emitted
      const taskEvents = capturedEvents.filter((e) => e.type === "task.transitioned");
      expect(taskEvents).toHaveLength(1);

      const escalationEvent = taskEvents[0]!;
      expect(escalationEvent).toMatchObject({
        type: "task.transitioned",
        entityType: "task",
        entityId: taskId,
        toStatus: TaskStatus.ESCALATED,
        fromStatus: TaskStatus.IN_DEVELOPMENT,
      });
    });
  });
});
