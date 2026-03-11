/**
 * Core domain enumerations for the Autonomous Software Factory.
 *
 * Every enum is defined as an `as const` object with a derived union type.
 * This gives both runtime-accessible values (for iteration and validation)
 * and full TypeScript type safety (for compile-time checking).
 *
 * All values are sourced from the authoritative PRD specifications:
 * - {@link file://docs/prd/002-data-model.md} — state machines and entity fields
 * - {@link file://docs/prd/008-packet-and-schema-spec.md} — packet types and shared types
 *
 * @module @factory/domain/enums
 */

// ─── Task Lifecycle (PRD 002 §2.1) ─────────────────────────────────────────

/**
 * Task state machine states.
 *
 * The task lifecycle progresses from BACKLOG through development, review,
 * merge, and post-merge validation to DONE. Tasks may also reach terminal
 * states FAILED, ESCALATED, or CANCELLED from most other states.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.1 Task State Machine
 */
export const TaskStatus = {
  BACKLOG: "BACKLOG",
  READY: "READY",
  BLOCKED: "BLOCKED",
  ASSIGNED: "ASSIGNED",
  IN_DEVELOPMENT: "IN_DEVELOPMENT",
  DEV_COMPLETE: "DEV_COMPLETE",
  IN_REVIEW: "IN_REVIEW",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  APPROVED: "APPROVED",
  QUEUED_FOR_MERGE: "QUEUED_FOR_MERGE",
  MERGING: "MERGING",
  POST_MERGE_VALIDATION: "POST_MERGE_VALIDATION",
  DONE: "DONE",
  FAILED: "FAILED",
  ESCALATED: "ESCALATED",
  CANCELLED: "CANCELLED",
} as const;

/** Union of all valid task status values. */
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

// ─── Worker Lease Lifecycle (PRD 002 §2.2) ──────────────────────────────────

/**
 * Worker lease state machine states.
 *
 * Tracks the lifecycle of a worker's lease on a task, from idle through
 * active execution to terminal states (completing, timed out, crashed,
 * or reclaimed).
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.2 Worker Lease State
 */
export const WorkerLeaseStatus = {
  IDLE: "IDLE",
  LEASED: "LEASED",
  STARTING: "STARTING",
  RUNNING: "RUNNING",
  HEARTBEATING: "HEARTBEATING",
  COMPLETING: "COMPLETING",
  TIMED_OUT: "TIMED_OUT",
  CRASHED: "CRASHED",
  RECLAIMED: "RECLAIMED",
} as const;

/** Union of all valid worker lease status values. */
export type WorkerLeaseStatus = (typeof WorkerLeaseStatus)[keyof typeof WorkerLeaseStatus];

// ─── Review Cycle Lifecycle (PRD 002 §2.2) ──────────────────────────────────

/**
 * Review cycle state machine states.
 *
 * Tracks the lifecycle of a review cycle from routing specialist reviewers
 * through consolidation to a final decision. Each rework cycle creates a
 * new ReviewCycle instance.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.2 Review Cycle State
 */
export const ReviewCycleStatus = {
  NOT_STARTED: "NOT_STARTED",
  ROUTED: "ROUTED",
  IN_PROGRESS: "IN_PROGRESS",
  AWAITING_REQUIRED_REVIEWS: "AWAITING_REQUIRED_REVIEWS",
  CONSOLIDATING: "CONSOLIDATING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  ESCALATED: "ESCALATED",
} as const;

/** Union of all valid review cycle status values. */
export type ReviewCycleStatus = (typeof ReviewCycleStatus)[keyof typeof ReviewCycleStatus];

// ─── Merge Queue Lifecycle (PRD 002 §2.2) ───────────────────────────────────

/**
 * Merge queue item state machine states.
 *
 * Tracks the lifecycle of a merge queue entry from enqueueing through
 * rebase, validation, and merge to terminal states.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.2 Merge Queue Item State
 */
export const MergeQueueItemStatus = {
  ENQUEUED: "ENQUEUED",
  PREPARING: "PREPARING",
  REBASING: "REBASING",
  VALIDATING: "VALIDATING",
  MERGING: "MERGING",
  MERGED: "MERGED",
  REQUEUED: "REQUEUED",
  FAILED: "FAILED",
} as const;

