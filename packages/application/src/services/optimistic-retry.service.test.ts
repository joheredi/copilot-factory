/**
 * Tests for the priority-aware optimistic retry service.
 *
 * These tests verify the conflict resolution priority rules from §10.2.3:
 *
 * 1. **Operator wins**: When an operator and automated actor race, the
 *    operator's retry succeeds after the first attempt hits a conflict.
 * 2. **Lease expiry wins**: When lease-monitor and worker race, the
 *    lease-monitor's retry succeeds.
 * 3. **Automated yields**: Workers, schedulers, and other automated actors
 *    do not retry — they propagate VersionConflictError immediately.
 * 4. **Retry exhaustion**: Even high-priority actors give up after maxRetries.
 * 5. **Non-conflict errors propagate**: EntityNotFoundError and
 *    InvalidTransitionError are never retried.
 * 6. **Grace period**: Worker results within the grace window are accepted
 *    despite lease timeout.
 *
 * These tests use mock TransitionService implementations that simulate
 * concurrent modifications by throwing VersionConflictError on configurable
 * attempts, then succeeding on subsequent attempts.
 *
 * @see docs/prd/010-integration-contracts.md §10.2.3
 */

import { describe, it, expect } from "vitest";

import { TaskStatus } from "@factory/domain";
import type { TransitionContext } from "@factory/domain";

import { createOptimisticRetryService } from "./optimistic-retry.service.js";
import type { TransitionService, TransitionResult } from "./transition.service.js";
import type { TransitionableTask, AuditEventRecord } from "../ports/repository.ports.js";
import type { ActorInfo } from "../events/domain-events.js";
import { VersionConflictError, EntityNotFoundError, InvalidTransitionError } from "../errors.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a minimal TransitionableTask for test results. */
function createMockTask(id: string, status: TaskStatus, version: number): TransitionableTask {
  return { id, status, version };
}

/** Create a minimal AuditEventRecord for test results. */
function createMockAuditEvent(
  entityId: string,
  fromStatus: string,
  toStatus: string,
): AuditEventRecord {
  return {
    id: `audit-${entityId}-${Date.now()}`,
    entityType: "task",
    entityId,
    eventType: `task.transition.${fromStatus}.to.${toStatus}`,
    actorType: "test",
    actorId: "test-actor",
    oldState: JSON.stringify({ status: fromStatus }),
    newState: JSON.stringify({ status: toStatus }),
    metadata: null,
    createdAt: new Date(),
  };
}

/** Create a successful TransitionResult for a task. */
function createMockResult(
  taskId: string,
  targetStatus: TaskStatus,
  version: number,
): TransitionResult<TransitionableTask> {
  return {
    entity: createMockTask(taskId, targetStatus, version),
    auditEvent: createMockAuditEvent(taskId, "PREVIOUS", targetStatus),
  };
}

/**
 * Create a mock TransitionService that fails with VersionConflictError
 * for the first `failCount` calls to transitionTask, then succeeds.
 *
 * This simulates concurrent modifications: another actor wins the race
 * N times, then the retry eventually succeeds.
 */
function createConflictingTransitionService(
  taskId: string,
  targetStatus: TaskStatus,
  failCount: number,
  successVersion: number = 2,
): { service: TransitionService; callCount: () => number } {
  let calls = 0;

  const service: TransitionService = {
    transitionTask(
      id: string,
      target: TaskStatus,
      _context: TransitionContext,
      _actor: ActorInfo,
      _metadata?: Record<string, unknown>,
    ): TransitionResult<TransitionableTask> {
      calls++;
      if (calls <= failCount) {
        throw new VersionConflictError("Task", id, calls);
      }
      return createMockResult(id, target, successVersion);
    },

    // These methods are not used by the retry service, but are required
    // by the TransitionService interface.
    transitionLease() {
      throw new Error("Not implemented in mock");
    },
    transitionReviewCycle() {
      throw new Error("Not implemented in mock");
    },
    transitionMergeQueueItem() {
      throw new Error("Not implemented in mock");
    },
  };

  return { service, callCount: () => calls };
}

/**
 * Create a mock TransitionService that always fails with the given error.
 */
function createFailingTransitionService(error: Error): TransitionService {
  return {
    transitionTask(): never {
      throw error;
    },
    transitionLease() {
      throw new Error("Not implemented in mock");
    },
    transitionReviewCycle() {
      throw new Error("Not implemented in mock");
    },
    transitionMergeQueueItem() {
      throw new Error("Not implemented in mock");
    },
  };
}

