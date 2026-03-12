/**
 * Zod schemas for the task import pipeline.
 *
 * Defines the canonical validated shapes that all import parsers (markdown, JSON)
 * produce and all consumers (API endpoints, UI preview) expect:
 *
 * - {@link ParseWarningSeveritySchema} — severity level for parse warnings
 * - {@link ParseWarningSchema} — a single warning emitted during parsing
 * - {@link ImportedTaskSchema} — a single task extracted from an external source
 * - {@link ImportManifestSchema} — the full result of a discovery/parse pass
 *
 * These schemas are the contract boundary between parsers (T113, T114),
 * the import API (T115, T116), and the UI preview (T117, T118).
 *
 * Field names align with {@link CreateTaskDto} where possible to simplify
 * the mapping from imported tasks to task creation payloads.
 *
 * @module @factory/schemas/import
 * @see T112 — Define task import Zod schemas
 */

import { z } from "zod";

import {
  TaskTypeSchema,
  TaskPrioritySchema,
  RiskLevelSchema,
  EstimatedSizeSchema,
} from "../shared.js";

// ─── ParseWarning ────────────────────────────────────────────────────────────

/**
 * Severity levels for parse warnings.
 *
 * - `info` — non-actionable observation (e.g., field was auto-populated)
 * - `warning` — potential issue that may affect import quality (e.g., missing optional field)
 * - `error` — parsing failure for a specific field or task (the task may still be partially imported)
 */
export const ParseWarningSeveritySchema = z.enum(["info", "warning", "error"]);

/** Inferred TypeScript type for {@link ParseWarningSeveritySchema}. */
export type ParseWarningSeverity = z.infer<typeof ParseWarningSeveritySchema>;

/**
 * Zod schema for a single warning emitted during task parsing.
 *
 * Warnings capture issues encountered while extracting tasks from external
 * formats (markdown, JSON). They allow the UI to present a preview with
 * annotated problems before the user commits to the import.
 *
 * Fields:
 * - `file` — source filename where the warning originated
 * - `field` — (optional) specific field that caused the warning
 * - `message` — human-readable description of the issue
 * - `severity` — `info`, `warning`, or `error`
 */
export const ParseWarningSchema = z.object({
  /** Source filename where the warning originated (e.g., "T042-implement-supervisor.md"). */
  file: z.string().min(1, "file must not be empty"),
  /** Specific field that caused the warning (e.g., "priority", "taskType"). */
  field: z.string().min(1).optional(),
  /** Human-readable description of the issue. */
  message: z.string().min(1, "message must not be empty"),
  /** Severity level indicating how actionable this warning is. */
  severity: ParseWarningSeveritySchema,
});

/** Inferred TypeScript type for {@link ParseWarningSchema}. */
export type ParseWarning = z.infer<typeof ParseWarningSchema>;

// ─── ImportedTask ────────────────────────────────────────────────────────────

/**
 * Zod schema for a single task extracted from an external source.
 *
 * This is the canonical shape produced by all import parsers (markdown parser,
 * JSON parser) and consumed by the import API and UI preview. Field names
 * align with {@link CreateTaskDto} where possible.
 *
 * Only `title` and `taskType` are required — all other fields are optional
 * with sensible defaults or left undefined for the user to fill in during
 * preview.
 *
 * Fields:
 * - `title` — task title (required, 1–500 chars)
 * - `description` — longer task description
 * - `taskType` — classification (feature, bug_fix, refactor, etc.)
 * - `priority` — scheduling priority (critical, high, medium, low)
 * - `riskLevel` — review scrutiny level (high, medium, low)
 * - `estimatedSize` — t-shirt sizing (xs, s, m, l, xl)
 * - `acceptanceCriteria` — list of criteria for task completion
 * - `definitionOfDone` — summary of what "done" means
 * - `dependencies` — external references to tasks this depends on
 * - `suggestedFileScope` — glob patterns for relevant files
 * - `externalRef` — unique external identifier for dedup on re-import
 * - `source` — filename this task was extracted from
 * - `metadata` — arbitrary extra fields from the source format
 */
