/** @module @factory/application — Commands, queries, orchestrators, and use cases. */

// Errors
export {
  EntityNotFoundError,
  InvalidTransitionError,
  VersionConflictError,
  ExclusivityViolationError,
  TaskNotReadyForLeaseError,
} from "./errors.js";

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

// Ports — lease acquisition interfaces
export type {
  LeaseAcquisitionTask,
  ActiveLeaseInfo,
  NewLeaseData,
  CreatedLease,
  LeaseTaskRepositoryPort,
  LeaseRepositoryPort,
  LeaseTransactionRepositories,
  LeaseUnitOfWork,
} from "./ports/lease.ports.js";

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

// Services — transition
export { createTransitionService } from "./services/transition.service.js";
export type { TransitionResult, TransitionService } from "./services/transition.service.js";

// Services — lease acquisition
export { createLeaseService } from "./services/lease.service.js";
export type {
  AcquireLeaseParams,
  LeaseAcquisitionResult,
  LeaseService,
} from "./services/lease.service.js";

// Services — optimistic retry with conflict resolution priority
export { createOptimisticRetryService } from "./services/optimistic-retry.service.js";
export type {
  PriorityTransitionOptions,
  PriorityTransitionResult,
  OptimisticRetryService,
} from "./services/optimistic-retry.service.js";
