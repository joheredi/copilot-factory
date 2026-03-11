/**
 * Shared Zod schemas for packet building blocks.
 *
 * Defines the three reusable schemas referenced across all packet types:
 * - {@link FileChangeSummarySchema} — describes a single file change (PRD 008 §8.3.1)
 * - {@link IssueSchema} — describes an issue found during review/validation (PRD 008 §8.3.2)
 * - {@link ValidationCheckResultSchema} — describes the result of a validation check (PRD 008 §8.3.3)
 *
 * Also re-exports packet-related domain enums as Zod enum schemas so downstream
 * packet schemas can reference them directly without importing from `@factory/domain`.
 *
 * @module @factory/schemas/shared
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.3 Shared Types
 */

import { z } from "zod";

import {
  FileChangeType,
  IssueSeverity,
  ValidationCheckType,
  ValidationCheckStatus,
  ValidationRunScope,
  PacketType,
  PacketStatus,
  ReviewVerdict,
  LeadReviewDecision,
  Confidence,
  AgentRole,
  MergeAssistRecommendation,
  PostMergeAnalysisRecommendation,
  MergeStrategy,
  TaskType,
  TaskPriority,
  RiskLevel,
} from "@factory/domain";

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Creates a Zod enum schema from a domain const-object's values.
 *
 * The domain layer defines enums as `{ KEY: "value" } as const` objects.
 * This helper extracts the values and creates a `z.enum(["value", ...])`.
 *
 * @typeParam T - A readonly record mapping keys to string literal values.
 * @param enumObj - The domain const-object (e.g., `FileChangeType`).
 * @returns A Zod enum schema whose members are the object's values.
 */
function zodEnumFromConst<T extends Record<string, string>>(
  enumObj: T,
): z.ZodEnum<[T[keyof T], ...T[keyof T][]]> {
  const values = Object.values(enumObj) as [T[keyof T], ...T[keyof T][]];
  return z.enum(values);
}

// ─── Enum Schemas ────────────────────────────────────────────────────────────

/**
 * Zod schema for {@link FileChangeType} enum values.
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.3.1
 */
export const FileChangeTypeSchema = zodEnumFromConst(FileChangeType);

/**
 * Zod schema for {@link IssueSeverity} enum values.
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.3.2
 */
export const IssueSeveritySchema = zodEnumFromConst(IssueSeverity);

/**
 * Zod schema for {@link ValidationCheckType} enum values.
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.3.3
 */
export const ValidationCheckTypeSchema = zodEnumFromConst(ValidationCheckType);

/**
 * Zod schema for {@link ValidationCheckStatus} enum values.
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.3.3
 */
export const ValidationCheckStatusSchema = zodEnumFromConst(ValidationCheckStatus);

/**
 * Zod schema for {@link PacketType} enum values.
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4–§8.11
 */
export const PacketTypeSchema = zodEnumFromConst(PacketType);

/**
 * Zod schema for {@link PacketStatus} enum values.
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.2.3
 */
export const PacketStatusSchema = zodEnumFromConst(PacketStatus);

/**
 * Zod schema for {@link ReviewVerdict} enum values.
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.6.3
 */
export const ReviewVerdictSchema = zodEnumFromConst(ReviewVerdict);

/**
 * Zod schema for {@link LeadReviewDecision} enum values.
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.7.3
 */
export const LeadReviewDecisionSchema = zodEnumFromConst(LeadReviewDecision);

/**
 * Zod schema for {@link Confidence} enum values.
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.9.3, §8.11.3
 */
export const ConfidenceSchema = zodEnumFromConst(Confidence);

/**
 * Zod schema for {@link AgentRole} enum values.
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4.3
 */
export const AgentRoleSchema = zodEnumFromConst(AgentRole);

/**
 * Zod schema for {@link MergeAssistRecommendation} enum values.
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.9.3
 */
export const MergeAssistRecommendationSchema = zodEnumFromConst(MergeAssistRecommendation);

/**
 * Zod schema for {@link PostMergeAnalysisRecommendation} enum values.
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.11.3
 */
export const PostMergeAnalysisRecommendationSchema = zodEnumFromConst(
  PostMergeAnalysisRecommendation,
);

/**
 * Zod schema for {@link MergeStrategy} enum values.
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.8
 */
export const MergeStrategySchema = zodEnumFromConst(MergeStrategy);