export const ImportedTaskSchema = z.object({
  /** Human-readable task title (1–500 characters). */
  title: z.string().min(1, "title is required").max(500, "title must be at most 500 characters"),

  /** Longer description of the task. */
  description: z.string().optional(),

  /** Task classification matching domain TaskType. */
  taskType: TaskTypeSchema,

  /** Scheduling priority. Defaults to "medium" if not specified by the parser. */
  priority: TaskPrioritySchema.optional().default("medium"),

  /** Review scrutiny level. */
  riskLevel: RiskLevelSchema.optional(),

  /** T-shirt size estimate for effort. */
  estimatedSize: EstimatedSizeSchema.optional(),

  /** Acceptance criteria as individual string items. */
  acceptanceCriteria: z.array(z.string().min(1)).optional(),

  /** Summary of what constitutes "done" for this task. */
  definitionOfDone: z.string().optional(),

  /**
   * External references to tasks this depends on.
   * These are opaque strings (e.g., "T041", "GH#123") that the import
   * pipeline uses to establish dependency edges after all tasks are imported.
   */
  dependencies: z.array(z.string().min(1)).optional(),

  /** Glob patterns identifying files likely affected by this task. */
  suggestedFileScope: z.array(z.string().min(1)).optional(),

  /**
   * Unique external identifier for this task (e.g., "T042", "JIRA-1234").
   * Used for deduplication on re-import: if a task with the same externalRef
   * already exists, the import can skip or update it.
   */
  externalRef: z.string().min(1).optional(),

  /** Filename this task was extracted from (e.g., "T042-implement-supervisor.md"). */
  source: z.string().min(1).optional(),

  /**
   * Arbitrary extra fields from the source format that don't map to known
   * fields. Preserved for display in the UI preview and audit purposes.
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Inferred TypeScript type for {@link ImportedTaskSchema}. */
export type ImportedTask = z.infer<typeof ImportedTaskSchema>;

// ─── ImportManifest ──────────────────────────────────────────────────────────

/**
 * Zod schema for the full result of a discovery/parse pass.
 *
 * An ImportManifest is the output of running one of the import parsers
 * against a source path (directory of markdown files, backlog.json, etc.).
 * It contains all discovered tasks, any warnings encountered during parsing,
 * and metadata about the source.
 *
 * This manifest is sent from the discovery endpoint (POST /import/discover)
 * to the UI for preview, and then from the UI back to the execution endpoint
 * (POST /import/execute) after user confirmation.
 *
 * Fields:
 * - `sourcePath` — filesystem path that was scanned
 * - `formatVersion` — version of the import format (for forward compatibility)
 * - `tasks` — array of parsed tasks
 * - `warnings` — array of parse warnings
 * - `discoveredProjectName` — project name inferred from source metadata
 * - `discoveredRepositoryName` — repository name inferred from source metadata
 */
export const ImportManifestSchema = z.object({
  /** Filesystem path that was scanned (absolute or relative). */
  sourcePath: z.string().min(1, "sourcePath must not be empty"),

  /** Version of the import format for forward compatibility. */
  formatVersion: z.string().min(1).optional(),

  /** Tasks extracted from the source. May be empty if parsing found no tasks. */
  tasks: z.array(ImportedTaskSchema),

  /** Warnings encountered during parsing. */
  warnings: z.array(ParseWarningSchema),

  /** Project name inferred from source metadata (e.g., directory name, package.json). */
  discoveredProjectName: z.string().min(1).optional(),

  /** Repository name inferred from source metadata (e.g., git remote, directory name). */
  discoveredRepositoryName: z.string().min(1).optional(),
});

/** Inferred TypeScript type for {@link ImportManifestSchema}. */
export type ImportManifest = z.infer<typeof ImportManifestSchema>;
