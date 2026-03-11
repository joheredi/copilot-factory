/** @module @factory/schemas — Zod schemas for task packets, dev results, reviews, merge, validation, and all artifact contracts. */

// ─── Shared Types (PRD 008 §8.3) ────────────────────────────────────────────
export {
  // Enum schemas
  FileChangeTypeSchema,
  IssueSeveritySchema,
  ValidationCheckTypeSchema,
  ValidationCheckStatusSchema,
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
