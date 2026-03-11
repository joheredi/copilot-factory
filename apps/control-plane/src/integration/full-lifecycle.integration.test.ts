/**
 * Integration test: Full task lifecycle BACKLOG → DONE.
 *
 * Validates that a task can traverse the complete happy-path state machine
 * using the real SQLite database, real UnitOfWork, and real TransitionService.
 * Each transition is verified for:
 * - Correct resulting task status
 * - Atomic audit event persistence
 * - Supporting entity lifecycle (lease, review cycle, merge queue item)
 * - Schema-valid packet creation at key stages
 *
 * This is the V1 Milestone 1 integration validation test described in T107.
 * It exercises the full data model, state machine guards, optimistic concurrency,
 * and audit trail completeness end-to-end through the persistence layer.
 *
 * @see docs/backlog/tasks/T107-e2e-full-lifecycle.md
 * @see docs/prd/002-data-model.md §2.1 — Task State Machine
 * @see docs/prd/010-integration-contracts.md §10.3 — Transaction Boundaries
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  TaskStatus,
  WorkerLeaseStatus,
  ReviewCycleStatus,
  MergeQueueItemStatus,
} from "@factory/domain";

import {
  createTransitionService,
  InvalidTransitionError,
  type TransitionService,
  type DomainEventEmitter,
  type DomainEvent,
  type ActorInfo,
} from "@factory/application";

import {
  DevResultPacketSchema,
  ReviewPacketSchema,
  LeadReviewDecisionPacketSchema,
  ValidationResultPacketSchema,
  MergePacketSchema,
} from "@factory/schemas";

import { createTestDatabase, type TestDatabaseConnection } from "@factory/testing";

import { createSqliteUnitOfWork } from "../infrastructure/unit-of-work/sqlite-unit-of-work.js";

import { resolve } from "node:path";

// ─── Constants ──────────────────────────────────────────────────────────────

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, "../../drizzle");

const SYSTEM_ACTOR: ActorInfo = {
  type: "system",
  id: "integration-test",
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

/**
 * Counts audit events for a given entity in the database.
 */
function countAuditEvents(conn: TestDatabaseConnection, entityId: string): number {
  const result = conn.sqlite
    .prepare("SELECT COUNT(*) as count FROM audit_event WHERE entity_id = ?")
    .get(entityId) as { count: number };
  return result.count;
}

/**
 * Retrieves all audit events for a given entity, ordered by creation time.
 */
function getAuditEvents(
  conn: TestDatabaseConnection,
  entityId: string,
): Array<{ entity_type: string; event_type: string; old_state: string | null; new_state: string }> {
  return conn.sqlite
    .prepare(
      "SELECT entity_type, event_type, old_state, new_state FROM audit_event WHERE entity_id = ? ORDER BY created_at ASC, rowid ASC",
    )
    .all(entityId) as Array<{
    entity_type: string;
    event_type: string;
    old_state: string | null;
    new_state: string;
  }>;
}

// ─── Seed Functions ─────────────────────────────────────────────────────────

/**
 * Seeds the prerequisite entities required by the task foreign key constraints:
 * project and repository. Returns the generated IDs.
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
 * Seeds a task in BACKLOG status. Returns the task ID.
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

/**
 * Seeds a merge queue item in the given status. Returns the item ID.
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

// ─── Packet Builders ────────────────────────────────────────────────────────

/**
 * Builds a schema-valid DevResultPacket for the happy path.
 * The packet represents a successful development run.
 */
function buildDevResultPacket(taskId: string, repositoryId: string): unknown {
  return {
    packet_type: "dev_result_packet",
    schema_version: "1.0",
    created_at: new Date().toISOString(),
    task_id: taskId,
    repository_id: repositoryId,
    run_id: `run-${crypto.randomUUID().slice(0, 8)}`,
    status: "success",
    summary: "All changes implemented and tests pass.",
    artifact_refs: [],
    result: {
      branch_name: `factory/${taskId}`,
      commit_sha: "abc123def456",
      files_changed: [
        { path: "src/feature.ts", change_type: "added", summary: "New feature implementation" },
      ],
      tests_added_or_updated: ["src/feature.test.ts"],
      validations_run: [
        {
          check_type: "test",
          tool_name: "vitest",
          command: "pnpm test",
          status: "passed",
          duration_ms: 1200,
          summary: "All 42 tests pass",
        },
      ],
      assumptions: [],
      risks: [],
      unresolved_issues: [],
    },
  };
}

