/**
 * Deterministic JSON task parser for the task import pipeline.
 *
 * Parses JSON-formatted task files and produces validated {@link ImportManifest}
 * objects. Supports two formats:
 *
 * 1. **backlog.json** — structured format with `epics` and `tasks` arrays,
 *    using abbreviated field names (`desc`, `deps`, `criteria`). This is the
 *    format used by the factory's own backlog.
 *
 * 2. **flat tasks.json** — a plain JSON array of task objects whose fields
 *    already match (or closely match) the {@link ImportedTaskSchema} shape.
 *
 * Format detection is automatic: if the root object has an `epics` key, it is
 * treated as backlog.json; if the root is an array, it is treated as flat
 * format.
 *
 * @module
 * @see {@link file://docs/backlog/tasks/T114-build-json-parser.md} — task spec
 */

import type { ImportManifest, ImportedTask, ParseWarning } from "@factory/schemas";
import { ImportedTaskSchema, ImportManifestSchema } from "@factory/schemas";

import type { FileSystem } from "../workspace/types.js";
import { mapTaskType, mapPriority } from "./markdown-task-parser.js";

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * Result of parsing a single task object from a backlog.json entry.
 * Contains the validated task (if parsing succeeded) and any warnings
 * generated during field mapping or validation.
 */
export interface ParseJsonTaskResult {
  task: ImportedTask | null;
  warnings: ParseWarning[];
}

// ─── Format detection ────────────────────────────────────────────────────────

/** Discriminated format tag returned by {@link detectJsonFormat}. */
export type JsonFormat = "backlog" | "flat" | "unknown";

/**
 * Auto-detect whether the parsed JSON represents a backlog.json structure
 * (object with `epics`/`tasks` keys) or a flat task array.
 *
 * @param data - The parsed JSON value.
 * @returns `"backlog"` if the root is an object with an `epics` key,
 *          `"flat"` if the root is an array,
 *          `"unknown"` otherwise.
 */
export function detectJsonFormat(data: unknown): JsonFormat {
  if (Array.isArray(data)) {
    return "flat";
  }
  if (data !== null && typeof data === "object" && "epics" in data) {
    return "backlog";
  }
  return "unknown";
}

// ─── Backlog.json field mapping ──────────────────────────────────────────────

/**
 * Shape of a single task entry in the backlog.json `tasks` array.
 * Uses abbreviated field names as authored in the JSON file.
 */
