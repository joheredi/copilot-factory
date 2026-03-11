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
  LeaseNotReclaimableError,
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
  WorkerStatusChangedEvent,
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

// Ports — readiness computation interfaces
export type {
  ReadinessTask,
  ReadinessDependencyEdge,
  ReadinessTaskRepositoryPort,
  ReadinessTaskDependencyRepositoryPort,
  ReadinessTransactionRepositories,
  ReadinessUnitOfWork,
} from "./ports/readiness.ports.js";

// Services — readiness computation based on hard-block dependencies
export { createReadinessService } from "./services/readiness.service.js";
export type {
  BlockingReason,
  ReadinessResultReady,
  ReadinessResultBlocked,
  ReadinessResult,
  ChildBlockingReason,
  ParentReadinessResultComplete,
  ParentReadinessResultIncomplete,
  ParentReadinessResult,
  ReadinessService,
} from "./services/readiness.service.js";

// Ports — reverse-dependency recalculation interfaces
export type {
  ReverseDependencyTask,
  ReverseDependencyEdge,
  ReverseDependencyTaskRepositoryPort,
  ReverseDependencyEdgeRepositoryPort,
  ReverseDependencyTransactionRepositories,
  ReverseDependencyUnitOfWork,
} from "./ports/reverse-dependency.ports.js";

// Services — reverse-dependency recalculation on task completion
export { createReverseDependencyService } from "./services/reverse-dependency.service.js";
export type {
  TransitionedTask,
  SkippedTask,
  RecalculationResult,
  ReverseDependencyService,
} from "./services/reverse-dependency.service.js";

// Ports — worker supervisor interfaces
export type {
  WorkerEntityStatus,
  SupervisedWorker,
  CreateWorkerData,
  UpdateWorkerData,
  WorkerSupervisorRepositoryPort,
  SupervisorWorkspaceLayout,
  SupervisorWorkspaceResult,
  WorkspaceProviderPort,
  SupervisorMountInput,
  PacketMounterPort,
  SupervisorWorkspacePaths,
  SupervisorTimeoutSettings,
  SupervisorOutputSchemaExpectation,
  SupervisorRunContext,
  SupervisorPreparedRun,
  SupervisorRunOutputStream,
  SupervisorCancelResult,
  SupervisorCollectedArtifacts,
  SupervisorRunLogEntry,
  SupervisorRunStatus,
  SupervisorFinalizeResult,
  RuntimeAdapterPort,
  HeartbeatForwarderPort,
  WorkerSupervisorTransactionRepositories,
  WorkerSupervisorUnitOfWork,
} from "./ports/worker-supervisor.ports.js";

// Services — worker supervisor for process lifecycle management
export { createWorkerSupervisorService } from "./services/worker-supervisor.service.js";
export type {
  SpawnWorkerParams,
  SpawnWorkerResult,
  CancelWorkerParams,
  CancelWorkerResult,
  WorkerSupervisorService,
  WorkerSupervisorDependencies,
} from "./services/worker-supervisor.service.js";

// Ports — lease reclaim interfaces
export type {
  ReclaimableLease,
  ReclaimableTask,
  ReclaimLeaseRepositoryPort,
  ReclaimTaskRepositoryPort,
  ReclaimTransactionRepositories,
  ReclaimUnitOfWork,
} from "./ports/lease-reclaim.ports.js";

// Services — lease reclaim with retry/escalation policy
export { createLeaseReclaimService } from "./services/lease-reclaim.service.js";
export type {
  ReclaimReason,
  ReclaimLeaseParams,
  ReclaimOutcome,
  ReclaimLeaseResult,
  LeaseReclaimService,
} from "./services/lease-reclaim.service.js";

// Ports — output validation interfaces
export type {
  WorkerOutputSource,
  OutputValidationContext,
  OutputRejectionReason,
  OutputValidationSuccess,
  OutputValidationFailure,
  OutputValidationResult,
  ExtractionResult,
  ArtifactExistencePort,
  SchemaFailureTrackerPort,
  OutputValidationAuditPort,
  OutputValidatorService,
} from "./ports/output-validator.ports.js";

// Services — structured output capture and validation (PRD 008 §8.14)
export {
  createOutputValidatorService,
  extractPacket,
  validateSchema,
  attemptSchemaRepair,
  verifyIds,
  verifyArtifacts,
  RESULT_PACKET_START_DELIMITER,
  RESULT_PACKET_END_DELIMITER,
  DEFAULT_CONSECUTIVE_FAILURE_THRESHOLD,
} from "./services/output-validator.service.js";
export type {
  OutputValidatorDependencies,
  SchemaValidationResult,
  RepairResult,
} from "./services/output-validator.service.js";

// Ports — validation runner check execution (PRD 009 §9.5)
export type {
  CheckExecutorPort,
  ExecuteCheckParams,
  CheckExecutionResult,
  ValidationCheckOutcome,
  ValidationRunResult,
} from "./ports/validation-runner.ports.js";

// Services — validation runner orchestration (PRD 009 §9.5)
export { createValidationRunnerService } from "./services/validation-runner.service.js";
export type {
  RunValidationParams,
  ValidationRunnerService,
} from "./services/validation-runner.service.js";

// Ports — policy snapshot generation interfaces (PRD 009 §9.2)
export type {
  PolicySnapshotContext,
  ConfigLayerLoaderPort,
  PolicySnapshotArtifactPort,
} from "./ports/policy-snapshot.ports.js";

// Services — policy snapshot generation (PRD 009 §9.2)
export {
  createPolicySnapshotService,
  PolicySnapshotValidationError,
  ConfigLayerLoadError,
} from "./services/policy-snapshot.service.js";
export type {
  GeneratePolicySnapshotResult,
  PolicySnapshotService,
  PolicySnapshotServiceDependencies,
} from "./services/policy-snapshot.service.js";