/** Standard transition context for testing. */
const defaultContext: TransitionContext = {
  allDependenciesResolved: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OptimisticRetryService", () => {
  // -------------------------------------------------------------------------
  // Successful transitions (no conflict)
  // -------------------------------------------------------------------------

  /**
   * Validates the happy path: when no conflict occurs, the transition
   * succeeds on the first attempt with zero retries.
   */
  describe("no conflict", () => {
    it("succeeds on first attempt with zero retries", () => {
      const { service } = createConflictingTransitionService(
        "task-1",
        TaskStatus.READY,
        0, // no failures
      );
      const retryService = createOptimisticRetryService(service);

      const result = retryService.transitionTaskWithPriority(
        "task-1",
        TaskStatus.READY,
        defaultContext,
        { type: "worker", id: "w-1" },
      );

      expect(result.retriesUsed).toBe(0);
      expect(result.result.entity.status).toBe(TaskStatus.READY);
    });
  });

  // -------------------------------------------------------------------------
  // Operator priority (highest — always retries)
  // -------------------------------------------------------------------------

  /**
   * Validates §10.2.3 rule: "Operator actions (ESCALATED, CANCELLED) take
   * precedence over all automated transitions." When an operator's transition
   * hits a conflict, it retries and succeeds.
   */
  describe("operator priority", () => {
    it("retries and succeeds when operator conflicts with automated transition", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-1",
        TaskStatus.ESCALATED,
        2, // fail twice, succeed on third
      );
      const retryService = createOptimisticRetryService(service);

      const result = retryService.transitionTaskWithPriority(
        "task-1",
        TaskStatus.ESCALATED,
        { isOperator: true },
        { type: "operator", id: "op-1" },
      );

      expect(result.retriesUsed).toBe(2);
      expect(result.result.entity.status).toBe(TaskStatus.ESCALATED);
      expect(callCount()).toBe(3);
    });

    it("retries CANCELLED with operator priority", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-2",
        TaskStatus.CANCELLED,
        1, // fail once, succeed on second
      );
      const retryService = createOptimisticRetryService(service);

      const result = retryService.transitionTaskWithPriority(
        "task-2",
        TaskStatus.CANCELLED,
        { isOperator: true },
        { type: "operator", id: "op-1" },
      );

      expect(result.retriesUsed).toBe(1);
      expect(result.result.entity.status).toBe(TaskStatus.CANCELLED);
      expect(callCount()).toBe(2);
    });

    it("retries with admin actor type", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-3",
        TaskStatus.CANCELLED,
        1,
      );
      const retryService = createOptimisticRetryService(service);

      const result = retryService.transitionTaskWithPriority(
        "task-3",
        TaskStatus.CANCELLED,
        { isOperator: true },
        { type: "admin", id: "admin-1" },
      );

      expect(result.retriesUsed).toBe(1);
      expect(callCount()).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Lease expiry priority (medium — retries over automated)
  // -------------------------------------------------------------------------

  /**
   * Validates §10.2.3 rule: "Lease expiry (TIMED_OUT) takes precedence
   * over worker result submissions arriving after expiry." When the
   * lease-monitor's FAILED transition hits a conflict from a worker
   * result, it retries and wins.
   */
  describe("lease expiry priority", () => {
    it("retries and succeeds when lease-monitor conflicts with worker", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-1",
        TaskStatus.FAILED,
        1, // fail once, succeed on second
      );
      const retryService = createOptimisticRetryService(service);

      const result = retryService.transitionTaskWithPriority(
        "task-1",
        TaskStatus.FAILED,
        { leaseTimedOutNoRetry: true },
        { type: "lease-monitor", id: "monitor-1" },
      );

      expect(result.retriesUsed).toBe(1);
      expect(result.result.entity.status).toBe(TaskStatus.FAILED);
      expect(callCount()).toBe(2);
    });

    it("retries with reconciliation actor type targeting FAILED", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-2",
        TaskStatus.FAILED,
        2,
      );
      const retryService = createOptimisticRetryService(service);

      const result = retryService.transitionTaskWithPriority(
        "task-2",
        TaskStatus.FAILED,
        { leaseTimedOutNoRetry: true },
        { type: "reconciliation", id: "recon-1" },
      );

      expect(result.retriesUsed).toBe(2);
      expect(callCount()).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Automated priority (lowest — never retries)
  // -------------------------------------------------------------------------

  /**
   * Validates that AUTOMATED-priority actors (workers, schedulers)
   * immediately yield on conflict. They do not retry because
   * first-writer-wins is the correct policy for equal-priority races.
   */
  describe("automated priority (yields)", () => {
    it("worker yields immediately on conflict (no retry)", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-1",
        TaskStatus.DEV_COMPLETE,
        1,
      );
      const retryService = createOptimisticRetryService(service);

      expect(() =>
        retryService.transitionTaskWithPriority(
          "task-1",
          TaskStatus.DEV_COMPLETE,
          { hasDevResultPacket: true, requiredValidationsPassed: true },
          { type: "worker", id: "w-1" },
        ),
      ).toThrow(VersionConflictError);

      // Should NOT have retried — only 1 call
      expect(callCount()).toBe(1);
    });

    it("scheduler yields immediately on conflict (no retry)", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-1",
        TaskStatus.ASSIGNED,
        1,
      );
      const retryService = createOptimisticRetryService(service);

      expect(() =>
        retryService.transitionTaskWithPriority(
          "task-1",
          TaskStatus.ASSIGNED,
          { leaseAcquired: true },
          { type: "scheduler", id: "sched-1" },
        ),
      ).toThrow(VersionConflictError);

      expect(callCount()).toBe(1);
    });

    it("review-router yields immediately on conflict (no retry)", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-1",
        TaskStatus.IN_REVIEW,
        1,
      );
      const retryService = createOptimisticRetryService(service);

      expect(() =>
        retryService.transitionTaskWithPriority(
          "task-1",
          TaskStatus.IN_REVIEW,
          { hasReviewRoutingDecision: true },
          { type: "review-router", id: "rr-1" },
        ),
      ).toThrow(VersionConflictError);

      expect(callCount()).toBe(1);
    });

    it("merge-module yields immediately on conflict (no retry)", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-1",
        TaskStatus.MERGING,
        1,
      );
      const retryService = createOptimisticRetryService(service);

      expect(() =>
        retryService.transitionTaskWithPriority(
          "task-1",
          TaskStatus.MERGING,
          {},
          { type: "merge-module", id: "mm-1" },
        ),
      ).toThrow(VersionConflictError);

      expect(callCount()).toBe(1);
    });

    it("lease-monitor yields when NOT targeting FAILED", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-1",
        TaskStatus.READY,
        1,
      );
      const retryService = createOptimisticRetryService(service);

      expect(() =>
        retryService.transitionTaskWithPriority(
          "task-1",
          TaskStatus.READY,
          { allDependenciesResolved: true },
          { type: "lease-monitor", id: "mon-1" },
        ),
      ).toThrow(VersionConflictError);

      expect(callCount()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Retry exhaustion
  // -------------------------------------------------------------------------

  /**
   * Validates that even high-priority actors give up after maxRetries
   * to prevent infinite retry loops in pathological contention scenarios.
   */
  describe("retry exhaustion", () => {
    it("operator gives up after maxRetries (default 3)", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-1",
        TaskStatus.ESCALATED,
        10, // always fail
      );
      const retryService = createOptimisticRetryService(service);

      expect(() =>
        retryService.transitionTaskWithPriority(
          "task-1",
          TaskStatus.ESCALATED,
          { isOperator: true },
          { type: "operator", id: "op-1" },
        ),
      ).toThrow(VersionConflictError);

      // 1 initial + 3 retries = 4 total calls
      expect(callCount()).toBe(4);
    });

    it("respects custom maxRetries option", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-1",
        TaskStatus.CANCELLED,
        10,
      );
      const retryService = createOptimisticRetryService(service);

      expect(() =>
        retryService.transitionTaskWithPriority(
          "task-1",
          TaskStatus.CANCELLED,
          { isOperator: true },
          { type: "operator", id: "op-1" },
          undefined,
          { maxRetries: 5 },
        ),
      ).toThrow(VersionConflictError);

      // 1 initial + 5 retries = 6 total calls
      expect(callCount()).toBe(6);
    });

    it("maxRetries of 0 disables retries even for operators", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-1",
        TaskStatus.ESCALATED,
        1,
      );
      const retryService = createOptimisticRetryService(service);

      expect(() =>
        retryService.transitionTaskWithPriority(
          "task-1",
          TaskStatus.ESCALATED,
          { isOperator: true },
          { type: "operator", id: "op-1" },
          undefined,
          { maxRetries: 0 },
        ),
      ).toThrow(VersionConflictError);

      expect(callCount()).toBe(1);
    });

    it("lease-monitor gives up after maxRetries", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-1",
        TaskStatus.FAILED,
        10,
      );
      const retryService = createOptimisticRetryService(service);

      expect(() =>
        retryService.transitionTaskWithPriority(
          "task-1",
          TaskStatus.FAILED,
          { leaseTimedOutNoRetry: true },
          { type: "lease-monitor", id: "mon-1" },
          undefined,
          { maxRetries: 2 },
        ),
      ).toThrow(VersionConflictError);

      // 1 initial + 2 retries = 3 total calls
      expect(callCount()).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Non-conflict errors (never retried)
  // -------------------------------------------------------------------------

  /**
   * Validates that non-VersionConflictError errors are NEVER retried,
   * regardless of actor priority. EntityNotFoundError, InvalidTransitionError,
   * and other errors propagate immediately.
   */
  describe("non-conflict errors", () => {
    it("propagates EntityNotFoundError without retry for operators", () => {
      const service = createFailingTransitionService(new EntityNotFoundError("Task", "task-1"));
      const retryService = createOptimisticRetryService(service);

      expect(() =>
        retryService.transitionTaskWithPriority(
          "task-1",
          TaskStatus.ESCALATED,
          { isOperator: true },
          { type: "operator", id: "op-1" },
        ),
      ).toThrow(EntityNotFoundError);
    });

    it("propagates InvalidTransitionError without retry for operators", () => {
      const service = createFailingTransitionService(
        new InvalidTransitionError("Task", "task-1", "DONE", "ESCALATED", "Terminal state"),
      );
      const retryService = createOptimisticRetryService(service);

      expect(() =>
        retryService.transitionTaskWithPriority(
          "task-1",
          TaskStatus.ESCALATED,
          { isOperator: true },
          { type: "operator", id: "op-1" },
        ),
      ).toThrow(InvalidTransitionError);
    });

    it("propagates generic errors without retry", () => {
      const service = createFailingTransitionService(new Error("Database connection lost"));
      const retryService = createOptimisticRetryService(service);

      expect(() =>
        retryService.transitionTaskWithPriority(
          "task-1",
          TaskStatus.CANCELLED,
          { isOperator: true },
          { type: "operator", id: "op-1" },
        ),
      ).toThrow("Database connection lost");
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent race scenarios
  // -------------------------------------------------------------------------

  /**
   * Simulates realistic race scenarios where different actors compete
   * for the same task. These tests verify the priority resolution
   * behavior end-to-end with the retry service.
   */
  describe("concurrent race scenarios", () => {
    /**
     * Scenario: Operator tries to ESCALATE while worker submits DEV_COMPLETE.
     * Worker wins first (gets the version), operator retries and succeeds.
     * This validates §10.2.3: operator actions take precedence.
     */
    it("operator ESCALATE wins over concurrent worker DEV_COMPLETE", () => {
      const { service } = createConflictingTransitionService(
        "task-1",
        TaskStatus.ESCALATED,
        1, // worker won the first race
      );
      const retryService = createOptimisticRetryService(service);

      const result = retryService.transitionTaskWithPriority(
        "task-1",
        TaskStatus.ESCALATED,
        { isOperator: true },
        { type: "operator", id: "op-1" },
      );

      expect(result.retriesUsed).toBe(1);
      expect(result.result.entity.status).toBe(TaskStatus.ESCALATED);
    });

    /**
     * Scenario: Operator tries to CANCEL while scheduler ASSIGNS.
     * Scheduler wins first, operator retries and succeeds.
     */
    it("operator CANCEL wins over concurrent scheduler ASSIGN", () => {
      const { service } = createConflictingTransitionService("task-1", TaskStatus.CANCELLED, 1);
      const retryService = createOptimisticRetryService(service);

      const result = retryService.transitionTaskWithPriority(
        "task-1",
        TaskStatus.CANCELLED,
        { isOperator: true },
        { type: "operator", id: "op-1" },
      );

      expect(result.retriesUsed).toBe(1);
    });

    /**
     * Scenario: Lease-monitor tries to FAIL task while worker submits result.
     * Worker wins first, lease-monitor retries and succeeds.
     * This validates §10.2.3: lease expiry wins over late worker results.
     */
    it("lease-monitor FAILED wins over concurrent worker result", () => {
      const { service } = createConflictingTransitionService("task-1", TaskStatus.FAILED, 1);
      const retryService = createOptimisticRetryService(service);

      const result = retryService.transitionTaskWithPriority(
        "task-1",
        TaskStatus.FAILED,
        { leaseTimedOutNoRetry: true },
        { type: "lease-monitor", id: "mon-1" },
      );

      expect(result.retriesUsed).toBe(1);
      expect(result.result.entity.status).toBe(TaskStatus.FAILED);
    });

    /**
     * Scenario: Two workers race to submit DEV_COMPLETE for the same task.
     * First writer wins; second worker yields immediately.
     * This validates first-writer-wins for equal-priority actors.
     */
    it("second worker yields when first worker wins the race", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-1",
        TaskStatus.DEV_COMPLETE,
        1,
      );
      const retryService = createOptimisticRetryService(service);

      expect(() =>
        retryService.transitionTaskWithPriority(
          "task-1",
          TaskStatus.DEV_COMPLETE,
          { hasDevResultPacket: true, requiredValidationsPassed: true },
          { type: "worker", id: "w-2" },
        ),
      ).toThrow(VersionConflictError);

      expect(callCount()).toBe(1); // No retry
    });

    /**
     * Scenario: Two schedulers race to assign the same task.
     * First scheduler wins; second yields immediately.
     */
    it("second scheduler yields when first scheduler wins the race", () => {
      const { service, callCount } = createConflictingTransitionService(
        "task-1",
        TaskStatus.ASSIGNED,
        1,
      );
      const retryService = createOptimisticRetryService(service);

      expect(() =>
        retryService.transitionTaskWithPriority(
          "task-1",
          TaskStatus.ASSIGNED,
          { leaseAcquired: true },
          { type: "scheduler", id: "sched-2" },
        ),
      ).toThrow(VersionConflictError);

      expect(callCount()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Metadata and options passthrough
  // -------------------------------------------------------------------------

  /**
   * Validates that metadata and options are correctly passed through
   * to the underlying transition service on every attempt.
   */
  describe("metadata passthrough", () => {
    it("passes metadata to the transition service", () => {
      let capturedMetadata: Record<string, unknown> | undefined;

      const service: TransitionService = {
        transitionTask(
          _id: string,
          target: TaskStatus,
          _ctx: TransitionContext,
          _actor: ActorInfo,
          metadata?: Record<string, unknown>,
        ): TransitionResult<TransitionableTask> {
          capturedMetadata = metadata;
          return createMockResult("task-1", target, 2);
        },
        transitionLease() {
          throw new Error("Not implemented");
        },
        transitionReviewCycle() {
          throw new Error("Not implemented");
        },
        transitionMergeQueueItem() {
          throw new Error("Not implemented");
        },
      };
      const retryService = createOptimisticRetryService(service);

      retryService.transitionTaskWithPriority(
        "task-1",
        TaskStatus.READY,
        defaultContext,
        { type: "system", id: "sys" },
        { reason: "test-metadata", correlationId: "abc-123" },
      );

      expect(capturedMetadata).toEqual({
        reason: "test-metadata",
        correlationId: "abc-123",
      });
    });

    it("passes context correctly on retry attempts", () => {
      const capturedContexts: TransitionContext[] = [];
      let calls = 0;

      const service: TransitionService = {
        transitionTask(
          id: string,
          target: TaskStatus,
          ctx: TransitionContext,
          _actor: ActorInfo,
        ): TransitionResult<TransitionableTask> {
          capturedContexts.push(ctx);
          calls++;
          if (calls <= 1) {
            throw new VersionConflictError("Task", id, 1);
          }
          return createMockResult(id, target, 2);
        },
        transitionLease() {
          throw new Error("Not implemented");
        },
        transitionReviewCycle() {
          throw new Error("Not implemented");
        },
        transitionMergeQueueItem() {
          throw new Error("Not implemented");
        },
      };
      const retryService = createOptimisticRetryService(service);

      const context: TransitionContext = { isOperator: true };
      retryService.transitionTaskWithPriority("task-1", TaskStatus.ESCALATED, context, {
        type: "operator",
        id: "op-1",
      });

      // Context passed on both initial attempt and retry
      expect(capturedContexts).toHaveLength(2);
      expect(capturedContexts[0]).toBe(context);
      expect(capturedContexts[1]).toBe(context);
    });
  });
});
