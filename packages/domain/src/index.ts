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

export {
  CommandPolicyMode,
  CommandViolationAction,
  CommandViolationReason,
  evaluateCommandPolicy,
  parseCommandString,
} from "./policies/command-policy.js";

export type {
  AllowedCommand,
  DeniedPattern,
  ForbiddenArgPattern,
  CommandPolicy,
  ParsedCommand,
  CommandPolicyEvaluation,
} from "./policies/command-policy.js";

export {
  FileScopeViolationAction,
  FileScopeViolationReason,
  FileScopeRootMatch,
  normalizePath,
  checkReadAccess,
  checkWriteAccess,
  validatePostRunDiff,
} from "./policies/file-scope-policy.js";

export type {
  FileScopePolicy,
  FileScopeEvaluation,
  PostRunDiffValidation,
} from "./policies/file-scope-policy.js";

export {
  ValidationStage,
  ProfileSelectionSource,
  MissingValidationProfileError,
  DEFAULT_DEV_PROFILE_NAME,
  MERGE_GATE_PROFILE_NAME,
  DEFAULT_DEV_PROFILE,
  MERGE_GATE_PROFILE,
  createDefaultValidationPolicy,
  getSystemDefaultProfileName,
  selectProfile,
  getAllChecks,
  getMissingCommands,
} from "./policies/validation-policy.js";

export type {
  ValidationProfile,
  ValidationPolicy,
  ProfileSelectionContext,
  ProfileSelectionResult,
} from "./policies/validation-policy.js";

export {
  BackoffStrategy,
  DEFAULT_RETRY_POLICY,
  calculateBackoff,
  shouldRetry,
  createDefaultRetryPolicy,
} from "./policies/retry-policy.js";

export type {
  RetryPolicy,
  RetryEvaluationContext,
  RetryEvaluation,
} from "./policies/retry-policy.js";

export {
  EscalationTrigger,
  DEFAULT_ESCALATION_POLICY,
  shouldEscalate,
  getTriggerAction,
  getConfiguredTriggers,
  createDefaultEscalationPolicy,
} from "./policies/escalation-policy.js";

export type {
  EscalationTriggerAction,
  EscalationPolicy,
  EscalationEvaluationContext,
  EscalationEvaluation,
} from "./policies/escalation-policy.js";