/**
 * Zod schema for {@link ValidationRunScope} enum values.
 *
 * Identifies when in the workflow a validation run was triggered:
 * pre-dev, during-dev, pre-review, pre-merge, or post-merge.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.10
 */
export const ValidationRunScopeSchema = zodEnumFromConst(ValidationRunScope);

/**
 * Zod schema for {@link TaskType} enum values.
 *
 * Classifies the kind of work a task represents: feature, bug_fix, refactor,
 * chore, documentation, test, or spike.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: Task (task_type)
 */
export const TaskTypeSchema = zodEnumFromConst(TaskType);

/**
 * Zod schema for {@link TaskPriority} enum values.
 *
 * Controls scheduling order: critical > high > medium > low.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: Task (priority)
 */
export const TaskPrioritySchema = zodEnumFromConst(TaskPriority);

/**
 * Zod schema for {@link RiskLevel} enum values.
 *
 * Determines the level of scrutiny applied during review routing and
 * validation: high, medium, or low.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: Task (risk_level)
 */
export const RiskLevelSchema = zodEnumFromConst(RiskLevel);

// ─── Shared Object Schemas ──────────────────────────────────────────────────

/**
 * Zod schema for a single file change summary.
 *
 * Describes one file that was added, modified, deleted, or renamed as part of
 * a development result. Used inside DevResultPacket and other packets that
 * report code changes.
 *
 * Fields:
 * - `path` — repository-relative file path (e.g., `"src/foo.ts"`)
 * - `change_type` — one of `added`, `modified`, `deleted`, `renamed`
 * - `summary` — short human-readable description of what changed
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.3.1 FileChangeSummary
 */
export const FileChangeSummarySchema = z.object({
  path: z.string().min(1, "path must not be empty"),
  change_type: FileChangeTypeSchema,
  summary: z.string().min(1, "summary must not be empty"),
});

/** Inferred TypeScript type for {@link FileChangeSummarySchema}. */
export type FileChangeSummary = z.infer<typeof FileChangeSummarySchema>;

/**
 * Zod schema for an issue found during review or validation.
 *
 * Issues represent problems identified by specialist reviewers, lead reviewers,
 * or validation checks. They carry a severity, a stable code identifier, and
 * optional source-location information.
 *
 * Fields:
 * - `severity` — `critical`, `high`, `medium`, or `low`
 * - `code` — stable machine-readable identifier (e.g., `"missing-validation"`)
 * - `title` — short human-readable title
 * - `description` — detailed explanation
 * - `file_path` — (optional) repository-relative file where the issue was found
 * - `line` — (optional) 1-based line number within `file_path`
 * - `blocking` — whether this issue blocks approval
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.3.2 Issue
 */
export const IssueSchema = z.object({
  severity: IssueSeveritySchema,
  code: z.string().min(1, "code must not be empty"),
  title: z.string().min(1, "title must not be empty"),
  description: z.string().min(1, "description must not be empty"),
  file_path: z.string().optional(),
  line: z.number().int().positive().optional(),
  blocking: z.boolean(),
});

/** Inferred TypeScript type for {@link IssueSchema}. */
export type Issue = z.infer<typeof IssueSchema>;

/**
 * Zod schema for a single validation check result.
 *
 * Captures the outcome of one validation step (test run, lint, build, etc.)
 * as part of the validation pipeline. Used inside ValidationResultPacket.
 *
 * Fields:
 * - `check_type` — category of check (`test`, `lint`, `build`, `typecheck`, `policy`, `schema`, `security`)
 * - `tool_name` — the tool that ran the check (e.g., `"pnpm"`, `"eslint"`)
 * - `command` — the full command that was executed
 * - `status` — `passed`, `failed`, or `skipped`
 * - `duration_ms` — wall-clock time of the check in milliseconds
 * - `summary` — short human-readable result description
 * - `artifact_refs` — (optional) paths to log files or other artifacts
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.3.3 ValidationCheckResult
 */
export const ValidationCheckResultSchema = z.object({
  check_type: ValidationCheckTypeSchema,
  tool_name: z.string().min(1, "tool_name must not be empty"),
  command: z.string().min(1, "command must not be empty"),
  status: ValidationCheckStatusSchema,
  duration_ms: z.number().int().nonnegative(),
  summary: z.string().min(1, "summary must not be empty"),
  artifact_refs: z.array(z.string().min(1)).optional(),
});

/** Inferred TypeScript type for {@link ValidationCheckResultSchema}. */
export type ValidationCheckResult = z.infer<typeof ValidationCheckResultSchema>;
