/** @module @factory/schemas — Zod schemas for task packets, dev results, reviews, merge, validation, and all artifact contracts. */

// ─── Shared Types (PRD 008 §8.3) ────────────────────────────────────────────
export {
  // Enum schemas
  FileChangeTypeSchema,
  IssueSeveritySchema,
  ValidationCheckTypeSchema,
  ValidationCheckStatusSchema,
  ValidationRunScopeSchema,
  PacketTypeSchema,
  PacketStatusSchema,
  ReviewVerdictSchema,
  LeadReviewDecisionSchema,
  ConfidenceSchema,
  AgentRoleSchema,
  MergeAssistRecommendationSchema,
  PostMergeAnalysisRecommendationSchema,
  MergeStrategySchema,
  TaskTypeSchema,
  TaskPrioritySchema,
  RiskLevelSchema,
  // Object schemas
  FileChangeSummarySchema,
  IssueSchema,
  ValidationCheckResultSchema,
} from "./shared.js";

export type { FileChangeSummary, Issue, ValidationCheckResult } from "./shared.js";

// ─── RejectionContext (PRD 008 §8.12) ────────────────────────────────────────
export { RejectionContextSchema } from "./rejection-context.js";
export type { RejectionContext } from "./rejection-context.js";

// ─── TaskPacket (PRD 008 §8.4) ──────────────────────────────────────────────
export {
  TaskPacketSchema,
  TaskPacketTaskSchema,
  TaskPacketRepositorySchema,
  TaskPacketWorkspaceSchema,
  TaskPacketContextSchema,
  TaskPacketRepoPolicySchema,
  TaskPacketToolPolicySchema,
  TaskPacketValidationRequirementsSchema,
  TaskPacketExpectedOutputSchema,
} from "./task-packet.js";

export type {
  TaskPacket,
  TaskPacketTask,
  TaskPacketRepository,
  TaskPacketWorkspace,
  TaskPacketContext,
  TaskPacketRepoPolicy,
  TaskPacketToolPolicy,
  TaskPacketValidationRequirements,
  TaskPacketExpectedOutput,
} from "./task-packet.js";

// ─── DevResultPacket (PRD 008 §8.5) ─────────────────────────────────────────
export { DevResultPacketSchema, DevResultPacketResultSchema } from "./dev-result-packet.js";

export type { DevResultPacket, DevResultPacketResult } from "./dev-result-packet.js";

// ─── ReviewPacket (PRD 008 §8.6) ────────────────────────────────────────────
export { ReviewPacketSchema } from "./review-packet.js";

export type { ReviewPacket } from "./review-packet.js";

// ─── LeadReviewDecisionPacket (PRD 008 §8.7) ────────────────────────────────
export { LeadReviewDecisionPacketSchema } from "./lead-review-decision-packet.js";

export type { LeadReviewDecisionPacket } from "./lead-review-decision-packet.js";

// ─── MergePacket (PRD 008 §8.8) ─────────────────────────────────────────────
export { MergePacketSchema, MergePacketDetailsSchema } from "./merge-packet.js";

export type { MergePacket, MergePacketDetails } from "./merge-packet.js";

// ─── MergeAssistPacket (PRD 008 §8.9) ───────────────────────────────────────
export { MergeAssistPacketSchema, MergeAssistFileAffectedSchema } from "./merge-assist-packet.js";

export type { MergeAssistPacket, MergeAssistFileAffected } from "./merge-assist-packet.js";

// ─── ValidationResultPacket (PRD 008 §8.10) ─────────────────────────────────
export {
  ValidationResultPacketSchema,
  ValidationResultPacketDetailsSchema,
} from "./validation-result-packet.js";

export type {
  ValidationResultPacket,
  ValidationResultPacketDetails,
} from "./validation-result-packet.js";

// ─── PostMergeAnalysisPacket (PRD 008 §8.11) ────────────────────────────────
export {
  PostMergeAnalysisPacketSchema,
  SuggestedRevertScopeSchema,
} from "./post-merge-analysis-packet.js";

export type {
  PostMergeAnalysisPacket,
  SuggestedRevertScope,
} from "./post-merge-analysis-packet.js";

// ─── PolicySnapshot (PRD 009 §9.2) ──────────────────────────────────────────
export {
  PolicySnapshotSchema,
  CommandPolicySchema,
  FileScopePolicySchema,
  ValidationPolicySchema,
  ValidationProfileSchema,
  RetryPolicySchema,
  EscalationPolicySchema,
  LeasePolicySchema,
  RetentionPolicySchema,
  ReviewPolicySchema,
  AllowedCommandSchema,
} from "./policy-snapshot.js";

export type {
  PolicySnapshot,
  CommandPolicy,
  FileScopePolicy,
  ValidationPolicy,
  ValidationProfile,
  RetryPolicy,
  EscalationPolicy,
  LeasePolicy,
  RetentionPolicy,
  ReviewPolicy,
  AllowedCommand,
} from "./policy-snapshot.js";
