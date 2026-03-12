/**
 * Unit tests for the OperatorActionsService.
 *
 * These tests validate that all operator actions from §6.2 of the
 * additional refinements PRD work correctly:
 * - State transitions via the TransitionService (pause, resume, requeue,
 *   force-unblock, cancel)
 * - Metadata updates with audit events (change-priority, reassign-pool)
 * - Operator override transitions (rerun-review, reopen)
 * - Merge queue order overrides
 *
 * Each test uses an in-memory SQLite database with real Drizzle migrations
 * to verify that state changes, version increments, and audit events are
 * persisted atomically. This ensures the operator action layer correctly
 * integrates with the domain state machine, the application-layer
 * TransitionService, and the infrastructure repositories.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/prd/006-additional-refinements.md} §6.2
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";

import { OperatorActionsService } from "./operator-actions.service.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { createAuditEventRepository } from "../infrastructure/repositories/audit-event.repository.js";
import { createMergeQueueItemRepository } from "../infrastructure/repositories/merge-queue-item.repository.js";
import { createProjectRepository } from "../infrastructure/repositories/project.repository.js";
import { createRepositoryRepository } from "../infrastructure/repositories/repository.repository.js";
import { DomainEventBroadcasterAdapter } from "../events/domain-event-broadcaster.adapter.js";
import { EventBroadcasterService } from "../events/event-broadcaster.service.js";
import { EventsGateway } from "../events/events.gateway.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

/** Resolve the drizzle migrations folder relative to this test file. */
const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

/**
 * Create an in-memory test database with all migrations applied.
 *
 * Each call returns a fresh, isolated database so tests never
 * interfere with each other.
 */
function createTestConnection(): DatabaseConnection {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
    healthCheck: () => ({ ok: true, walMode: true, foreignKeys: true }),
    writeTransaction: <T>(fn: (d: typeof db) => T): T => {
      const runner = sqlite.transaction(() => fn(db));
      return runner.immediate() as T;
    },
  };
}

/** Default project and repository IDs used across all tests. */
const PROJECT_ID = "test-project-001";
const REPO_ID = "test-repo-001";

/**
 * Create the project and repository prerequisite rows that tasks reference.
 * Must be called before inserting any task rows.
 */
function createPrerequisites(conn: DatabaseConnection): void {
  conn.writeTransaction((db) => {
    const projectRepo = createProjectRepository(db);
    projectRepo.create({
      projectId: PROJECT_ID,
      name: "Test Project",
      owner: "test-owner",
      description: "For operator action tests",
    });

    const repoRepo = createRepositoryRepository(db);
    repoRepo.create({
      repositoryId: REPO_ID,
      projectId: PROJECT_ID,
      name: "test-repo",
      remoteUrl: "https://github.com/test/test.git",
      localCheckoutStrategy: "worktree",
      status: "active",
    } as never);
  });
}

/**
 * Create a task in the specified status for testing.
 *
 * Inserts a task row directly with the given status, bypassing the
 * state machine. This is intentional — we're testing operator actions,
 * not the normal task lifecycle progression.
 */
function createTaskInState(
  conn: DatabaseConnection,
  status: string,
  overrides: Record<string, unknown> = {},
): string {
  const taskId = randomUUID();
  conn.writeTransaction((db) => {
    const repo = createTaskRepository(db);
    repo.create({
      taskId,
      repositoryId: REPO_ID,
      title: `Test task in ${status}`,
      taskType: "feature",
      priority: "medium",
      source: "manual",
      status,
      ...overrides,
    });
  });
  return taskId;
}

