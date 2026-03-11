/**
 * Integration test: Review rejection and rework loop.
 *
 * Validates the rework cycle path through the state machine:
 *   BACKLOG → … → IN_REVIEW → CHANGES_REQUESTED → ASSIGNED → … → IN_REVIEW → APPROVED
 *
 * Uses the real SQLite database, real UnitOfWork, and real TransitionService
 * (same infrastructure as the full-lifecycle integration test from T107).
 * Each transition is verified for:
 * - Correct resulting task status and version increment
 * - Atomic audit event persistence
 * - Supporting entity lifecycle (lease, review cycle)
 * - Schema-valid packet creation (including RejectionContext)
 * - Correct review_round_count tracking
 *
 * This is the V1 review-rework integration validation test described in T108.
 *
 * @see docs/backlog/tasks/T108-e2e-review-rework.md
 * @see docs/prd/002-data-model.md §2.5 — Rework and Review Round Rules
 * @see docs/prd/008-packet-and-schema-spec.md §8.12 — RejectionContext
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { TaskStatus, WorkerLeaseStatus, ReviewCycleStatus } from "@factory/domain";

import {
  createTransitionService,
  type TransitionService,
  type DomainEventEmitter,
  type DomainEvent,
  type ActorInfo,
} from "@factory/application";

import {
  DevResultPacketSchema,
  ReviewPacketSchema,
  LeadReviewDecisionPacketSchema,
  RejectionContextSchema,
  TaskPacketSchema,
} from "@factory/schemas";

import { createTestDatabase, type TestDatabaseConnection } from "@factory/testing";

import { createSqliteUnitOfWork } from "../infrastructure/unit-of-work/sqlite-unit-of-work.js";

import { resolve } from "node:path";

// ─── Constants ──────────────────────────────────────────────────────────────

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, "../../drizzle");

const SYSTEM_ACTOR: ActorInfo = {
  type: "system",
  id: "review-rework-integration-test",
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
 * Retrieves all audit events for a given entity, ordered by creation time.
 */