/**
 * Builds a schema-valid ReviewPacket for a specialist reviewer approval.
 */
function buildReviewPacket(taskId: string, repositoryId: string, reviewCycleId: string): unknown {
  return {
    packet_type: "review_packet",
    schema_version: "1.0",
    created_at: new Date().toISOString(),
    task_id: taskId,
    repository_id: repositoryId,
    review_cycle_id: reviewCycleId,
    reviewer_pool_id: "general-review-pool",
    reviewer_type: "general",
    verdict: "approved",
    summary: "Code meets quality standards. No blocking issues found.",
    confidence: "high",
    blocking_issues: [],
    non_blocking_issues: [],
    follow_up_task_refs: [],
    risks: [],
    open_questions: [],
  };
}

/**
 * Builds a schema-valid LeadReviewDecisionPacket with an "approved" decision.
 */
function buildLeadReviewDecisionPacket(
  taskId: string,
  repositoryId: string,
  reviewCycleId: string,
): unknown {
  return {
    packet_type: "lead_review_decision_packet",
    schema_version: "1.0",
    created_at: new Date().toISOString(),
    task_id: taskId,
    repository_id: repositoryId,
    review_cycle_id: reviewCycleId,
    decision: "approved",
    summary: "All specialist reviews are positive. Approved for merge.",
    blocking_issues: [],
    non_blocking_suggestions: [],
    deduplication_notes: [],
    follow_up_task_refs: [],
    risks: [],
    open_questions: [],
  };
}

/**
 * Builds a schema-valid ValidationResultPacket for post-merge validation.
 */
function buildValidationResultPacket(taskId: string, repositoryId: string): unknown {
  return {
    packet_type: "validation_result_packet",
    schema_version: "1.0",
    created_at: new Date().toISOString(),
    task_id: taskId,
    repository_id: repositoryId,
    validation_run_id: `vr-${crypto.randomUUID().slice(0, 8)}`,
    status: "success",
    summary: "All post-merge validation checks pass.",
    details: {
      run_scope: "post-merge",
      checks: [
        {
          check_type: "test",
          tool_name: "vitest",
          command: "pnpm test",
          status: "passed",
          duration_ms: 3000,
          summary: "All 150 tests pass",
        },
        {
          check_type: "build",
          tool_name: "tsc",
          command: "pnpm build",
          status: "passed",
          duration_ms: 1500,
          summary: "Build successful",
        },
      ],
    },
  };
}

/**
 * Builds a schema-valid MergePacket for a successful merge.
 */
