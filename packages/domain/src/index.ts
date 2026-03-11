/** @module @factory/domain — Entities, value objects, enums, invariants, and state machines. */
export {
  TaskStatus,
  TaskType,
  TaskPriority,
  TaskSource,
  EstimatedSize,
  RiskLevel,
  WorkerLeaseStatus,
  ReviewCycleStatus,
  MergeQueueItemStatus,
  DependencyType,
  WorkerPoolType,
  JobType,
  JobStatus,
  ValidationRunScope,
  ValidationRunStatus,
  ValidationCheckType,
  ValidationCheckStatus,
  PacketType,
  PacketStatus,
  FileChangeType,
  IssueSeverity,
  ReviewVerdict,
  LeadReviewDecision,
  MergeStrategy,
  MergeAssistRecommendation,
  PostMergeAnalysisRecommendation,
  Confidence,
  AgentRole,
  FileScopeEnforcementLevel,
  EscalationAction,
} from "./enums.js";

export {
  validateTransition,
  getValidTargets,
  isTerminalState,
  getAllValidTransitions,
} from "./state-machines/task-state-machine.js";

export type { TransitionContext, TransitionResult } from "./state-machines/task-state-machine.js";

export {
  validateWorkerLeaseTransition,
  getValidWorkerLeaseTargets,
  isTerminalWorkerLeaseState,
  getAllValidWorkerLeaseTransitions,
} from "./state-machines/worker-lease-state-machine.js";

export type {
  WorkerLeaseTransitionContext,
  WorkerLeaseTransitionResult,
} from "./state-machines/worker-lease-state-machine.js";

export {
  validateReviewCycleTransition,
  getValidReviewCycleTargets,
  isTerminalReviewCycleState,
  getAllValidReviewCycleTransitions,
} from "./state-machines/review-cycle-state-machine.js";

export type {
  ReviewCycleTransitionContext,
  ReviewCycleTransitionResult,
} from "./state-machines/review-cycle-state-machine.js";

export {
  validateMergeQueueItemTransition,
  getValidMergeQueueItemTargets,
  isTerminalMergeQueueItemState,
  getAllValidMergeQueueItemTransitions,
} from "./state-machines/merge-queue-item-state-machine.js";

export type {
  MergeQueueItemTransitionContext,
  MergeQueueItemTransitionResult,
} from "./state-machines/merge-queue-item-state-machine.js";

export {
  ConflictPriority,
  getConflictPriority,
  shouldRetryOnConflict,
  isWithinGracePeriod,
} from "./conflict-priority.js";