/** Union of all valid merge queue item status values. */
export type MergeQueueItemStatus = (typeof MergeQueueItemStatus)[keyof typeof MergeQueueItemStatus];

// ─── Dependencies (PRD 002 §2.3) ────────────────────────────────────────────

/**
 * Task dependency type values.
 *
 * - `blocks`: target task readiness is affected (hard-block when `is_hard_block` is true)
 * - `relates_to`: informational link; does not affect readiness computation
 * - `parent_child`: hierarchical grouping; parent cannot reach DONE until all
 *   children are DONE or CANCELLED
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: TaskDependency
 */
export const DependencyType = {
  BLOCKS: "blocks",
  RELATES_TO: "relates_to",
  PARENT_CHILD: "parent_child",
} as const;

/** Union of all valid dependency type values. */
export type DependencyType = (typeof DependencyType)[keyof typeof DependencyType];

// ─── Worker Pools (PRD 002 §2.3) ────────────────────────────────────────────

/**
 * Worker pool type values.
 *
 * Each pool is specialized for a particular agent role in the factory.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: WorkerPool
 */
export const WorkerPoolType = {
  DEVELOPER: "developer",
  REVIEWER: "reviewer",
  LEAD_REVIEWER: "lead-reviewer",
  MERGE_ASSIST: "merge-assist",
  PLANNER: "planner",
} as const;

/** Union of all valid worker pool type values. */
export type WorkerPoolType = (typeof WorkerPoolType)[keyof typeof WorkerPoolType];

// ─── Job System (PRD 002 §2.3) ──────────────────────────────────────────────

/**
 * Job type values for the DB-backed job queue.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: Job
 * @see {@link file://docs/prd/007-technical-architecture.md} §7.8 Queue / Job Architecture
 */
export const JobType = {
  SCHEDULER_TICK: "scheduler_tick",
  WORKER_DISPATCH: "worker_dispatch",
  REVIEWER_DISPATCH: "reviewer_dispatch",
  LEAD_REVIEW_CONSOLIDATION: "lead_review_consolidation",
  MERGE_DISPATCH: "merge_dispatch",
  VALIDATION_EXECUTION: "validation_execution",
  RECONCILIATION_SWEEP: "reconciliation_sweep",
  CLEANUP: "cleanup",
} as const;

/** Union of all valid job type values. */
export type JobType = (typeof JobType)[keyof typeof JobType];

/**
 * Job status values for the DB-backed job queue.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: Job
 */