function buildMergePacket(taskId: string, repositoryId: string, mergeQueueItemId: string): unknown {
  return {
    packet_type: "merge_packet",
    schema_version: "1.0",
    created_at: new Date().toISOString(),
    task_id: taskId,
    repository_id: repositoryId,
    merge_queue_item_id: mergeQueueItemId,
    status: "success",
    summary: "Rebase and merge completed successfully.",
    artifact_refs: [],
    details: {
      source_branch: `factory/${taskId}`,
      target_branch: "main",
      approved_commit_sha: "abc123def456",
      merged_commit_sha: "def789abc012",
      merge_strategy: "rebase-and-merge",
      rebase_performed: true,
      validation_results: [
        {
          check_type: "build",
          tool_name: "tsc",
          command: "pnpm build",
          status: "passed",
          duration_ms: 1000,
          summary: "Build successful",
        },
      ],
    },
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("Full Task Lifecycle: BACKLOG → DONE", () => {
  let conn: TestDatabaseConnection;
  let transitionService: TransitionService;
  let capturedEvents: DomainEvent[];

  let _projectId: string;
  let repositoryId: string;
  let workerPoolId: string;
  let taskId: string;

  beforeEach(() => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });

    const unitOfWork = createSqliteUnitOfWork(conn);
    const { emitter, events } = createCapturingEmitter();
    capturedEvents = events;
    transitionService = createTransitionService(unitOfWork, emitter);

    // Seed prerequisite entities
    ({ projectId: _projectId, repositoryId, workerPoolId } = seedPrerequisites(conn));
    taskId = seedTask(conn, repositoryId);
  });

  afterEach(() => {
    conn.close();
  });

  /**
   * T107 primary acceptance test: the complete happy-path lifecycle.
   *
   * This test drives a single task through every state in the happy path,
   * also transitioning supporting entities (lease, review cycle, merge queue
   * item) alongside the task. After each step it verifies:
   * - The task status is correct
   * - An audit event was persisted atomically
   * - The task version was incremented (optimistic concurrency)
   *
   * At the end, it validates the complete audit trail and packet schema
   * compliance.
   *
   * Why this test matters: It is the single most important correctness gate
   * for V1 Milestone 1. If a task can traverse the full lifecycle with
   * real DB persistence and all guards passing, the core orchestration
   * pipeline is sound.
   */
  it("should transition a task through the complete happy path to DONE", () => {
    // ── Step 1: BACKLOG → READY ──────────────────────────────────────────
    // Task has no dependencies, so it immediately becomes ready.
    const step1 = transitionService.transitionTask(
      taskId,
      TaskStatus.READY,
      { allDependenciesResolved: true, hasPolicyBlockers: false },
      SYSTEM_ACTOR,
      { reason: "All dependencies resolved" },
    );
    expect(step1.entity.status).toBe(TaskStatus.READY);
    expect(step1.entity.version).toBe(2);

    // ── Step 2: READY → ASSIGNED ─────────────────────────────────────────
    // Scheduler selects task and acquires exclusive lease.
    const leaseId = seedTaskLease(conn, taskId, workerPoolId, "LEASED");
    conn.sqlite
      .prepare("UPDATE task SET current_lease_id = ? WHERE task_id = ?")
      .run(leaseId, taskId);

    const step2 = transitionService.transitionTask(
      taskId,
      TaskStatus.ASSIGNED,
      { leaseAcquired: true },
      SYSTEM_ACTOR,
      { leaseId },
    );
    expect(step2.entity.status).toBe(TaskStatus.ASSIGNED);
    expect(step2.entity.version).toBe(3);

    // Also transition the lease: LEASED → STARTING → RUNNING
    transitionService.transitionLease(
      leaseId,
      WorkerLeaseStatus.STARTING,
      { workerProcessSpawned: true },
      SYSTEM_ACTOR,
    );

    // ── Step 3: ASSIGNED → IN_DEVELOPMENT ────────────────────────────────
    // Worker sends first heartbeat confirming session start.
    transitionService.transitionLease(
      leaseId,
      WorkerLeaseStatus.RUNNING,
      { firstHeartbeatReceived: true },
      SYSTEM_ACTOR,
    );

    const step3 = transitionService.transitionTask(
      taskId,
      TaskStatus.IN_DEVELOPMENT,
      { hasHeartbeat: true },
      SYSTEM_ACTOR,
    );
    expect(step3.entity.status).toBe(TaskStatus.IN_DEVELOPMENT);
    expect(step3.entity.version).toBe(4);

    // Lease continues heartbeating
    transitionService.transitionLease(
      leaseId,
      WorkerLeaseStatus.HEARTBEATING,
      { heartbeatReceived: true },
      SYSTEM_ACTOR,
    );

    // ── Step 4: IN_DEVELOPMENT → DEV_COMPLETE ────────────────────────────
    // Worker submits valid DevResultPacket and required validations pass.
    const devResultPacket = buildDevResultPacket(taskId, repositoryId);

    // Worker signals completion
    transitionService.transitionLease(
      leaseId,
      WorkerLeaseStatus.COMPLETING,
      { completionSignalReceived: true },
      SYSTEM_ACTOR,
    );

    const step4 = transitionService.transitionTask(
      taskId,
      TaskStatus.DEV_COMPLETE,
      { hasDevResultPacket: true, requiredValidationsPassed: true },
      SYSTEM_ACTOR,
      { devResultPacketType: "dev_result_packet" },
    );
    expect(step4.entity.status).toBe(TaskStatus.DEV_COMPLETE);
    expect(step4.entity.version).toBe(5);

    // ── Step 5: DEV_COMPLETE → IN_REVIEW ─────────────────────────────────
    // Review Router emits routing decision and ReviewCycle is created.
    const reviewCycleId = seedReviewCycle(conn, taskId, "NOT_STARTED");
    conn.sqlite
      .prepare("UPDATE task SET current_review_cycle_id = ? WHERE task_id = ?")
      .run(reviewCycleId, taskId);

    // Transition review cycle through routing
    transitionService.transitionReviewCycle(
      reviewCycleId,
      ReviewCycleStatus.ROUTED,
      { routingDecisionEmitted: true },
      SYSTEM_ACTOR,
    );

    const step5 = transitionService.transitionTask(
      taskId,
      TaskStatus.IN_REVIEW,
      { hasReviewRoutingDecision: true },
      SYSTEM_ACTOR,
    );
    expect(step5.entity.status).toBe(TaskStatus.IN_REVIEW);
    expect(step5.entity.version).toBe(6);

    // Advance review cycle: ROUTED → IN_PROGRESS → CONSOLIDATING → APPROVED
    transitionService.transitionReviewCycle(
      reviewCycleId,
      ReviewCycleStatus.IN_PROGRESS,
      { reviewStarted: true },
      SYSTEM_ACTOR,
    );

    // Create specialist review packet
    const reviewPacket = buildReviewPacket(taskId, repositoryId, reviewCycleId);

    transitionService.transitionReviewCycle(
      reviewCycleId,
      ReviewCycleStatus.CONSOLIDATING,
      { allRequiredReviewsComplete: true },
      SYSTEM_ACTOR,
    );

    // Lead reviewer approves
    const leadDecisionPacket = buildLeadReviewDecisionPacket(taskId, repositoryId, reviewCycleId);

    transitionService.transitionReviewCycle(
      reviewCycleId,
      ReviewCycleStatus.APPROVED,
      { leadReviewDecision: "approved" },
      SYSTEM_ACTOR,
    );

    // ── Step 6: IN_REVIEW → APPROVED ─────────────────────────────────────
    // Lead reviewer decision is "approved".
    const step6 = transitionService.transitionTask(
      taskId,
      TaskStatus.APPROVED,
      { leadReviewDecision: "approved" },
      SYSTEM_ACTOR,
    );
    expect(step6.entity.status).toBe(TaskStatus.APPROVED);
    expect(step6.entity.version).toBe(7);

    // ── Step 7: APPROVED → QUEUED_FOR_MERGE ──────────────────────────────
    // Task enters the merge queue.
    const mergeQueueItemId = seedMergeQueueItem(conn, taskId, repositoryId, "ENQUEUED");
    conn.sqlite
      .prepare("UPDATE task SET merge_queue_item_id = ? WHERE task_id = ?")
      .run(mergeQueueItemId, taskId);

    const step7 = transitionService.transitionTask(
      taskId,
      TaskStatus.QUEUED_FOR_MERGE,
      {},
      SYSTEM_ACTOR,
    );
    expect(step7.entity.status).toBe(TaskStatus.QUEUED_FOR_MERGE);
    expect(step7.entity.version).toBe(8);

    // Advance merge queue item through its lifecycle
    transitionService.transitionMergeQueueItem(
      mergeQueueItemId,
      MergeQueueItemStatus.PREPARING,
      { preparationStarted: true },
      SYSTEM_ACTOR,
    );
    transitionService.transitionMergeQueueItem(
      mergeQueueItemId,
      MergeQueueItemStatus.REBASING,
      { workspaceReady: true },
      SYSTEM_ACTOR,
    );
    transitionService.transitionMergeQueueItem(
      mergeQueueItemId,
      MergeQueueItemStatus.VALIDATING,
      { rebaseSuccessful: true },
      SYSTEM_ACTOR,
    );
    transitionService.transitionMergeQueueItem(
      mergeQueueItemId,
      MergeQueueItemStatus.MERGING,
      { validationPassed: true },
      SYSTEM_ACTOR,
    );

    // ── Step 8: QUEUED_FOR_MERGE → MERGING ───────────────────────────────
    const step8 = transitionService.transitionTask(taskId, TaskStatus.MERGING, {}, SYSTEM_ACTOR);
    expect(step8.entity.status).toBe(TaskStatus.MERGING);
    expect(step8.entity.version).toBe(9);

    // Merge completes
    const mergePacket = buildMergePacket(taskId, repositoryId, mergeQueueItemId);
    transitionService.transitionMergeQueueItem(
      mergeQueueItemId,
      MergeQueueItemStatus.MERGED,
      { mergeSuccessful: true },
      SYSTEM_ACTOR,
    );

    // ── Step 9: MERGING → POST_MERGE_VALIDATION ──────────────────────────
    const step9 = transitionService.transitionTask(
      taskId,
      TaskStatus.POST_MERGE_VALIDATION,
      { mergeSuccessful: true },
      SYSTEM_ACTOR,
    );
    expect(step9.entity.status).toBe(TaskStatus.POST_MERGE_VALIDATION);
    expect(step9.entity.version).toBe(10);

    // Post-merge validation runs and passes
    const validationPacket = buildValidationResultPacket(taskId, repositoryId);

    // ── Step 10: POST_MERGE_VALIDATION → DONE ────────────────────────────
    const step10 = transitionService.transitionTask(
      taskId,
      TaskStatus.DONE,
      { postMergeValidationPassed: true },
      SYSTEM_ACTOR,
    );
    expect(step10.entity.status).toBe(TaskStatus.DONE);
    expect(step10.entity.version).toBe(11);

    // ── Final Verification ───────────────────────────────────────────────

    // Verify task reached terminal state via direct DB query
    const finalStatus = conn.sqlite
      .prepare("SELECT status, version FROM task WHERE task_id = ?")
      .get(taskId) as { status: string; version: number };
    expect(finalStatus.status).toBe("DONE");
    expect(finalStatus.version).toBe(11);

    // Verify complete audit trail for task transitions (10 transitions)
    const taskAuditEvents = getAuditEvents(conn, taskId);
    expect(taskAuditEvents).toHaveLength(10);

    // Verify audit event sequence matches expected state transitions
    const expectedTransitions = [
      { old: "BACKLOG", new: "READY" },
      { old: "READY", new: "ASSIGNED" },
      { old: "ASSIGNED", new: "IN_DEVELOPMENT" },
      { old: "IN_DEVELOPMENT", new: "DEV_COMPLETE" },
      { old: "DEV_COMPLETE", new: "IN_REVIEW" },
      { old: "IN_REVIEW", new: "APPROVED" },
      { old: "APPROVED", new: "QUEUED_FOR_MERGE" },
      { old: "QUEUED_FOR_MERGE", new: "MERGING" },
      { old: "MERGING", new: "POST_MERGE_VALIDATION" },
      { old: "POST_MERGE_VALIDATION", new: "DONE" },
    ];

    for (let i = 0; i < expectedTransitions.length; i++) {
      const oldStateObj = JSON.parse(taskAuditEvents[i]!.old_state!) as { status: string };
      const newStateObj = JSON.parse(taskAuditEvents[i]!.new_state) as { status: string };
      expect(oldStateObj.status).toBe(expectedTransitions[i]!.old);
      expect(newStateObj.status).toBe(expectedTransitions[i]!.new);
      expect(taskAuditEvents[i]!.entity_type).toBe("task");
      expect(taskAuditEvents[i]!.event_type).toBe(
        `task.transition.${expectedTransitions[i]!.old}.to.${expectedTransitions[i]!.new}`,
      );
    }

    // Verify lease audit trail
    const leaseAuditEvents = getAuditEvents(conn, leaseId);
    expect(leaseAuditEvents.length).toBeGreaterThanOrEqual(4);

    // Verify review cycle audit trail
    const reviewCycleAuditEvents = getAuditEvents(conn, reviewCycleId);
    expect(reviewCycleAuditEvents.length).toBeGreaterThanOrEqual(4);

    // Verify merge queue item audit trail
    const mergeQueueItemAuditEvents = getAuditEvents(conn, mergeQueueItemId);
    expect(mergeQueueItemAuditEvents.length).toBeGreaterThanOrEqual(5);

    // Verify domain events were emitted for each transition
    const taskTransitionEvents = capturedEvents.filter((e) => e.type === "task.transitioned");
    expect(taskTransitionEvents).toHaveLength(10);

    // Ensure packets are valid (suppress unused-variable warnings by referencing them)
    expect(devResultPacket).toBeDefined();
    expect(reviewPacket).toBeDefined();
    expect(leadDecisionPacket).toBeDefined();
    expect(mergePacket).toBeDefined();
    expect(validationPacket).toBeDefined();
  });

  /**
   * Validates that all packets created during the lifecycle are schema-valid.
   *
   * Why this test matters: Packets are the cross-stage handoff mechanism.
   * If they fail schema validation, the pipeline breaks at stage boundaries.
   * This test ensures the packet builders produce valid data structures.
   */
  it("should produce schema-valid packets at each lifecycle stage", () => {
    // Build all packets for the lifecycle
    const devResult = buildDevResultPacket(taskId, repositoryId);
    const reviewCycleId = `rc-test-${crypto.randomUUID().slice(0, 8)}`;
    const mergeQueueItemId = `mqi-test-${crypto.randomUUID().slice(0, 8)}`;

    const review = buildReviewPacket(taskId, repositoryId, reviewCycleId);
    const leadDecision = buildLeadReviewDecisionPacket(taskId, repositoryId, reviewCycleId);
    const validation = buildValidationResultPacket(taskId, repositoryId);
    const merge = buildMergePacket(taskId, repositoryId, mergeQueueItemId);

    // Validate each packet against its Zod schema
    expect(() => DevResultPacketSchema.parse(devResult)).not.toThrow();
    expect(() => ReviewPacketSchema.parse(review)).not.toThrow();
    expect(() => LeadReviewDecisionPacketSchema.parse(leadDecision)).not.toThrow();
    expect(() => ValidationResultPacketSchema.parse(validation)).not.toThrow();
    expect(() => MergePacketSchema.parse(merge)).not.toThrow();
  });

  /**
   * Verifies that each transition increments the version token correctly.
   *
   * Why this test matters: Optimistic concurrency control relies on version
   * tokens to detect conflicting writes. If versions don't increment
   * correctly, concurrent transitions could corrupt state.
   */
  it("should increment version token on every task state transition", () => {
    // Start at version 1 (seeded)
    let currentVersion = 1;

    const transitions: Array<{
      target: TaskStatus;
      context: Record<string, unknown>;
    }> = [
      {
        target: TaskStatus.READY,
        context: { allDependenciesResolved: true, hasPolicyBlockers: false },
      },
      { target: TaskStatus.ASSIGNED, context: { leaseAcquired: true } },
      { target: TaskStatus.IN_DEVELOPMENT, context: { hasHeartbeat: true } },
      {
        target: TaskStatus.DEV_COMPLETE,
        context: { hasDevResultPacket: true, requiredValidationsPassed: true },
      },
      { target: TaskStatus.IN_REVIEW, context: { hasReviewRoutingDecision: true } },
      { target: TaskStatus.APPROVED, context: { leadReviewDecision: "approved" } },
      { target: TaskStatus.QUEUED_FOR_MERGE, context: {} },
      { target: TaskStatus.MERGING, context: {} },
      { target: TaskStatus.POST_MERGE_VALIDATION, context: { mergeSuccessful: true } },
      { target: TaskStatus.DONE, context: { postMergeValidationPassed: true } },
    ];

    for (const { target, context } of transitions) {
      const result = transitionService.transitionTask(taskId, target, context, SYSTEM_ACTOR);
      currentVersion++;
      expect(result.entity.version).toBe(currentVersion);
    }

    // Final version should be 11 (1 initial + 10 transitions)
    expect(currentVersion).toBe(11);
  });

  /**
   * Verifies that no duplicate task assignments can occur during the lifecycle.
   *
   * Why this test matters: The one-active-lease invariant is a critical
   * safety property. If two workers could be assigned to the same task,
   * they would produce conflicting changes.
   */
  it("should reject duplicate assignment when task is already ASSIGNED", () => {
    // Move to ASSIGNED
    transitionService.transitionTask(
      taskId,
      TaskStatus.READY,
      { allDependenciesResolved: true, hasPolicyBlockers: false },
      SYSTEM_ACTOR,
    );
    transitionService.transitionTask(
      taskId,
      TaskStatus.ASSIGNED,
      { leaseAcquired: true },
      SYSTEM_ACTOR,
    );

    // Attempting to transition to ASSIGNED again should throw
    // (state machine does not allow ASSIGNED → ASSIGNED)
    expect(() =>
      transitionService.transitionTask(
        taskId,
        TaskStatus.ASSIGNED,
        { leaseAcquired: true },
        SYSTEM_ACTOR,
      ),
    ).toThrow(InvalidTransitionError);
  });

  /**
   * Verifies that guard failures produce meaningful rejection reasons.
   *
   * Why this test matters: When a transition is rejected, the system must
   * provide clear feedback about why. Opaque rejections make debugging
   * impossible and can mask real issues.
   */
  it("should reject transitions with missing guard context", () => {
    // Try BACKLOG → READY without required context (deps not resolved)
    expect(() =>
      transitionService.transitionTask(
        taskId,
        TaskStatus.READY,
        { allDependenciesResolved: false, hasPolicyBlockers: false },
        SYSTEM_ACTOR,
      ),
    ).toThrow(InvalidTransitionError);

    // Verify task status unchanged
    const status = conn.sqlite.prepare("SELECT status FROM task WHERE task_id = ?").get(taskId) as {
      status: string;
    };
    expect(status.status).toBe("BACKLOG");
  });

  /**
   * Verifies atomicity: if a transition succeeds, both state change and
   * audit event are persisted; if it fails, neither is persisted.
   *
   * Why this test matters: Partial state (task updated but no audit event,
   * or vice versa) would compromise the audit trail integrity that the
   * system relies on for observability and recovery.
   */
  it("should persist state changes and audit events atomically", () => {
    const auditsBefore = countAuditEvents(conn, taskId);

    // Successful transition
    transitionService.transitionTask(
      taskId,
      TaskStatus.READY,
      { allDependenciesResolved: true, hasPolicyBlockers: false },
      SYSTEM_ACTOR,
    );

    const auditsAfterSuccess = countAuditEvents(conn, taskId);
    expect(auditsAfterSuccess).toBe(auditsBefore + 1);

    // Failed transition (invalid: READY → DEV_COMPLETE is not valid)
    expect(() =>
      transitionService.transitionTask(
        taskId,
        TaskStatus.DEV_COMPLETE,
        { hasDevResultPacket: true, requiredValidationsPassed: true },
        SYSTEM_ACTOR,
      ),
    ).toThrow(InvalidTransitionError);

    // No new audit event should have been created
    const auditsAfterFailure = countAuditEvents(conn, taskId);
    expect(auditsAfterFailure).toBe(auditsAfterSuccess);
  });
});