function getAuditEvents(
  conn: TestDatabaseConnection,
  entityId: string,
): Array<{
  entity_type: string;
  event_type: string;
  old_state: string | null;
  new_state: string;
}> {
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
 * Seeds a lead review decision record. Returns the decision ID.
 * This simulates what the review decision service (T061) persists when
 * the lead reviewer makes a "changes_requested" decision.
 */
function seedLeadReviewDecision(
  conn: TestDatabaseConnection,
  taskId: string,
  reviewCycleId: string,
  decision: string,
  packetJson: unknown,
): string {
  const decisionId = `lrd-${crypto.randomUUID().slice(0, 8)}`;

  conn.sqlite
    .prepare(
      `INSERT INTO lead_review_decision
         (lead_review_decision_id, task_id, review_cycle_id, decision,
          blocking_issue_count, non_blocking_issue_count, packet_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      decisionId,
      taskId,
      reviewCycleId,
      decision,
      decision === "changes_requested" ? 2 : 0,
      1,
      JSON.stringify(packetJson),
    );

  return decisionId;
}

/**
 * Reads the current review_round_count directly from the database.
 * Used to verify that the count tracks correctly across rejection cycles.
 */
function getReviewRoundCount(conn: TestDatabaseConnection, taskId: string): number {
  const row = conn.sqlite
    .prepare("SELECT review_round_count FROM task WHERE task_id = ?")
    .get(taskId) as { review_round_count: number };
  return row.review_round_count;
}

/**
 * Increments the review_round_count and version in the database.
 * Simulates what the review decision service (T061) does atomically
 * when processing a "changes_requested" decision.
 */
function incrementReviewRoundCount(
  conn: TestDatabaseConnection,
  taskId: string,
  currentVersion: number,
): void {
  conn.sqlite
    .prepare(
      `UPDATE task
       SET review_round_count = review_round_count + 1,
           version = version + 1,
           updated_at = unixepoch()
       WHERE task_id = ? AND version = ?`,
    )
    .run(taskId, currentVersion);
}

// ─── Packet Builders ────────────────────────────────────────────────────────

/**
 * Builds a schema-valid DevResultPacket for a successful development run.
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
 * Builds a schema-valid ReviewPacket with a "changes_requested" verdict
 * and blocking issues. Used for the first review round (rejection).
 */
function buildRejectingReviewPacket(
  taskId: string,
  repositoryId: string,
  reviewCycleId: string,
): unknown {
  return {
    packet_type: "review_packet",
    schema_version: "1.0",
    created_at: new Date().toISOString(),
    task_id: taskId,
    repository_id: repositoryId,
    review_cycle_id: reviewCycleId,
    reviewer_pool_id: "general-review-pool",
    reviewer_type: "general",
    verdict: "changes_requested",
    summary: "Blocking issues found in the implementation.",
    confidence: "high",
    blocking_issues: [
      {
        severity: "high",
        code: "NULL_CHECK_MISSING",
        title: "Missing null check in handler",
        description: "Missing null check in handler function causes potential crash",
        file_path: "src/feature.ts",
        line: 42,
        blocking: true,
      },
      {
        severity: "medium",
        code: "UNSANITIZED_INPUT",
        title: "User input not sanitized",
        description: "User input not sanitized before database query",
        file_path: "src/feature.ts",
        line: 78,
        blocking: true,
      },
    ],
    non_blocking_issues: [
      {
        severity: "low",
        code: "NAMING_CONVENTION",
        title: "Variable name could be more descriptive",
        description: "Variable name could be more descriptive",
        file_path: "src/feature.ts",
        line: 10,
        blocking: false,
      },
    ],
    follow_up_task_refs: [],
    risks: ["Potential data corruption if null check is missed"],
    open_questions: [],
  };
}

/**
 * Builds a schema-valid LeadReviewDecisionPacket with a "changes_requested"
 * decision and blocking issues. Used for the first review round (rejection).
 */
function buildRejectingLeadDecisionPacket(
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
    decision: "changes_requested",
    summary:
      "Two blocking issues identified: missing null check and unsanitized input. Rework required before merge.",
    blocking_issues: [
      {
        severity: "high",
        code: "NULL_CHECK_MISSING",
        title: "Missing null check in handler",
        description: "Missing null check in handler function causes potential crash",
        file_path: "src/feature.ts",
        line: 42,
        blocking: true,
      },
      {
        severity: "medium",
        code: "UNSANITIZED_INPUT",
        title: "User input not sanitized",
        description: "User input not sanitized before database query",
        file_path: "src/feature.ts",
        line: 78,
        blocking: true,
      },
    ],
    non_blocking_suggestions: ["Consider renaming variable 'x' to 'userCount' for clarity"],
    deduplication_notes: ["Issues 1 and 2 are distinct — no deduplication applied"],
    follow_up_task_refs: [],
    risks: ["Potential data corruption if null check is missed"],
    open_questions: [],
  };
}

/**
 * Builds a schema-valid ReviewPacket with an "approved" verdict.
 * Used for the second review round (approval after rework).
 */
function buildApprovingReviewPacket(
  taskId: string,
  repositoryId: string,
  reviewCycleId: string,
): unknown {
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
    summary:
      "All blocking issues from prior round have been resolved. Code meets quality standards.",
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
 * Used for the second review round (approval after rework).
 */
function buildApprovingLeadDecisionPacket(
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
    summary: "All prior blocking issues resolved. Code is clean and ready for merge.",
    blocking_issues: [],
    non_blocking_suggestions: [],
    deduplication_notes: [],
    follow_up_task_refs: [],
    risks: [],
    open_questions: [],
  };
}

/**
 * Builds a schema-valid TaskPacket for a rework attempt. Includes
 * rejection_context from the prior review cycle so the developer
 * knows what blocking issues to address.
 *
 * @see docs/prd/008-packet-and-schema-spec.md §8.4 — TaskPacket
 * @see docs/prd/008-packet-and-schema-spec.md §8.12 — RejectionContext
 */
function buildReworkTaskPacket(
  taskId: string,
  repositoryId: string,
  priorReviewCycleId: string,
): unknown {
  return {
    packet_type: "task_packet",
    schema_version: "1.0",
    created_at: new Date().toISOString(),
    task_id: taskId,
    repository_id: repositoryId,
    role: "developer",
    time_budget_seconds: 3600,
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    task: {
      title: "Implement feature X",
      description: "Fix blocking issues from prior review round.",
      task_type: "FEATURE",
      priority: "HIGH",
      severity: "medium",
      acceptance_criteria: ["Null check added", "Input sanitized"],
      definition_of_done: ["All tests pass", "No blocking review issues"],
      risk_level: "medium",
      suggested_file_scope: ["src/feature.ts"],
      branch_name: `factory/${taskId}`,
    },
    repository: {
      name: "test-repo",
      default_branch: "main",
    },
    workspace: {
      worktree_path: `/tmp/workspaces/${taskId}`,
      artifact_root: `/tmp/artifacts/${taskId}`,
    },
    context: {
      related_tasks: [],
      dependencies: [],
      rejection_context: {
        prior_review_cycle_id: priorReviewCycleId,
        blocking_issues: [
          {
            severity: "high",
            code: "NULL_CHECK_MISSING",
            title: "Missing null check in handler",
            description: "Missing null check in handler function causes potential crash",
            file_path: "src/feature.ts",
            line: 42,
            blocking: true,
          },
          {
            severity: "medium",
            code: "UNSANITIZED_INPUT",
            title: "User input not sanitized",
            description: "User input not sanitized before database query",
            file_path: "src/feature.ts",
            line: 78,
            blocking: true,
          },
        ],
        lead_decision_summary:
          "Two blocking issues identified: missing null check and unsanitized input. Rework required before merge.",
      },
      code_map_refs: [],
      prior_partial_work: null,
    },
    repo_policy: {
      policy_set_id: "default-policy",
    },
    tool_policy: {
      command_policy_id: "default-commands",
      file_scope_policy_id: "default-file-scope",
    },
    validation_requirements: {
      profile: "standard",
    },
    stop_conditions: ["All blocking issues resolved", "Tests pass"],
    expected_output: {
      packet_type: "dev_result_packet",
      schema_version: "1.0",
    },
  };
}

// ─── Transition Helpers ─────────────────────────────────────────────────────

/**
 * Drives a task from BACKLOG through the development phase to IN_REVIEW.
 * Encapsulates steps 1–5 of the happy path, which are identical to T107.
 * Returns the IDs of entities created along the way.
 *
 * Why this helper exists: The BACKLOG → IN_REVIEW prefix is shared between
 * the initial attempt and would be repeated if inlined. Extracting it
 * reduces noise and focuses the test on the rework-specific transitions.
 */
function driveTaskToInReview(
  conn: TestDatabaseConnection,
  transitionService: TransitionService,
  taskId: string,
  repositoryId: string,
  workerPoolId: string,
): { leaseId: string; reviewCycleId: string; versionAfter: number } {
  // Step 1: BACKLOG → READY
  transitionService.transitionTask(
    taskId,
    TaskStatus.READY,
    { allDependenciesResolved: true, hasPolicyBlockers: false },
    SYSTEM_ACTOR,
  );

  // Step 2: READY → ASSIGNED (new lease)
  const leaseId = seedTaskLease(conn, taskId, workerPoolId, "LEASED");
  conn.sqlite
    .prepare("UPDATE task SET current_lease_id = ? WHERE task_id = ?")
    .run(leaseId, taskId);

  transitionService.transitionTask(
    taskId,
    TaskStatus.ASSIGNED,
    { leaseAcquired: true },
    SYSTEM_ACTOR,
  );

  // Lease lifecycle: LEASED → STARTING → RUNNING → HEARTBEATING → COMPLETING
  transitionService.transitionLease(
    leaseId,
    WorkerLeaseStatus.STARTING,
    { workerProcessSpawned: true },
    SYSTEM_ACTOR,
  );
  transitionService.transitionLease(
    leaseId,
    WorkerLeaseStatus.RUNNING,
    { firstHeartbeatReceived: true },
    SYSTEM_ACTOR,
  );

  // Step 3: ASSIGNED → IN_DEVELOPMENT
  transitionService.transitionTask(
    taskId,
    TaskStatus.IN_DEVELOPMENT,
    { hasHeartbeat: true },
    SYSTEM_ACTOR,
  );

  transitionService.transitionLease(
    leaseId,
    WorkerLeaseStatus.HEARTBEATING,
    { heartbeatReceived: true },
    SYSTEM_ACTOR,
  );

  // Step 4: IN_DEVELOPMENT → DEV_COMPLETE
  transitionService.transitionLease(
    leaseId,
    WorkerLeaseStatus.COMPLETING,
    { completionSignalReceived: true },
    SYSTEM_ACTOR,
  );

  transitionService.transitionTask(
    taskId,
    TaskStatus.DEV_COMPLETE,
    { hasDevResultPacket: true, requiredValidationsPassed: true },
    SYSTEM_ACTOR,
  );

  // Step 5: DEV_COMPLETE → IN_REVIEW
  const reviewCycleId = seedReviewCycle(conn, taskId, "NOT_STARTED");
  conn.sqlite
    .prepare("UPDATE task SET current_review_cycle_id = ? WHERE task_id = ?")
    .run(reviewCycleId, taskId);

  transitionService.transitionReviewCycle(
    reviewCycleId,
    ReviewCycleStatus.ROUTED,
    { routingDecisionEmitted: true },
    SYSTEM_ACTOR,
  );

  const result = transitionService.transitionTask(
    taskId,
    TaskStatus.IN_REVIEW,
    { hasReviewRoutingDecision: true },
    SYSTEM_ACTOR,
  );

  return { leaseId, reviewCycleId, versionAfter: result.entity.version };
}

/**
 * Drives a review cycle through specialist review to lead consolidation
 * and records the lead review decision. Returns the final review cycle status.
 *
 * @param verdict - Either "approved" or "changes_requested"
 */
function driveReviewCycleToDecision(
  conn: TestDatabaseConnection,
  transitionService: TransitionService,
  reviewCycleId: string,
  verdict: "approved" | "changes_requested",
): void {
  // ROUTED → IN_PROGRESS (specialist review starts)
  transitionService.transitionReviewCycle(
    reviewCycleId,
    ReviewCycleStatus.IN_PROGRESS,
    { reviewStarted: true },
    SYSTEM_ACTOR,
  );

  // IN_PROGRESS → CONSOLIDATING (all specialists done)
  transitionService.transitionReviewCycle(
    reviewCycleId,
    ReviewCycleStatus.CONSOLIDATING,
    { allRequiredReviewsComplete: true },
    SYSTEM_ACTOR,
  );

  // CONSOLIDATING → APPROVED or REJECTED
  if (verdict === "approved") {
    transitionService.transitionReviewCycle(
      reviewCycleId,
      ReviewCycleStatus.APPROVED,
      { leadReviewDecision: "approved" },
      SYSTEM_ACTOR,
    );
  } else {
    transitionService.transitionReviewCycle(
      reviewCycleId,
      ReviewCycleStatus.REJECTED,
      { leadReviewDecision: "rejected" },
      SYSTEM_ACTOR,
    );
  }
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("Review Rejection and Rework Loop (T108)", () => {
  let conn: TestDatabaseConnection;
  let transitionService: TransitionService;
  let capturedEvents: DomainEvent[];

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
    ({ repositoryId, workerPoolId } = seedPrerequisites(conn));
    taskId = seedTask(conn, repositoryId);
  });

  afterEach(() => {
    conn.close();
  });

  /**
   * T108 primary acceptance test: review rejection → rework → re-review → approval.
   *
   * Drives a task through the complete rework cycle:
   * 1. First attempt: BACKLOG → … → IN_REVIEW
   * 2. Lead reviewer rejects with blocking issues → CHANGES_REQUESTED
   * 3. Rework: CHANGES_REQUESTED → ASSIGNED → … → IN_REVIEW
   * 4. Lead reviewer approves → APPROVED
   *
   * Verifies that:
   * - The CHANGES_REQUESTED transition works correctly
   * - review_round_count is incremented on rejection
   * - A new review cycle is created for the second attempt
   * - The second attempt can reach APPROVED
   * - The complete audit trail is maintained
   *
   * Why this test matters: The rework loop is the primary quality feedback
   * mechanism. If rejection context is lost or review_round_count doesn't
   * track, developers receive no guidance on what to fix and escalation
   * policies cannot enforce review round limits.
   */
  it("should complete a full rejection → rework → approval cycle", () => {
    // ── Phase 1: First attempt — drive task to IN_REVIEW ──────────────

    const firstAttempt = driveTaskToInReview(
      conn,
      transitionService,
      taskId,
      repositoryId,
      workerPoolId,
    );
    expect(firstAttempt.versionAfter).toBe(6); // 5 task transitions from BACKLOG

    // Verify initial review_round_count is 0
    expect(getReviewRoundCount(conn, taskId)).toBe(0);

    // ── Phase 2: First review — REJECT with blocking issues ───────────

    // Drive the review cycle through to REJECTED
    driveReviewCycleToDecision(
      conn,
      transitionService,
      firstAttempt.reviewCycleId,
      "changes_requested",
    );

    // Build and persist the lead review decision (simulates T061)
    const rejectingDecisionPacket = buildRejectingLeadDecisionPacket(
      taskId,
      repositoryId,
      firstAttempt.reviewCycleId,
    );
    seedLeadReviewDecision(
      conn,
      taskId,
      firstAttempt.reviewCycleId,
      "changes_requested",
      rejectingDecisionPacket,
    );

    // Transition task: IN_REVIEW → CHANGES_REQUESTED
    const rejectionResult = transitionService.transitionTask(
      taskId,
      TaskStatus.CHANGES_REQUESTED,
      { leadReviewDecision: "changes_requested" },
      SYSTEM_ACTOR,
      { reviewCycleId: firstAttempt.reviewCycleId, decision: "changes_requested" },
    );
    expect(rejectionResult.entity.status).toBe(TaskStatus.CHANGES_REQUESTED);

    // Simulate review_round_count increment (normally done by review decision service)
    const versionAfterRejection = rejectionResult.entity.version;
    incrementReviewRoundCount(conn, taskId, versionAfterRejection);

    // Verify review_round_count is now 1
    expect(getReviewRoundCount(conn, taskId)).toBe(1);

    // ── Phase 3: Rework — second dev attempt ──────────────────────────

    // Acquire new lease for rework
    const reworkLeaseId = seedTaskLease(conn, taskId, workerPoolId, "LEASED");
    conn.sqlite
      .prepare("UPDATE task SET current_lease_id = ? WHERE task_id = ?")
      .run(reworkLeaseId, taskId);

    // CHANGES_REQUESTED → ASSIGNED (rework begins)
    const reworkAssignResult = transitionService.transitionTask(
      taskId,
      TaskStatus.ASSIGNED,
      { leaseAcquired: true },
      SYSTEM_ACTOR,
      { rework: true, priorReviewCycleId: firstAttempt.reviewCycleId },
    );
    expect(reworkAssignResult.entity.status).toBe(TaskStatus.ASSIGNED);

    // Rework lease lifecycle
    transitionService.transitionLease(
      reworkLeaseId,
      WorkerLeaseStatus.STARTING,
      { workerProcessSpawned: true },
      SYSTEM_ACTOR,
    );
    transitionService.transitionLease(
      reworkLeaseId,
      WorkerLeaseStatus.RUNNING,
      { firstHeartbeatReceived: true },
      SYSTEM_ACTOR,
    );

    // ASSIGNED → IN_DEVELOPMENT (rework)
    transitionService.transitionTask(
      taskId,
      TaskStatus.IN_DEVELOPMENT,
      { hasHeartbeat: true },
      SYSTEM_ACTOR,
    );

    transitionService.transitionLease(
      reworkLeaseId,
      WorkerLeaseStatus.HEARTBEATING,
      { heartbeatReceived: true },
      SYSTEM_ACTOR,
    );

    // IN_DEVELOPMENT → DEV_COMPLETE (rework complete)
    transitionService.transitionLease(
      reworkLeaseId,
      WorkerLeaseStatus.COMPLETING,
      { completionSignalReceived: true },
      SYSTEM_ACTOR,
    );

    transitionService.transitionTask(
      taskId,
      TaskStatus.DEV_COMPLETE,
      { hasDevResultPacket: true, requiredValidationsPassed: true },
      SYSTEM_ACTOR,
    );

    // DEV_COMPLETE → IN_REVIEW (second review cycle)
    const secondReviewCycleId = seedReviewCycle(conn, taskId, "NOT_STARTED");
    conn.sqlite
      .prepare("UPDATE task SET current_review_cycle_id = ? WHERE task_id = ?")
      .run(secondReviewCycleId, taskId);

    transitionService.transitionReviewCycle(
      secondReviewCycleId,
      ReviewCycleStatus.ROUTED,
      { routingDecisionEmitted: true },
      SYSTEM_ACTOR,
    );

    transitionService.transitionTask(
      taskId,
      TaskStatus.IN_REVIEW,
      { hasReviewRoutingDecision: true },
      SYSTEM_ACTOR,
    );

    // ── Phase 4: Second review — APPROVE ──────────────────────────────

    driveReviewCycleToDecision(conn, transitionService, secondReviewCycleId, "approved");

    const approvalResult = transitionService.transitionTask(
      taskId,
      TaskStatus.APPROVED,
      { leadReviewDecision: "approved" },
      SYSTEM_ACTOR,
    );
    expect(approvalResult.entity.status).toBe(TaskStatus.APPROVED);

    // ── Final Verification ────────────────────────────────────────────

    // Verify final task status via direct DB query
    const finalTask = conn.sqlite
      .prepare("SELECT status, version, review_round_count FROM task WHERE task_id = ?")
      .get(taskId) as { status: string; version: number; review_round_count: number };

    expect(finalTask.status).toBe("APPROVED");
    expect(finalTask.review_round_count).toBe(1);

    // Verify task audit trail contains the full rework cycle
    const taskAuditEvents = getAuditEvents(conn, taskId);
    const taskTransitionTypes = taskAuditEvents.map((e) => e.event_type);

    // Expected task transitions (12 total):
    // BACKLOG→READY, READY→ASSIGNED, ASSIGNED→IN_DEVELOPMENT,
    // IN_DEVELOPMENT→DEV_COMPLETE, DEV_COMPLETE→IN_REVIEW,
    // IN_REVIEW→CHANGES_REQUESTED,
    // CHANGES_REQUESTED→ASSIGNED, ASSIGNED→IN_DEVELOPMENT,
    // IN_DEVELOPMENT→DEV_COMPLETE, DEV_COMPLETE→IN_REVIEW,
    // IN_REVIEW→APPROVED
    expect(taskAuditEvents).toHaveLength(11);

    // Verify the rejection transition is in the audit trail
    expect(taskTransitionTypes).toContain("task.transition.IN_REVIEW.to.CHANGES_REQUESTED");

    // Verify the rework re-entry is in the audit trail
    expect(taskTransitionTypes).toContain("task.transition.CHANGES_REQUESTED.to.ASSIGNED");

    // Verify both IN_REVIEW entries exist (first and second review)
    const inReviewTransitions = taskTransitionTypes.filter(
      (t) => t === "task.transition.DEV_COMPLETE.to.IN_REVIEW",
    );
    expect(inReviewTransitions).toHaveLength(2);

    // Verify the final APPROVED transition
    expect(taskTransitionTypes).toContain("task.transition.IN_REVIEW.to.APPROVED");

    // Verify two review cycles exist for this task
    const reviewCycles = conn.sqlite
      .prepare("SELECT review_cycle_id, status FROM review_cycle WHERE task_id = ? ORDER BY rowid")
      .all(taskId) as Array<{ review_cycle_id: string; status: string }>;
    expect(reviewCycles).toHaveLength(2);
    expect(reviewCycles[0]!.status).toBe("REJECTED");
    expect(reviewCycles[1]!.status).toBe("APPROVED");

    // Verify domain events were emitted for all task transitions
    const taskTransitionEvents = capturedEvents.filter((e) => e.type === "task.transitioned");
    expect(taskTransitionEvents).toHaveLength(11);
  });

  /**
   * Validates that rejection packets and rework TaskPackets are schema-valid.
   *
   * Why this test matters: The rework loop depends on schema-valid packets
   * flowing between stages. The rejection ReviewPacket must include blocking
   * issues, the LeadReviewDecisionPacket must reference them, the
   * RejectionContext must be well-formed, and the rework TaskPacket must
   * include the rejection_context field. If any of these fail schema
   * validation, the rework pipeline breaks.
   */
  it("should produce schema-valid rejection packets and rework TaskPacket", () => {
    const reviewCycleId = `rc-test-${crypto.randomUUID().slice(0, 8)}`;

    // Validate rejecting specialist review packet
    const rejectingReview = buildRejectingReviewPacket(taskId, repositoryId, reviewCycleId);
    expect(() => ReviewPacketSchema.parse(rejectingReview)).not.toThrow();

    // Validate rejecting lead decision packet
    const rejectingDecision = buildRejectingLeadDecisionPacket(taskId, repositoryId, reviewCycleId);
    expect(() => LeadReviewDecisionPacketSchema.parse(rejectingDecision)).not.toThrow();

    // Validate approving specialist review packet
    const approvingReview = buildApprovingReviewPacket(taskId, repositoryId, reviewCycleId);
    expect(() => ReviewPacketSchema.parse(approvingReview)).not.toThrow();

    // Validate approving lead decision packet
    const approvingDecision = buildApprovingLeadDecisionPacket(taskId, repositoryId, reviewCycleId);
    expect(() => LeadReviewDecisionPacketSchema.parse(approvingDecision)).not.toThrow();

    // Validate the rework TaskPacket with rejection_context
    const reworkPacket = buildReworkTaskPacket(taskId, repositoryId, reviewCycleId);
    expect(() => TaskPacketSchema.parse(reworkPacket)).not.toThrow();

    // Validate the rejection context independently
    const rejectionContext = {
      prior_review_cycle_id: reviewCycleId,
      blocking_issues: [
        {
          severity: "high",
          code: "NULL_CHECK_MISSING",
          title: "Missing null check",
          description: "Missing null check",
          file_path: "src/feature.ts",
          line: 42,
          blocking: true,
        },
      ],
      lead_decision_summary: "Blocking issues found. Rework required.",
    };
    expect(() => RejectionContextSchema.parse(rejectionContext)).not.toThrow();

    // Validate the DevResultPacket for both attempts
    const devResult = buildDevResultPacket(taskId, repositoryId);
    expect(() => DevResultPacketSchema.parse(devResult)).not.toThrow();
  });

  /**
   * Validates that review_round_count correctly tracks rejection rounds
   * and starts at zero for new tasks.
   *
   * Why this test matters: The review_round_count drives escalation policy
   * evaluation. If it doesn't increment on rejection, the system will never
   * escalate tasks stuck in infinite review loops. If it starts at a wrong
   * value, escalation triggers too early or too late.
   */
  it("should track review_round_count starting at zero and incrementing on rejection", () => {
    // New task starts at review_round_count = 0
    expect(getReviewRoundCount(conn, taskId)).toBe(0);

    // Drive to IN_REVIEW
    const firstAttempt = driveTaskToInReview(
      conn,
      transitionService,
      taskId,
      repositoryId,
      workerPoolId,
    );

    // Still 0 before rejection
    expect(getReviewRoundCount(conn, taskId)).toBe(0);

    // Reject
    driveReviewCycleToDecision(
      conn,
      transitionService,
      firstAttempt.reviewCycleId,
      "changes_requested",
    );

    transitionService.transitionTask(
      taskId,
      TaskStatus.CHANGES_REQUESTED,
      { leadReviewDecision: "changes_requested" },
      SYSTEM_ACTOR,
    );

    // Increment review_round_count (simulates review decision service)
    const currentVersion = (
      conn.sqlite.prepare("SELECT version FROM task WHERE task_id = ?").get(taskId) as {
        version: number;
      }
    ).version;
    incrementReviewRoundCount(conn, taskId, currentVersion);

    // Now 1 after first rejection
    expect(getReviewRoundCount(conn, taskId)).toBe(1);
  });

  /**
   * Validates that the RejectionContext correctly captures blocking issues
   * from the lead review decision for inclusion in the rework TaskPacket.
   *
   * Why this test matters: Without a complete RejectionContext, the reworking
   * developer has no guidance on what needs to change. The rejection context
   * must include the prior review cycle ID, blocking issues, and the lead
   * reviewer's summary. This test verifies that all required fields are
   * present and schema-valid.
   */
  it("should include rejection context with blocking issues in rework TaskPacket", () => {
    const reviewCycleId = `rc-${crypto.randomUUID().slice(0, 8)}`;

    // Build a rework TaskPacket with rejection context
    const reworkPacket = buildReworkTaskPacket(taskId, repositoryId, reviewCycleId);
    const parsed = TaskPacketSchema.parse(reworkPacket);

    // Verify rejection_context is present and has required fields
    expect(parsed.context.rejection_context).not.toBeNull();
    expect(parsed.context.rejection_context!.prior_review_cycle_id).toBe(reviewCycleId);
    expect(parsed.context.rejection_context!.blocking_issues.length).toBeGreaterThanOrEqual(1);
    expect(parsed.context.rejection_context!.lead_decision_summary).toBeTruthy();

    // Verify blocking issues have required structure
    const firstIssue = parsed.context.rejection_context!.blocking_issues[0]!;
    expect(firstIssue.code).toBeDefined();
    expect(firstIssue.severity).toBeDefined();
    expect(firstIssue.description).toBeDefined();

    // Verify the initial attempt TaskPacket has null rejection_context
    const initialPacket = {
      packet_type: "task_packet",
      schema_version: "1.0",
      created_at: new Date().toISOString(),
      task_id: taskId,
      repository_id: repositoryId,
      role: "developer",
      time_budget_seconds: 3600,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      task: {
        title: "Implement feature X",
        description: "Implement the feature.",
        task_type: "FEATURE",
        priority: "HIGH",
        severity: "medium",
        acceptance_criteria: ["Tests pass"],
        definition_of_done: ["All tests pass"],
        risk_level: "medium",
        suggested_file_scope: ["src/feature.ts"],
        branch_name: `factory/${taskId}`,
      },
      repository: {
        name: "test-repo",
        default_branch: "main",
      },
      workspace: {
        worktree_path: `/tmp/workspaces/${taskId}`,
        artifact_root: `/tmp/artifacts/${taskId}`,
      },
      context: {
        related_tasks: [],
        dependencies: [],
        rejection_context: null,
        code_map_refs: [],
        prior_partial_work: null,
      },
      repo_policy: {
        policy_set_id: "default-policy",
      },
      tool_policy: {
        command_policy_id: "default-commands",
        file_scope_policy_id: "default-file-scope",
      },
      validation_requirements: {
        profile: "standard",
      },
      stop_conditions: ["Complete implementation"],
      expected_output: {
        packet_type: "dev_result_packet",
        schema_version: "1.0",
      },
    };
    const parsedInitial = TaskPacketSchema.parse(initialPacket);
    expect(parsedInitial.context.rejection_context).toBeNull();
  });

  /**
   * Validates that the CHANGES_REQUESTED state correctly records an audit
   * event and preserves atomicity with the state change.
   *
   * Why this test matters: The CHANGES_REQUESTED transition is a non-standard
   * path (not on the happy path to DONE). If it doesn't record audit events
   * atomically, the audit trail has gaps that prevent post-hoc analysis of
   * why a task entered rework and how long it spent there.
   */
  it("should persist CHANGES_REQUESTED audit event atomically", () => {
    // Drive to IN_REVIEW
    const firstAttempt = driveTaskToInReview(
      conn,
      transitionService,
      taskId,
      repositoryId,
      workerPoolId,
    );

    // Count audit events before rejection
    const auditsBefore = getAuditEvents(conn, taskId).length;

    // Reject
    driveReviewCycleToDecision(
      conn,
      transitionService,
      firstAttempt.reviewCycleId,
      "changes_requested",
    );

    transitionService.transitionTask(
      taskId,
      TaskStatus.CHANGES_REQUESTED,
      { leadReviewDecision: "changes_requested" },
      SYSTEM_ACTOR,
    );

    // Verify exactly one new audit event was created for the task rejection
    const auditsAfter = getAuditEvents(conn, taskId);
    expect(auditsAfter.length).toBe(auditsBefore + 1);

    // Verify the audit event records the correct transition
    const rejectionAudit = auditsAfter[auditsAfter.length - 1]!;
    expect(rejectionAudit.event_type).toBe("task.transition.IN_REVIEW.to.CHANGES_REQUESTED");

    const oldState = JSON.parse(rejectionAudit.old_state!) as { status: string };
    const newState = JSON.parse(rejectionAudit.new_state) as { status: string };
    expect(oldState.status).toBe("IN_REVIEW");
    expect(newState.status).toBe("CHANGES_REQUESTED");
  });
});