export const JobStatus = {
  PENDING: "pending",
  CLAIMED: "claimed",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

/** Union of all valid job status values. */
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

// ─── Validation (PRD 002 §2.3, PRD 008 §8.3.3, §8.10) ─────────────────────

/**
 * Validation run scope values.
 *
 * Defines when in the task lifecycle a validation run occurs.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: ValidationRun
 */
export const ValidationRunScope = {
  PRE_DEV: "pre-dev",
  DURING_DEV: "during-dev",
  PRE_REVIEW: "pre-review",
  PRE_MERGE: "pre-merge",
  POST_MERGE: "post-merge",
} as const;

/** Union of all valid validation run scope values. */
export type ValidationRunScope = (typeof ValidationRunScope)[keyof typeof ValidationRunScope];

/**
 * Validation check type values.
 *
 * Categorizes the kind of validation check performed.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.3.3 ValidationCheckResult
 */
export const ValidationCheckType = {
  TEST: "test",
  LINT: "lint",
  BUILD: "build",
  TYPECHECK: "typecheck",
  POLICY: "policy",
  SCHEMA: "schema",
  SECURITY: "security",
} as const;

/** Union of all valid validation check type values. */
export type ValidationCheckType = (typeof ValidationCheckType)[keyof typeof ValidationCheckType];

/**
 * Validation check status values.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.3.3 ValidationCheckResult
 */
export const ValidationCheckStatus = {
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;

/** Union of all valid validation check status values. */
export type ValidationCheckStatus =
  (typeof ValidationCheckStatus)[keyof typeof ValidationCheckStatus];

// ─── Packet System (PRD 008 §8.2–§8.11) ─────────────────────────────────────

/**
 * Packet type identifiers for all artifact-based handoff packets.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4–§8.11
 */
export const PacketType = {
  TASK_PACKET: "task_packet",
  DEV_RESULT_PACKET: "dev_result_packet",
  REVIEW_PACKET: "review_packet",
  LEAD_REVIEW_DECISION_PACKET: "lead_review_decision_packet",
  MERGE_PACKET: "merge_packet",
  MERGE_ASSIST_PACKET: "merge_assist_packet",
  VALIDATION_RESULT_PACKET: "validation_result_packet",
  POST_MERGE_ANALYSIS_PACKET: "post_merge_analysis_packet",
} as const;

/** Union of all valid packet type values. */
export type PacketType = (typeof PacketType)[keyof typeof PacketType];

/**
 * Packet-level execution status values.
 *
 * Task state remains owned by the orchestrator and must not be inferred
 * directly from packet status.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.2.3 Status Semantics
 */
export const PacketStatus = {
  SUCCESS: "success",
  FAILED: "failed",
  PARTIAL: "partial",
  BLOCKED: "blocked",
} as const;

/** Union of all valid packet status values. */
export type PacketStatus = (typeof PacketStatus)[keyof typeof PacketStatus];

// ─── File Changes (PRD 008 §8.3.1) ──────────────────────────────────────────

/**
 * File change type values for FileChangeSummary entries.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.3.1 FileChangeSummary
 */
export const FileChangeType = {
  ADDED: "added",
  MODIFIED: "modified",
  DELETED: "deleted",
  RENAMED: "renamed",
} as const;

/** Union of all valid file change type values. */
export type FileChangeType = (typeof FileChangeType)[keyof typeof FileChangeType];

// ─── Issues (PRD 008 §8.3.2) ────────────────────────────────────────────────

/**
 * Issue severity levels.
 *
 * Used in review packets and lead review decision packets to classify
 * the severity of identified issues.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.3.2 Issue
 */
export const IssueSeverity = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

/** Union of all valid issue severity values. */
export type IssueSeverity = (typeof IssueSeverity)[keyof typeof IssueSeverity];

// ─── Review & Decision (PRD 008 §8.6–§8.7) ──────────────────────────────────

/**
 * Specialist reviewer verdict values.
 *
 * - `approved`: no blocking issues found
 * - `changes_requested`: blocking issues require rework
 * - `escalated`: reviewer recommends escalation to operator
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.6.3 Rules
 */
export const ReviewVerdict = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  ESCALATED: "escalated",
} as const;

/** Union of all valid review verdict values. */
export type ReviewVerdict = (typeof ReviewVerdict)[keyof typeof ReviewVerdict];

/**
 * Lead reviewer decision values.
 *
 * - `approved`: no blockers remain; task proceeds to merge
 * - `approved_with_follow_up`: approved but follow-up tasks required
 * - `changes_requested`: blocking issues require rework (must have at least one blocking issue)
 * - `escalated`: lead reviewer recommends escalation to operator
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.7.3 Rules
 */
export const LeadReviewDecision = {
  APPROVED: "approved",
  APPROVED_WITH_FOLLOW_UP: "approved_with_follow_up",
  CHANGES_REQUESTED: "changes_requested",
  ESCALATED: "escalated",
} as const;

/** Union of all valid lead review decision values. */
export type LeadReviewDecision = (typeof LeadReviewDecision)[keyof typeof LeadReviewDecision];

// ─── Merge (PRD 008 §8.8–§8.9) ──────────────────────────────────────────────

/**
 * Merge strategy values.
 *
 * Defines how approved changes are integrated into the target branch.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.8 MergePacket
 * @see {@link file://docs/prd/007-technical-architecture.md} §7.6 Merge Module
 */
export const MergeStrategy = {
  REBASE_AND_MERGE: "rebase-and-merge",
  SQUASH: "squash",
  MERGE_COMMIT: "merge-commit",
} as const;

/** Union of all valid merge strategy values. */
export type MergeStrategy = (typeof MergeStrategy)[keyof typeof MergeStrategy];

/**
 * Merge assist agent recommendation values.
 *
 * - `auto_resolve`: conflicts can be safely auto-resolved
 * - `reject_to_dev`: conflicts should be sent back to developer for rework
 * - `escalate`: conflicts require operator intervention
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.9.3 Rules
 */
export const MergeAssistRecommendation = {
  AUTO_RESOLVE: "auto_resolve",
  REJECT_TO_DEV: "reject_to_dev",
  ESCALATE: "escalate",
} as const;

/** Union of all valid merge assist recommendation values. */
export type MergeAssistRecommendation =
  (typeof MergeAssistRecommendation)[keyof typeof MergeAssistRecommendation];

// ─── Post-Merge Analysis (PRD 008 §8.11) ────────────────────────────────────

/**
 * Post-merge analysis agent recommendation values.
 *
 * - `revert`: merged change should be reverted
 * - `hotfix_task`: a targeted fix task should be created
 * - `escalate`: operator intervention required
 * - `pre_existing`: failure was pre-existing, not caused by this merge
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.11.3 Rules
 */
export const PostMergeAnalysisRecommendation = {
  REVERT: "revert",
  HOTFIX_TASK: "hotfix_task",
  ESCALATE: "escalate",
  PRE_EXISTING: "pre_existing",
} as const;

/** Union of all valid post-merge analysis recommendation values. */
export type PostMergeAnalysisRecommendation =
  (typeof PostMergeAnalysisRecommendation)[keyof typeof PostMergeAnalysisRecommendation];

// ─── Confidence (PRD 008 §8.9.3, §8.11.3) ──────────────────────────────────

/**
 * Confidence level values used in merge assist and post-merge analysis packets.
 *
 * When confidence is `low`, certain recommendations are restricted:
 * - MergeAssistPacket: must recommend `reject_to_dev` or `escalate`
 * - PostMergeAnalysisPacket: must recommend `escalate`
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.9.3, §8.11.3
 */
export const Confidence = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

/** Union of all valid confidence level values. */
export type Confidence = (typeof Confidence)[keyof typeof Confidence];

// ─── Agent Roles (PRD 008 §8.4.3) ───────────────────────────────────────────

/**
 * Agent role values for task packet assignment.
 *
 * Determines which type of agent receives a task packet.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4.3 Required Top-Level Fields
 * @see {@link file://docs/prd/004-agent-contracts.md} §4.4–§4.9
 */
export const AgentRole = {
  PLANNER: "planner",
  DEVELOPER: "developer",
  REVIEWER: "reviewer",
  LEAD_REVIEWER: "lead-reviewer",
  MERGE_ASSIST: "merge-assist",
  POST_MERGE_ANALYSIS: "post-merge-analysis",
} as const;

/** Union of all valid agent role values. */
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];

// ─── Policy (PRD 002 §2.3, §2.7) ────────────────────────────────────────────

/**
 * File scope enforcement level values.
 *
 * Controls how strictly the file scope policy is enforced during worker execution:
 * - `strict`: violations fail the run
 * - `audit`: violations logged but allowed
 * - `advisory`: informational only
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: Task (suggested_file_scope clarification)
 */
export const FileScopeEnforcementLevel = {
  STRICT: "strict",
  AUDIT: "audit",
  ADVISORY: "advisory",
} as const;

/** Union of all valid file scope enforcement level values. */
export type FileScopeEnforcementLevel =
  (typeof FileScopeEnforcementLevel)[keyof typeof FileScopeEnforcementLevel];

/**
 * Escalation action values from the escalation policy.
 *
 * - `escalate`: move to ESCALATED immediately
 * - `fail_then_escalate`: move to FAILED first, escalate if retry is not eligible
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.7 Escalation Trigger Conditions
 */
export const EscalationAction = {
  ESCALATE: "escalate",
  FAIL_THEN_ESCALATE: "fail_then_escalate",
} as const;

/** Union of all valid escalation action values. */
export type EscalationAction = (typeof EscalationAction)[keyof typeof EscalationAction];
