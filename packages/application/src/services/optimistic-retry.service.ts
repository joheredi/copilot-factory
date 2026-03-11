/**
 * Priority-aware optimistic retry service for task state transitions.
 *
 * Wraps the transition service with conflict resolution priority logic
 * from PRD §10.2.3. When a VersionConflictError occurs, this service
 * determines whether the actor should retry based on its priority level.
 *
 * Retry policy:
 * - OPERATOR priority actors: retry up to `maxRetries` times.
 * - LEASE_EXPIRY priority actors: retry up to `maxRetries` times.
 * - AUTOMATED priority actors: never retry (yield to whoever won).
 *
 * The underlying transition service re-reads the entity within each
 * transaction, so retries automatically pick up the latest version.
 *
 * @see docs/prd/010-integration-contracts.md §10.2.3
 * @see docs/design-decisions/conflict-resolution-priority.md
 * @module @factory/application/services/optimistic-retry.service
 */

import type { TaskStatus, TransitionContext } from "@factory/domain";
import { shouldRetryOnConflict } from "@factory/domain";

import type { TransitionService, TransitionResult } from "./transition.service.js";
import type { TransitionableTask } from "../ports/repository.ports.js";
import type { ActorInfo } from "../events/domain-events.js";
import { VersionConflictError } from "../errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum number of retry attempts for priority-based conflict resolution. */
const DEFAULT_MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for priority-aware task transition.
 */
export interface PriorityTransitionOptions {
  /**
   * Maximum retry attempts on version conflict. Defaults to 3.
   * Set to 0 to disable retries (equivalent to calling transitionTask directly).
   */
  readonly maxRetries?: number;
}

/**
 * Result of a priority-aware transition, extending the base result
 * with information about how many retries were needed.
 */
export interface PriorityTransitionResult {
  /** The transition result (entity + audit event). */
  readonly result: TransitionResult<TransitionableTask>;
  /** Number of retries that were needed (0 = succeeded on first attempt). */
  readonly retriesUsed: number;
}

/**
 * Service interface for priority-aware task transitions.
 *
 * This wraps the base TransitionService with conflict resolution logic
 * that automatically retries for higher-priority actors.
 */
export interface OptimisticRetryService {
  /**
   * Transition a task with priority-aware conflict resolution.
   *
   * If a VersionConflictError occurs and the actor has higher-than-AUTOMATED
   * priority, the service retries the transition (which re-reads the task
   * within the new transaction). If the actor has AUTOMATED priority, the
   * VersionConflictError propagates immediately.
   *
   * After retry, the state machine re-validates the transition. If the
   * competing transition moved the task to a state where the retried
   * transition is no longer valid, an InvalidTransitionError is thrown.
   * This is correct behavior — the competing transition won legitimately.
   *
   * @param taskId - The task to transition.
   * @param targetStatus - The desired target status.
   * @param context - Transition context for state machine guard evaluation.
   * @param actor - The actor proposing the transition.
   * @param metadata - Optional metadata to include in the audit event.
   * @param options - Retry configuration.
   *
   * @throws {VersionConflictError} If retries are exhausted or actor should yield.
   * @throws {EntityNotFoundError} If the task does not exist.
   * @throws {InvalidTransitionError} If the state machine rejects after re-read.
   */
  transitionTaskWithPriority(
    taskId: string,
    targetStatus: TaskStatus,
    context: TransitionContext,
    actor: ActorInfo,
    metadata?: Record<string, unknown>,
    options?: PriorityTransitionOptions,
  ): PriorityTransitionResult;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a priority-aware optimistic retry service.
 *
 * @param transitionService - The base transition service for executing transitions.
 * @returns A service that wraps transitions with priority-based retry logic.
 */
export function createOptimisticRetryService(
  transitionService: TransitionService,
): OptimisticRetryService {
  return {
    transitionTaskWithPriority(
      taskId: string,
      targetStatus: TaskStatus,
      context: TransitionContext,
      actor: ActorInfo,
      metadata?: Record<string, unknown>,
      options?: PriorityTransitionOptions,
    ): PriorityTransitionResult {
      const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
      let retriesUsed = 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = transitionService.transitionTask(
            taskId,
            targetStatus,
            context,
            actor,
            metadata,
          );
          return { result, retriesUsed };
        } catch (error: unknown) {
          if (!(error instanceof VersionConflictError)) {
            // Non-conflict errors propagate immediately
            throw error;
          }

          // Check if this actor should retry based on priority
          if (!shouldRetryOnConflict(actor.type, targetStatus)) {
            // AUTOMATED priority: yield to whoever won the race
            throw error;
          }

          // Higher-priority actor: retry if attempts remain
          if (attempt < maxRetries) {
            retriesUsed++;
            // The transition service re-reads within its transaction,
            // so the next attempt will get fresh data automatically.
            continue;
          }

          // Exhausted retries — propagate the conflict error
          throw error;
        }
      }

      // Unreachable: the loop always exits via return or throw.
      // TypeScript needs this for exhaustive control flow analysis.
      throw new VersionConflictError("Task", taskId, "unknown");
    },
  };
}
