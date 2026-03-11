/** @module @factory/application — Commands, queries, orchestrators, and use cases. */

// Errors
export {
  EntityNotFoundError,
  InvalidTransitionError,
  VersionConflictError,
  ExclusivityViolationError,
  TaskNotReadyForLeaseError,
  LeaseNotActiveError,
  CyclicDependencyError,
  DuplicateDependencyError,
  SelfDependencyError,
  LeaseNotAcceptingResultsError,
  GracePeriodExpiredError,
  WorkerMismatchError,
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

// Ports — job queue interfaces
export type {
  QueuedJob,
  CreateJobData,
  JobQueueRepositoryPort,
  JobQueueTransactionRepositories,
  JobQueueUnitOfWork,
} from "./ports/job-queue.ports.js";

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

// Services — job queue
export { createJobQueueService } from "./services/job-queue.service.js";
export type {
  CreateJobResult,
  ClaimJobResult,
  CompleteJobResult,
  FailJobResult,
  StartJobResult,
  AreJobDependenciesMetResult,
  FindJobsByGroupResult,
  JobQueueService,
} from "./services/job-queue.service.js";

// Ports — dependency management interfaces
export type {
  DependencyEdge,
  NewDependencyEdge,
  DependencyTaskRepositoryPort,
  TaskDependencyRepositoryPort,
  DependencyTransactionRepositories,
  DependencyUnitOfWork,
} from "./ports/dependency.ports.js";

// Services — dependency graph management with DAG validation
export { createDependencyService } from "./services/dependency.service.js";
export type {
  AddDependencyParams,
  AddDependencyResult,
  RemoveDependencyResult,
  GetDependenciesResult,
  GetDependentsResult,
  DependencyService,
} from "./services/dependency.service.js";

// Services — optimistic retry with conflict resolution priority
export { createOptimisticRetryService } from "./services/optimistic-retry.service.js";
export type {
  PriorityTransitionOptions,
  PriorityTransitionResult,
  OptimisticRetryService,
} from "./services/optimistic-retry.service.js";

// Ports — scheduler interfaces
export type {
  SchedulableTask,
  SchedulablePool,
  SchedulerTaskRepositoryPort,
  SchedulerPoolRepositoryPort,
  SchedulerTransactionRepositories,
  SchedulerUnitOfWork,
} from "./ports/scheduler.ports.js";

// Services — scheduler for task-to-worker assignment
export { createSchedulerService } from "./services/scheduler.service.js";
export {
  isPoolCompatible,
  hasPoolCapacity,
  selectBestPool,
  comparePriority,
} from "./services/scheduler.service.js";
export type {
  ScheduleAssignmentResult,
  ScheduleSkipReason,
  ScheduleNoAssignmentResult,
  ScheduleSuccessResult,
  ScheduleResult,
  SchedulerService,
} from "./services/scheduler.service.js";

// Ports — heartbeat reception and staleness detection interfaces
export type {
  HeartbeatableLease,
  StaleLeaseRecord,
  HeartbeatLeaseRepositoryPort,
  HeartbeatTransactionRepositories,
  HeartbeatUnitOfWork,
} from "./ports/heartbeat.ports.js";

// Services — heartbeat reception and staleness detection
export { createHeartbeatService } from "./services/heartbeat.service.js";
export type {
  ReceiveHeartbeatParams,
  ReceiveHeartbeatResult,
  StalenessPolicy,
  StalenessReason,
  StaleLeaseInfo,
  DetectStaleLeasesResult,
  HeartbeatService,
} from "./services/heartbeat.service.js";

// Ports — graceful completion interfaces
export type {
  CompletionLease,
  CompletionLeaseRepositoryPort,
  CompletionTransactionRepositories,
  CompletionUnitOfWork,
} from "./ports/graceful-completion.ports.js";

// Services — graceful completion with grace period result acceptance
export {
  createGracefulCompletionService,
  computeGraceDeadline,
} from "./services/graceful-completion.service.js";
export type {
  AcceptResultParams,
  AcceptResultResult,
  GracefulCompletionService,
} from "./services/graceful-completion.service.js";
