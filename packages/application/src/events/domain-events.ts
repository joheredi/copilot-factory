/**
 * Domain event types emitted by the transition service.
 *
 * These events are published after a state transition commits successfully.
 * Downstream consumers (scheduler, notification service, metrics, etc.)
 * subscribe to these events to trigger side effects.
 *
 * Each event carries enough context for subscribers to act without
 * needing to re-query the database in most cases.
 *
 * @module @factory/application/events/domain-events
 */

import type {
  TaskStatus,
  WorkerLeaseStatus,
  ReviewCycleStatus,
  MergeQueueItemStatus,
} from "@factory/domain";

/**
 * Information about the actor who triggered the transition.
 */
export interface ActorInfo {
  /** Actor type: 'system', 'operator', 'worker', or a module identifier. */
  readonly type: string;
  /** Unique identifier for the actor (e.g., worker ID, operator user ID). */
  readonly id: string;
}

/**
 * Base fields shared by all domain events.
 */
interface BaseDomainEvent {
  /** Discriminator for event type routing. */
  readonly type: string;
  /** Entity type that was transitioned. */
  readonly entityType: string;
  /** ID of the entity that was transitioned. */
  readonly entityId: string;
  /** Who triggered the transition. */
  readonly actor: ActorInfo;
  /** When the event was emitted (after commit). */
  readonly timestamp: Date;
}

/**
 * Emitted when a task transitions to a new status.
 */
export interface TaskTransitionedEvent extends BaseDomainEvent {
  readonly type: "task.transitioned";
  readonly entityType: "task";
  readonly fromStatus: TaskStatus;
  readonly toStatus: TaskStatus;
  readonly newVersion: number;
}

/**
 * Emitted when a task lease transitions to a new status.
 */
export interface TaskLeaseTransitionedEvent extends BaseDomainEvent {
  readonly type: "task-lease.transitioned";
  readonly entityType: "task-lease";
  readonly fromStatus: WorkerLeaseStatus;
  readonly toStatus: WorkerLeaseStatus;
}

/**
 * Emitted when a review cycle transitions to a new status.
 */
export interface ReviewCycleTransitionedEvent extends BaseDomainEvent {
  readonly type: "review-cycle.transitioned";
  readonly entityType: "review-cycle";
  readonly fromStatus: ReviewCycleStatus;
  readonly toStatus: ReviewCycleStatus;
}

/**
 * Emitted when a merge queue item transitions to a new status.
 */
export interface MergeQueueItemTransitionedEvent extends BaseDomainEvent {
  readonly type: "merge-queue-item.transitioned";
  readonly entityType: "merge-queue-item";
  readonly fromStatus: MergeQueueItemStatus;
  readonly toStatus: MergeQueueItemStatus;
}

/**
 * Union of all domain events the transition service can emit.
 */
export type DomainEvent =
  | TaskTransitionedEvent
  | TaskLeaseTransitionedEvent
  | ReviewCycleTransitionedEvent
  | MergeQueueItemTransitionedEvent;
