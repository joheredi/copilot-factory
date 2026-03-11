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
