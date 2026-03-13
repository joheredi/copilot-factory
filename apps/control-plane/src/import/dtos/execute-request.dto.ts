/**
 * DTO for the import execution request.
 *
 * Validated by the global {@link ZodValidationPipe} using the static
 * `schema` property. Accepts the output of the discovery endpoint along
 * with user-confirmed project/repository names, and writes the discovered
 * tasks to the database.
 *
 * The imported task schema is defined locally using the control-plane's
 * Zod 4 version rather than importing from `@factory/schemas` (Zod 3)
 * to avoid cross-version type incompatibilities.
 *
 * @module @factory/control-plane
 * @see T116 — Create POST /import/execute endpoint
 */
import { z } from "zod";

/** Valid task types matching the domain enum. */
const taskTypeValues = [
  "feature",
  "bug_fix",
  "refactor",
  "chore",
  "documentation",
  "test",
  "spike",
] as const;

/** Valid priorities matching the domain enum. */
const priorityValues = ["critical", "high", "medium", "low"] as const;

/** Valid risk levels matching the domain enum. */
const riskLevelValues = ["high", "medium", "low"] as const;

/** Valid estimated sizes matching the domain enum. */
const estimatedSizeValues = ["xs", "s", "m", "l", "xl"] as const;

/** Valid import-time status values. */
const importStatusValues = ["BACKLOG", "DONE", "CANCELLED"] as const;

/**
 * Zod 4 schema for an imported task within the execute request.
 * Mirrors {@link @factory/schemas!ImportedTaskSchema} field-for-field
 * but uses the control-plane's Zod version for type compatibility.
 */
const importedTaskForExecuteSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  taskType: z.enum(taskTypeValues),
  priority: z.enum(priorityValues).optional().default("medium"),
  riskLevel: z.enum(riskLevelValues).optional(),
  estimatedSize: z.enum(estimatedSizeValues).optional(),
  acceptanceCriteria: z.array(z.string().min(1)).optional(),
  definitionOfDone: z.string().optional(),
  dependencies: z.array(z.string().min(1)).optional(),
  suggestedFileScope: z.array(z.string().min(1)).optional(),
  externalRef: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  status: z.enum(importStatusValues).optional().default("BACKLOG"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Inferred type for a single imported task in an execute request. */
export type ExecuteImportedTask = z.infer<typeof importedTaskForExecuteSchema>;

/** Zod schema for import execution request payloads. */
const executeRequestSchema = z.object({
  /**
   * Filesystem path that was originally scanned. Used as a fallback for
   * the repository remote URL when no explicit URL is provided.
   */
  path: z.string().min(1, "path is required"),

  /**
   * Array of imported tasks from the discovery step.
   */
  tasks: z.array(importedTaskForExecuteSchema).min(1, "at least one task is required"),

  /**
   * Name for the project to create or find. If a project with this name
   * already exists, it is reused (not duplicated).
   */
  projectName: z.string().min(1, "projectName is required").max(255),

  /**
   * Optional name for the repository. Defaults to `projectName` if omitted.
   * If a repository with this name already exists within the project, it is reused.
   */
  repositoryName: z.string().min(1).max(255).optional(),

  /**
   * Optional Git remote URL for the repository. Defaults to `file://<path>`
   * when omitted, suitable for local-first usage.
   */
  repositoryUrl: z.string().min(1).optional(),
});

/**
 * Data transfer object for `POST /import/execute` requests.
 *
 * Properties mirror the Zod schema. The global validation pipe parses
 * raw JSON into this shape, so route handlers receive validated, typed data.
 */
export class ExecuteRequestDto {
  /** Zod schema used by the global validation pipe. */
  static schema = executeRequestSchema;

  /** Filesystem path that was scanned. */
  path!: string;
  /** Imported tasks to persist. */
  tasks!: ExecuteImportedTask[];
  /** Project name to create or reuse. */
  projectName!: string;
  /** Optional repository name (defaults to projectName). */
  repositoryName?: string;
  /** Optional remote URL for the repository. */
  repositoryUrl?: string;
}