describe("OperatorActionsService", () => {
  let conn: DatabaseConnection;
  let service: OperatorActionsService;

  beforeEach(() => {
    conn = createTestConnection();
    createPrerequisites(conn);
    // Construct the service directly with the test connection,
    // bypassing NestJS DI for unit testing. The DomainEventBroadcasterAdapter
    // is constructed with a real EventBroadcasterService backed by a
    // gateway with no server — events are silently dropped (acceptable
    // for unit tests that don't verify WebSocket delivery).
    const gateway = new EventsGateway();
    const broadcaster = new EventBroadcasterService(gateway);
    const eventAdapter = new DomainEventBroadcasterAdapter(broadcaster);
    service = new OperatorActionsService(conn, eventAdapter);
  });

  // ─── Pause ──────────────────────────────────────────────────────────────

  describe("pause", () => {
    /**
     * Validates that pausing a READY task moves it to ESCALATED and records
     * an audit event with operator actor type. This is critical because
     * pause is the primary mechanism for operators to freeze a task.
     */
    it("should move a READY task to ESCALATED", () => {
      const taskId = createTaskInState(conn, "READY");

      const result = service.pause(taskId, "operator-1", "Waiting for design decision");

      expect(result.task.status).toBe("ESCALATED");
      expect(result.auditEvent.actorType).toBe("operator");
      expect(result.auditEvent.actorId).toBe("operator-1");
      expect(result.auditEvent.eventType).toContain("transition");
    });

    /**
     * Validates that pausing works from IN_DEVELOPMENT (wildcard transition).
     * Operators must be able to pause tasks mid-execution.
     */
    it("should move an IN_DEVELOPMENT task to ESCALATED", () => {
      const taskId = createTaskInState(conn, "IN_DEVELOPMENT");

      const result = service.pause(taskId, "operator-1", "Found blocking issue");

      expect(result.task.status).toBe("ESCALATED");
    });

    /**
     * Validates that pausing a task already in a terminal state is rejected.
     * Terminal states (DONE, FAILED, CANCELLED) cannot be paused.
     */
    it("should reject pausing a DONE task", () => {
      const taskId = createTaskInState(conn, "DONE");

      expect(() => service.pause(taskId, "operator-1", "reason")).toThrow();
    });

    /**
     * Validates that pausing a non-existent task returns a clear error.
     */
    it("should throw NotFoundException for unknown task", () => {
      expect(() => service.pause("nonexistent-id", "op-1", "reason")).toThrow(/not found/i);
    });
  });

  // ─── Resume ─────────────────────────────────────────────────────────────

  describe("resume", () => {
    /**
     * Validates that resuming an ESCALATED task moves it to ASSIGNED.
     * This is the standard operator resolution path for paused tasks.
     */
    it("should move an ESCALATED task to ASSIGNED", () => {
      const taskId = createTaskInState(conn, "ESCALATED");

      const result = service.resume(taskId, "operator-1", "Design decision made");

      expect(result.task.status).toBe("ASSIGNED");
      expect(result.auditEvent.actorType).toBe("operator");
    });

    /**
     * Validates that resuming a non-ESCALATED task is rejected.
     * Resume is only valid from ESCALATED state.
     */
    it("should reject resuming a READY task", () => {
      const taskId = createTaskInState(conn, "READY");

      expect(() => service.resume(taskId, "operator-1", "reason")).toThrow();
    });
  });

  // ─── Requeue ────────────────────────────────────────────────────────────

  describe("requeue", () => {
    /**
     * Validates that requeue moves ASSIGNED tasks back to READY.
     * This allows operators to cancel a work assignment without
     * cancelling the task itself.
     */
    it("should move an ASSIGNED task to READY", () => {
      const taskId = createTaskInState(conn, "ASSIGNED");

      const result = service.requeue(taskId, "operator-1", "Worker unresponsive");

      expect(result.task.status).toBe("READY");
      expect(result.auditEvent.actorType).toBe("operator");
    });

    /**
     * Validates that requeue works from IN_DEVELOPMENT state too.
     * Operators may need to pull work back even after development started.
     */
    it("should move an IN_DEVELOPMENT task to READY", () => {
      const taskId = createTaskInState(conn, "IN_DEVELOPMENT");

      const result = service.requeue(taskId, "operator-1", "Wrong worker");

      expect(result.task.status).toBe("READY");
    });

    /**
     * Validates that requeue rejects tasks not in assignable states.
     */
    it("should reject requeing a BACKLOG task", () => {
      const taskId = createTaskInState(conn, "BACKLOG");

      expect(() => service.requeue(taskId, "operator-1", "reason")).toThrow();
    });
  });

  // ─── Force Unblock ──────────────────────────────────────────────────────

  describe("forceUnblock", () => {
    /**
     * Validates that force-unblock moves BLOCKED tasks to READY.
     * This is the operator escape hatch when dependencies cannot be
     * resolved through normal means.
     */
    it("should move a BLOCKED task to READY", () => {
      const taskId = createTaskInState(conn, "BLOCKED");

      const result = service.forceUnblock(taskId, "operator-1", "Dependency handled externally");

      expect(result.task.status).toBe("READY");
      expect(result.auditEvent.actorType).toBe("operator");
    });

    /**
     * Validates that force-unblock rejects non-BLOCKED tasks.
     */
    it("should reject unblocking a READY task", () => {
      const taskId = createTaskInState(conn, "READY");

      expect(() => service.forceUnblock(taskId, "op-1", "reason")).toThrow();
    });
  });

  // ─── Cancel ─────────────────────────────────────────────────────────────

  describe("cancel", () => {
    /**
     * Validates that cancel moves any non-terminal task to CANCELLED.
     * This is the primary operator mechanism for permanently stopping work.
     */
    it("should cancel a READY task", () => {
      const taskId = createTaskInState(conn, "READY");

      const result = service.cancel(taskId, "operator-1", "No longer needed");

      expect(result.task.status).toBe("CANCELLED");
      expect(result.auditEvent.actorType).toBe("operator");
    });

    /**
     * Validates cancel from IN_REVIEW state (mid-pipeline cancellation).
     */
    it("should cancel an IN_REVIEW task", () => {
      const taskId = createTaskInState(conn, "IN_REVIEW");

      const result = service.cancel(taskId, "operator-1", "Requirements changed");

      expect(result.task.status).toBe("CANCELLED");
    });

    /**
     * Validates that cancel rejects already-terminal tasks.
     */
    it("should reject cancelling an already CANCELLED task", () => {
      const taskId = createTaskInState(conn, "CANCELLED");

      expect(() => service.cancel(taskId, "operator-1", "reason")).toThrow();
    });
  });

  // ─── Change Priority ──────────────────────────────────────────────────

  describe("changePriority", () => {
    /**
     * Validates that priority changes update the task field and create
     * an audit event capturing both old and new priority values.
     * This is important for tracking scheduling decisions.
     */
    it("should update task priority and create audit event", () => {
      const taskId = createTaskInState(conn, "READY", { priority: "medium" });

      const result = service.changePriority(taskId, {
        actorId: "operator-1",
        priority: "critical",
      });

      expect(result.task.priority).toBe("critical");
      expect(result.auditEvent.eventType).toBe("task.operator.change_priority");
      expect(result.auditEvent.actorType).toBe("operator");
    });

    /**
     * Validates that priority can be changed even on terminal tasks
     * (e.g., for record-keeping purposes).
     */
    it("should allow priority change on DONE task", () => {
      const taskId = createTaskInState(conn, "DONE", { priority: "low" });

      const result = service.changePriority(taskId, {
        actorId: "operator-1",
        priority: "high",
      });

      expect(result.task.priority).toBe("high");
    });

    /**
     * Validates that priority change for non-existent task throws.
     */
    it("should throw NotFoundException for unknown task", () => {
      expect(() =>
        service.changePriority("nonexistent", {
          actorId: "op-1",
          priority: "high",
        }),
      ).toThrow(/not found/i);
    });

    /**
     * Validates that audit event records the old priority value.
     */
    it("should record old priority in audit event", () => {
      const taskId = createTaskInState(conn, "READY", { priority: "low" });

      service.changePriority(taskId, {
        actorId: "operator-1",
        priority: "critical",
      });

      const auditRepo = createAuditEventRepository(conn.db);
      const events = auditRepo.findByEntity("task", taskId);
      expect(events.length).toBe(1);
      expect(events[0]!.oldState).toContain("low");
      expect(events[0]!.newState).toContain("critical");
    });
  });

  // ─── Reassign Pool ────────────────────────────────────────────────────

  describe("reassignPool", () => {
    /**
     * Validates that pool reassignment creates an audit event recording
     * the target pool. The actual pool assignment is a metadata annotation
     * since tasks don't have a pool column — the scheduler uses the hint.
     */
    it("should create audit event with pool assignment", () => {
      const taskId = createTaskInState(conn, "READY");

      const result = service.reassignPool(taskId, {
        actorId: "operator-1",
        poolId: "pool-fast-gpu",
        reason: "Task needs GPU workers",
      });

      expect(result.auditEvent.eventType).toBe("task.operator.reassign_pool");
      expect(result.auditEvent.actorType).toBe("operator");
    });

    /**
     * Validates that pool reassignment is rejected for terminal tasks.
     */
    it("should reject reassigning pool for DONE task", () => {
      const taskId = createTaskInState(conn, "DONE");

      expect(() =>
        service.reassignPool(taskId, {
          actorId: "op-1",
          poolId: "pool-1",
          reason: "reason",
        }),
      ).toThrow(/terminal state/i);
    });
  });

  // ─── Rerun Review ─────────────────────────────────────────────────────

  describe("rerunReview", () => {
    /**
     * Validates that rerun-review moves APPROVED tasks back to DEV_COMPLETE.
     * This is an operator override that invalidates the current review
     * and triggers a fresh review cycle.
     */
    it("should move an APPROVED task to DEV_COMPLETE", () => {
      const taskId = createTaskInState(conn, "APPROVED");

      const result = service.rerunReview(taskId, "operator-1", "Review was incomplete");

      expect(result.task.status).toBe("DEV_COMPLETE");
      expect(result.auditEvent.eventType).toBe("task.operator.rerun_review");
    });

    /**
     * Validates that rerun-review works from IN_REVIEW state too.
     */
    it("should move an IN_REVIEW task to DEV_COMPLETE", () => {
      const taskId = createTaskInState(conn, "IN_REVIEW");

      const result = service.rerunReview(taskId, "operator-1", "Wrong reviewer");

      expect(result.task.status).toBe("DEV_COMPLETE");
    });

    /**
     * Validates that rerun-review rejects tasks not in review states.
     */
    it("should reject rerun-review for READY task", () => {
      const taskId = createTaskInState(conn, "READY");

      expect(() => service.rerunReview(taskId, "operator-1", "reason")).toThrow(
        /APPROVED, IN_REVIEW/,
      );
    });
  });

  // ─── Override Merge Order ─────────────────────────────────────────────

  describe("overrideMergeOrder", () => {
    /**
     * Validates that merge order override works for QUEUED_FOR_MERGE tasks
     * with an active merge queue item. This allows operators to prioritize
     * urgent merges.
     */
    it("should update merge queue position and create audit event", () => {
      const mqItemId = randomUUID();
      const taskId = createTaskInState(conn, "QUEUED_FOR_MERGE");

      conn.writeTransaction((db) => {
        const mqRepo = createMergeQueueItemRepository(db);
        mqRepo.create({
          mergeQueueItemId: mqItemId,
          repositoryId: REPO_ID,
          taskId,
          branchName: "feature/test",
          commitSha: "abc123",
          status: "QUEUED",
          position: 5,
        });

        // Link the merge queue item to the task
        const taskRepo = createTaskRepository(db);
        taskRepo.update(taskId, 1, { mergeQueueItemId: mqItemId });
      });

      const result = service.overrideMergeOrder(taskId, {
        actorId: "operator-1",
        position: 1,
        reason: "Urgent hotfix",
      });

      expect(result.auditEvent.eventType).toBe("merge_queue_item.operator.override_order");

      // Verify the merge queue item position was updated
      const mqRepo = createMergeQueueItemRepository(conn.db);
      const updated = mqRepo.findById(mqItemId);
      expect(updated?.position).toBe(1);
    });

    /**
     * Validates that merge order override rejects non-QUEUED_FOR_MERGE tasks.
     */
    it("should reject override for READY task", () => {
      const taskId = createTaskInState(conn, "READY");

      expect(() =>
        service.overrideMergeOrder(taskId, {
          actorId: "op-1",
          position: 1,
        }),
      ).toThrow(/QUEUED_FOR_MERGE/);
    });

    /**
     * Validates rejection when task has no merge queue item.
     */
    it("should reject override when task has no merge queue item", () => {
      const taskId = createTaskInState(conn, "QUEUED_FOR_MERGE");

      expect(() =>
        service.overrideMergeOrder(taskId, {
          actorId: "op-1",
          position: 1,
        }),
      ).toThrow(/no associated merge queue item/i);
    });
  });

  // ─── Reopen ───────────────────────────────────────────────────────────

  describe("reopen", () => {
    /**
     * Validates that reopening a DONE task moves it back to BACKLOG.
     * This is essential for handling tasks that need rework after
     * completion (e.g., production issues found post-merge).
     */
    it("should move a DONE task to BACKLOG", () => {
      const taskId = createTaskInState(conn, "DONE");

      const result = service.reopen(taskId, "operator-1", "Production issue found");

      expect(result.task.status).toBe("BACKLOG");
      expect(result.auditEvent.eventType).toBe("task.operator.reopen");
      expect(result.auditEvent.actorType).toBe("operator");
    });

    /**
     * Validates that reopening works from FAILED state too.
     */
    it("should move a FAILED task to BACKLOG", () => {
      const taskId = createTaskInState(conn, "FAILED");

      const result = service.reopen(taskId, "operator-1", "Retry with different approach");

      expect(result.task.status).toBe("BACKLOG");
    });

    /**
     * Validates that reopening works from CANCELLED state.
     */
    it("should move a CANCELLED task to BACKLOG", () => {
      const taskId = createTaskInState(conn, "CANCELLED");

      const result = service.reopen(taskId, "operator-1", "Requirements clarified");

      expect(result.task.status).toBe("BACKLOG");
    });

    /**
     * Validates that reopening clears terminal-state fields (completedAt,
     * currentLeaseId, etc.) so the task can cleanly re-enter the pipeline.
     */
    it("should clear terminal state fields when reopening", () => {
      const taskId = createTaskInState(conn, "DONE", {
        completedAt: new Date(),
        currentLeaseId: "some-lease",
        currentReviewCycleId: "some-review",
        mergeQueueItemId: "some-mq",
      });

      const result = service.reopen(taskId, "operator-1", "Rework needed");

      expect(result.task.status).toBe("BACKLOG");
      expect(result.task.currentLeaseId).toBeNull();
      expect(result.task.currentReviewCycleId).toBeNull();
      expect(result.task.mergeQueueItemId).toBeNull();
    });

    /**
     * Validates that reopening rejects non-terminal tasks.
     */
    it("should reject reopening a READY task", () => {
      const taskId = createTaskInState(conn, "READY");

      expect(() => service.reopen(taskId, "operator-1", "reason")).toThrow(
        /DONE, FAILED, CANCELLED/,
      );
    });

    /**
     * Validates version increment on reopen (audit trail integrity).
     */
    it("should increment version on reopen", () => {
      const taskId = createTaskInState(conn, "DONE");
      const beforeRepo = createTaskRepository(conn.db);
      const before = beforeRepo.findById(taskId)!;

      const result = service.reopen(taskId, "operator-1", "reason");

      expect(result.task.version).toBe(before.version + 1);
    });
  });

  // ─── Cross-cutting concerns ───────────────────────────────────────────

  describe("audit trail", () => {
    /**
     * Validates that all transition-based actions create audit events
     * that can be queried by entity. This ensures the full operator
     * action history is reconstructible from the audit log.
     */
    it("should create queryable audit events for transitions", () => {
      const taskId = createTaskInState(conn, "READY");

      service.cancel(taskId, "operator-1", "Test cancellation");

      const auditRepo = createAuditEventRepository(conn.db);
      const events = auditRepo.findByEntity("task", taskId);
      expect(events.length).toBeGreaterThanOrEqual(1);

      const cancelEvent = events.find((e) => e.actorId === "operator-1");
      expect(cancelEvent).toBeDefined();
      expect(cancelEvent!.actorType).toBe("operator");
    });

    /**
     * Validates that metadata-only actions (changePriority) also create
     * audit events. This is important because priority changes affect
     * scheduling decisions and need to be traceable.
     */
    it("should create audit event for metadata changes", () => {
      const taskId = createTaskInState(conn, "READY", { priority: "low" });

      service.changePriority(taskId, {
        actorId: "operator-2",
        priority: "critical",
        reason: "Escalated by product",
      });

      const auditRepo = createAuditEventRepository(conn.db);
      const events = auditRepo.findByEntity("task", taskId);
      const priorityEvent = events.find((e) => e.eventType === "task.operator.change_priority");
      expect(priorityEvent).toBeDefined();
      expect(priorityEvent!.actorId).toBe("operator-2");
    });
  });

  // ─── Resolve Escalation ─────────────────────────────────────────────────

  describe("resolveEscalation", () => {
    // --- Retry resolution ---

    /**
     * Validates that retry resolution moves ESCALATED → ASSIGNED.
     * This is the primary path for operators retrying a task after
     * investigating the escalation reason. The task becomes available
     * for worker assignment with a new lease.
     */
    it("should move ESCALATED to ASSIGNED on retry", () => {
      const taskId = createTaskInState(conn, "ESCALATED");

      const result = service.resolveEscalation(taskId, {
        actorId: "operator-1",
        reason: "Root cause identified, retrying",
        resolutionType: "retry",
      });

      expect(result.task.status).toBe("ASSIGNED");
      expect(result.auditEvent.actorType).toBe("operator");
      expect(result.auditEvent.actorId).toBe("operator-1");
    });

    /**
     * Validates that retry audit metadata captures resolution context.
     * The audit trail must clearly show this was an escalation resolution
     * (not just a resume), so operators reviewing history can distinguish
     * between the two.
     */
    it("should record resolve_escalation action in audit metadata on retry", () => {
      const taskId = createTaskInState(conn, "ESCALATED");

      service.resolveEscalation(taskId, {
        actorId: "operator-1",
        reason: "Fixed configuration issue",
        resolutionType: "retry",
      });

      const auditRepo = createAuditEventRepository(conn.db);
      const events = auditRepo.findByEntity("task", taskId);
      const transitionEvent = events.find((e) => e.eventType.includes("transition"));
      expect(transitionEvent).toBeDefined();
      const metadata =
        typeof transitionEvent!.metadataJson === "string"
          ? JSON.parse(transitionEvent!.metadataJson)
          : transitionEvent!.metadataJson;
      expect(metadata.action).toBe("resolve_escalation");
      expect(metadata.resolutionType).toBe("retry");
      expect(metadata.reason).toBe("Fixed configuration issue");
    });

    /**
     * Validates that retry with poolId records pool reassignment.
     * When an operator retries and changes the pool, both the state
     * transition and the pool reassignment must be recorded as audit events.
     */
    it("should record pool reassignment on retry with poolId", () => {
      const taskId = createTaskInState(conn, "ESCALATED");

      const result = service.resolveEscalation(taskId, {
        actorId: "operator-1",
        reason: "Needs different worker type",
        resolutionType: "retry",
        poolId: "specialized-pool",
      });

      expect(result.task.status).toBe("ASSIGNED");

      const auditRepo = createAuditEventRepository(conn.db);
      const events = auditRepo.findByEntity("task", taskId);
      const poolEvent = events.find((e) => e.eventType === "task.operator.reassign_pool");
      expect(poolEvent).toBeDefined();
    });

    // --- Cancel resolution ---

    /**
     * Validates that cancel resolution moves ESCALATED → CANCELLED.
     * This is for tasks that operators decide to abandon after
     * reviewing the escalation. The escalation context is preserved
     * in the audit trail for future reference.
     */
    it("should move ESCALATED to CANCELLED on cancel", () => {
      const taskId = createTaskInState(conn, "ESCALATED");

      const result = service.resolveEscalation(taskId, {
        actorId: "operator-1",
        reason: "Task no longer relevant after priority change",
        resolutionType: "cancel",
      });

      expect(result.task.status).toBe("CANCELLED");
      expect(result.auditEvent.actorType).toBe("operator");
    });

    /**
     * Validates that cancel audit metadata includes resolution context.
     */
    it("should record resolve_escalation action in audit metadata on cancel", () => {
      const taskId = createTaskInState(conn, "ESCALATED");

      service.resolveEscalation(taskId, {
        actorId: "operator-1",
        reason: "Duplicate of another task",
        resolutionType: "cancel",
      });

      const auditRepo = createAuditEventRepository(conn.db);
      const events = auditRepo.findByEntity("task", taskId);
      const transitionEvent = events.find((e) => e.eventType.includes("transition"));
      expect(transitionEvent).toBeDefined();
      const metadata =
        typeof transitionEvent!.metadataJson === "string"
          ? JSON.parse(transitionEvent!.metadataJson)
          : transitionEvent!.metadataJson;
      expect(metadata.action).toBe("resolve_escalation");
      expect(metadata.resolutionType).toBe("cancel");
    });

    // --- Mark done resolution ---

    /**
     * Validates that mark_done resolution moves ESCALATED → DONE.
     * This is the most sensitive resolution type — it bypasses all
     * normal quality gates (review, merge, validation). The audit trail
     * must capture both the reason and evidence of external completion.
     */
    it("should move ESCALATED to DONE on mark_done with evidence", () => {
      const taskId = createTaskInState(conn, "ESCALATED");

      const result = service.resolveEscalation(taskId, {
        actorId: "operator-1",
        reason: "Completed via manual hotfix",
        resolutionType: "mark_done",
        evidence: "Hotfix PR #456 merged, verified in production",
      });

      expect(result.task.status).toBe("DONE");
      expect(result.auditEvent.actorType).toBe("operator");
    });

    /**
     * Validates that mark_done audit metadata includes evidence and
     * elevated audit severity. This is critical for compliance — auditors
     * need to see exactly what evidence was provided for tasks that
     * bypassed the normal quality pipeline.
     */
    it("should record evidence and elevated severity in audit metadata on mark_done", () => {
      const taskId = createTaskInState(conn, "ESCALATED");

      service.resolveEscalation(taskId, {
        actorId: "operator-1",
        reason: "Completed via manual hotfix",
        resolutionType: "mark_done",
        evidence: "Hotfix PR #456 merged, verified in production",
      });

      const auditRepo = createAuditEventRepository(conn.db);
      const events = auditRepo.findByEntity("task", taskId);
      const transitionEvent = events.find((e) => e.eventType.includes("transition"));
      expect(transitionEvent).toBeDefined();
      const metadata =
        typeof transitionEvent!.metadataJson === "string"
          ? JSON.parse(transitionEvent!.metadataJson)
          : transitionEvent!.metadataJson;
      expect(metadata.action).toBe("resolve_escalation");
      expect(metadata.resolutionType).toBe("mark_done");
      expect(metadata.evidence).toBe("Hotfix PR #456 merged, verified in production");
      expect(metadata.auditSeverity).toBe("elevated");
    });

    // --- Error cases ---

    /**
     * Validates that resolve_escalation rejects non-ESCALATED tasks.
     * The guard must prevent operators from applying resolution logic
     * to tasks in other states.
     */
    it("should reject resolve_escalation for non-ESCALATED task", () => {
      const taskId = createTaskInState(conn, "READY");

      expect(() =>
        service.resolveEscalation(taskId, {
          actorId: "operator-1",
          reason: "Trying to resolve",
          resolutionType: "retry",
        }),
      ).toThrow(/ESCALATED/i);
    });

    /**
     * Validates that mark_done is rejected when evidence is missing.
     * The guard enforces this requirement as defense-in-depth beyond
     * the DTO schema validation.
     */
    it("should reject mark_done without evidence", () => {
      const taskId = createTaskInState(conn, "ESCALATED");

      expect(() =>
        service.resolveEscalation(taskId, {
          actorId: "operator-1",
          reason: "Completed externally",
          resolutionType: "mark_done",
        }),
      ).toThrow(/evidence/i);
    });

    /**
     * Validates that resolve_escalation throws for non-existent tasks.
     */
    it("should throw NotFoundException for unknown task", () => {
      expect(() =>
        service.resolveEscalation("nonexistent-id", {
          actorId: "operator-1",
          reason: "reason",
          resolutionType: "retry",
        }),
      ).toThrow(/not found/i);
    });
  });
});
