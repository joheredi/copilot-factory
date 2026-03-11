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
  // Object schemas
  FileChangeSummarySchema,
  IssueSchema,
  ValidationCheckResultSchema,
} from "./shared.js";

export type { FileChangeSummary, Issue, ValidationCheckResult } from "./shared.js";