interface BacklogJsonTask {
  id?: string;
  title?: string;
  epic?: string;
  type?: string;
  priority?: string;
  owner?: string;
  ai_exec?: string;
  human_review?: string;
  deps?: string[];
  blocks?: string[];
  desc?: string;
  goal?: string;
  in_scope?: string[];
  out_scope?: string[];
  context?: string[];
  criteria?: string[];
  validation?: string;
  risks?: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * Map a single backlog.json task entry to the {@link ImportedTask} schema
 * shape. Collects warnings for fields that fail to map or validate.
 *
 * Field mapping rules (backlog.json → ImportedTask):
 * - `id` → `externalRef`
 * - `title` → `title`
 * - `desc` → `description`
 * - `type` → `taskType` (via {@link mapTaskType})
 * - `priority` → `priority` (via {@link mapPriority})
 * - `deps` → `dependencies`
 * - `criteria` → `acceptanceCriteria`
 * - `context` → `suggestedFileScope`
 * - `blocks`, `goal`, `in_scope`, `out_scope`, `validation`, `risks`,
 *   `owner`, `ai_exec`, `human_review`, `epic` → `metadata`
 *
 * @param raw   - The raw task object from backlog.json.
 * @param source - The source file path for traceability.
 * @returns Parsed task and any warnings generated during mapping.
 */
export function mapBacklogTask(raw: BacklogJsonTask, source: string): ParseJsonTaskResult {
  const warnings: ParseWarning[] = [];
  const ref = raw.id ?? "unknown";

  // ── Required: title ──────────────────────────────────────────────────────
  if (!raw.title || raw.title.trim().length === 0) {
    warnings.push({
      file: source,
      field: "title",
      message: `Task ${ref}: missing required field "title"`,
      severity: "error",
    });
    return { task: null, warnings };
  }

  // ── Required: taskType ───────────────────────────────────────────────────
  const mappedType = raw.type ? mapTaskType(raw.type) : undefined;
  if (!mappedType) {
    warnings.push({
      file: source,
      field: "type",
      message: `Task ${ref}: could not map type "${raw.type ?? ""}" to a known task type`,
      severity: "error",
    });
    return { task: null, warnings };
  }

  // ── Optional mapped fields ───────────────────────────────────────────────
  const mappedPriority = raw.priority ? mapPriority(raw.priority) : undefined;

  if (raw.priority && !mappedPriority) {
    warnings.push({
      file: source,
      field: "priority",
      message: `Task ${ref}: could not map priority "${raw.priority}", using default`,
      severity: "warning",
    });
  }

  // ── Build the candidate object ───────────────────────────────────────────
  const candidate: Record<string, unknown> = {
    title: raw.title.trim(),
    taskType: mappedType,
    externalRef: raw.id,
    source,
  };

  if (raw.desc) {
    candidate["description"] = raw.desc;
  }
  if (mappedPriority) {
    candidate["priority"] = mappedPriority;
  }
  if (raw.deps && raw.deps.length > 0) {
    candidate["dependencies"] = raw.deps;
  }
  if (raw.criteria && raw.criteria.length > 0) {
    candidate["acceptanceCriteria"] = raw.criteria;
  }
  if (raw.context && raw.context.length > 0) {
    candidate["suggestedFileScope"] = raw.context;
  }

  // ── Metadata bucket for non-schema fields ────────────────────────────────
  const metadata: Record<string, unknown> = {};
  if (raw.blocks && raw.blocks.length > 0) metadata["blocks"] = raw.blocks;
  if (raw.goal) metadata["goal"] = raw.goal;
  if (raw.in_scope && raw.in_scope.length > 0) metadata["inScope"] = raw.in_scope;
  if (raw.out_scope && raw.out_scope.length > 0) metadata["outScope"] = raw.out_scope;
  if (raw.validation) metadata["validation"] = raw.validation;
  if (raw.risks) metadata["risks"] = raw.risks;
  if (raw.owner) metadata["owner"] = raw.owner;
  if (raw.ai_exec) metadata["aiExecutable"] = raw.ai_exec;
  if (raw.human_review) metadata["humanReview"] = raw.human_review;
  if (raw.epic) metadata["epic"] = raw.epic;
  if (raw.status) metadata["status"] = raw.status;

  if (Object.keys(metadata).length > 0) {
    candidate["metadata"] = metadata;
  }

  // ── Validate through Zod ─────────────────────────────────────────────────
  const result = ImportedTaskSchema.safeParse(candidate);
  if (!result.success) {
    for (const issue of result.error.issues) {
      warnings.push({
        file: source,
        field: issue.path.join("."),
        message: `Task ${ref}: ${issue.message}`,
        severity: "error",
      });
    }
    return { task: null, warnings };
  }

  return { task: result.data, warnings };
}

// ─── Flat format mapping ─────────────────────────────────────────────────────

/**
 * Validate a single flat-format task object against {@link ImportedTaskSchema}.
 * Flat format tasks are expected to already use the canonical field names
 * (title, taskType, description, etc.).
 *
 * @param raw    - The raw task object from the flat JSON array.
 * @param index  - The array index for error reporting.
 * @param source - The source file path for traceability.
 * @returns Parsed task and any warnings generated during validation.
 */
export function mapFlatTask(raw: unknown, index: number, source: string): ParseJsonTaskResult {
  const warnings: ParseWarning[] = [];

  if (raw === null || typeof raw !== "object") {
    warnings.push({
      file: source,
      message: `Entry at index ${index}: expected an object, got ${raw === null ? "null" : typeof raw}`,
      severity: "error",
    });
    return { task: null, warnings };
  }

  // Inject source if not present
  const candidate = { source, ...(raw as Record<string, unknown>) };

  const result = ImportedTaskSchema.safeParse(candidate);
  if (!result.success) {
    const ref =
      (raw as Record<string, unknown>)["externalRef"] ??
      (raw as Record<string, unknown>)["title"] ??
      `index ${index}`;
    for (const issue of result.error.issues) {
      warnings.push({
        file: source,
        field: issue.path.join("."),
        message: `Task "${ref}": ${issue.message}`,
        severity: "error",
      });
    }
    return { task: null, warnings };
  }

  return { task: result.data, warnings };
}

// ─── Top-level parsers ───────────────────────────────────────────────────────

/**
 * Parse a backlog.json-format object into an {@link ImportManifest}.
 *
 * Extracts the `tasks` array, maps each entry via {@link mapBacklogTask},
 * and assembles the manifest with discovery metadata.
 *
 * @param data       - The parsed backlog.json root object.
 * @param sourcePath - The file path for traceability.
 * @returns A validated ImportManifest.
 */
export function parseBacklogJsonData(
  data: Record<string, unknown>,
  sourcePath: string,
): ImportManifest {
  const warnings: ParseWarning[] = [];
  const tasks: ImportedTask[] = [];

  const rawTasks = data["tasks"];
  if (!Array.isArray(rawTasks)) {
    warnings.push({
      file: sourcePath,
      field: "tasks",
      message: 'Root object has no "tasks" array',
      severity: "error",
    });
    return buildManifest(sourcePath, tasks, warnings, data);
  }

  for (const rawTask of rawTasks) {
    if (rawTask === null || typeof rawTask !== "object") {
      warnings.push({
        file: sourcePath,
        message: "Skipping non-object entry in tasks array",
        severity: "warning",
      });
      continue;
    }
    const result = mapBacklogTask(rawTask as BacklogJsonTask, sourcePath);
    warnings.push(...result.warnings);
    if (result.task) {
      tasks.push(result.task);
    }
  }

  return buildManifest(sourcePath, tasks, warnings, data);
}

/**
 * Parse a flat JSON array of task objects into an {@link ImportManifest}.
 *
 * Each array element is validated directly against {@link ImportedTaskSchema}.
 *
 * @param data       - The parsed JSON array.
 * @param sourcePath - The file path for traceability.
 * @returns A validated ImportManifest.
 */
export function parseFlatJsonData(data: unknown[], sourcePath: string): ImportManifest {
  const warnings: ParseWarning[] = [];
  const tasks: ImportedTask[] = [];

  for (let i = 0; i < data.length; i++) {
    const result = mapFlatTask(data[i], i, sourcePath);
    warnings.push(...result.warnings);
    if (result.task) {
      tasks.push(result.task);
    }
  }

  return buildManifest(sourcePath, tasks, warnings);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Parse a JSON file at the given path and produce an {@link ImportManifest}.
 *
 * Reads the file, parses JSON, auto-detects whether it is a backlog.json
 * (object with `epics` key) or flat array format, then delegates to the
 * appropriate parser.
 *
 * @param sourcePath - Absolute path to the JSON file.
 * @param fs         - Injected filesystem for testability.
 * @returns A validated ImportManifest containing all successfully parsed tasks
 *          and any warnings generated during parsing.
 *
 * @example
 * ```ts
 * const manifest = await parseJsonTasks("./backlog.json", createNodeFileSystem());
 * console.log(`Parsed ${manifest.tasks.length} tasks`);
 * ```
 */
export async function parseJsonTasks(sourcePath: string, fs: FileSystem): Promise<ImportManifest> {
  const warnings: ParseWarning[] = [];

  // ── Read and parse JSON ──────────────────────────────────────────────────
  let content: string;
  try {
    content = await fs.readFile(sourcePath);
  } catch (error) {
    warnings.push({
      file: sourcePath,
      message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      severity: "error",
    });
    return buildManifest(sourcePath, [], warnings);
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (error) {
    warnings.push({
      file: sourcePath,
      message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      severity: "error",
    });
    return buildManifest(sourcePath, [], warnings);
  }

  // ── Detect format and delegate ───────────────────────────────────────────
  const format = detectJsonFormat(data);

  switch (format) {
    case "backlog":
      return parseBacklogJsonData(data as Record<string, unknown>, sourcePath);

    case "flat":
      return parseFlatJsonData(data as unknown[], sourcePath);

    case "unknown":
      warnings.push({
        file: sourcePath,
        message:
          'Unrecognized JSON format: expected an object with an "epics" key (backlog.json) or a plain array (flat format)',
        severity: "error",
      });
      return buildManifest(sourcePath, [], warnings);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build and validate the final {@link ImportManifest}.
 *
 * Extracts optional discovery metadata (project name, generated date) from
 * the root data if provided.
 */
function buildManifest(
  sourcePath: string,
  tasks: ImportedTask[],
  warnings: ParseWarning[],
  rootData?: Record<string, unknown>,
): ImportManifest {
  const manifest: Record<string, unknown> = {
    sourcePath,
    tasks,
    warnings,
  };

  // Extract discovery metadata from backlog.json root
  if (rootData) {
    if (typeof rootData["generated"] === "string") {
      manifest["formatVersion"] = rootData["generated"];
    }

    // Try to discover project name from first epic's title or the file name
    const epics = rootData["epics"];
    if (Array.isArray(epics) && epics.length > 0) {
      const firstEpic = epics[0] as Record<string, unknown>;
      if (typeof firstEpic["title"] === "string") {
        // Use the overall collection name rather than individual epic title
        // The project name is better derived from the source path
      }
    }
  }

  const result = ImportManifestSchema.safeParse(manifest);
  if (result.success) {
    return result.data;
  }

  // If manifest validation fails, return a minimal valid manifest
  return {
    sourcePath,
    tasks,
    warnings: [
      ...warnings,
      {
        file: sourcePath,
        message: `Manifest validation failed: ${result.error.issues.map((i) => i.message).join(", ")}`,
        severity: "error" as const,
      },
    ],
  };
}
