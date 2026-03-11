/** @module @factory/application — Commands, queries, orchestrators, and use cases. */

// Errors
export { EntityNotFoundError, InvalidTransitionError, VersionConflictError } from "./errors.js";

// Ports — repository interfaces
export type {
  TransitionableTask,
  TransitionableTaskLease,
  TransitionableReviewCycle,
  TransitionableMergeQueueItem,
  AuditEventRecord,
  NewAuditEvent,
  TaskRepositoryPort,
  TaskLeaseRepositoryPort,
  ReviewCycleRepositoryPort,
  MergeQueueItemRepositoryPort,
  AuditEventRepositoryPort,
} from "./ports/repository.ports.js";

// Ports — unit of work
export type { TransactionRepositories, UnitOfWork } from "./ports/unit-of-work.port.js";

// Ports — event emitter
export type { DomainEventEmitter } from "./ports/event-emitter.port.js";

// Domain events
export type {
  ActorInfo,
  TaskTransitionedEvent,
  TaskLeaseTransitionedEvent,
  ReviewCycleTransitionedEvent,
  MergeQueueItemTransitionedEvent,
  DomainEvent,
} from "./events/domain-events.js";

// Services
export { createTransitionService } from "./services/transition.service.js";
export type { TransitionResult, TransitionService } from "./services/transition.service.js";
