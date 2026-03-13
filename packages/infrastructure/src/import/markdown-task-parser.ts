/**
 * Deterministic markdown task parser for the task import pipeline.
 *
 * Parses structured markdown task files (with metadata tables, headed sections,
 * and checkbox lists) into validated {@link ImportManifest} objects. This is the
 * first stage of the import pipeline — it transforms a directory of markdown
 * backlog files into a format the API and UI can consume.
 *
 * Design decision: functional approach with {@link FileSystem} dependency injection.
 * Parsing functions are pure (testable without mocks); only file discovery and
 * reading require the injected filesystem. See
 * {@link file://.copilot/session-state/plan.md} for rationale.
 *
 * @module import/markdown-task-parser
 * @see {@link @factory/schemas!ImportManifest} — output contract
 * @see {@link @factory/schemas!ImportedTask} — per-task shape
 */

import type { ImportManifest, ImportedTask, ParseWarning } from "@factory/schemas";
import { ImportManifestSchema, ImportedTaskSchema } from "@factory/schemas";
import type { FileSystem } from "../workspace/types.js";
import type { TaskClassificationInput, TaskClassificationResult } from "./ai-task-classifier.js";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Optional classifier function that infers taskType and status from task content.
 * When provided, overrides deterministic parsing results with AI-powered classification.
 */
export type TaskClassifier = (
  inputs: TaskClassificationInput[],
) => Promise<{ results: TaskClassificationResult[]; warnings: ParseWarning[] }>;

/**
 * Discover and parse all markdown task files under {@link sourcePath}.
 *
 * Walks `tasks/` (or the directory itself if it already contains `.md` files),
 * parses each file through {@link parseTaskFile}, and collects the results
 * into a validated {@link ImportManifest}.
 *
 * @param sourcePath - Root directory of the backlog (contains `tasks/` and
 *   optionally `index.md`).
 * @param fs - Filesystem abstraction for reading files and listing
 *   directories. Inject a fake in tests.
 * @param classify - Optional AI classifier for taskType and status inference.
 * @returns A validated import manifest with parsed tasks and any warnings.
 */
export async function discoverMarkdownTasks(
  sourcePath: string,
  fs: FileSystem,
  classify?: TaskClassifier,
): Promise<ImportManifest> {
  const warnings: ParseWarning[] = [];
  const tasks: ImportedTask[] = [];

  // Try tasks/ subdirectory first, fall back to sourcePath itself.
  const tasksDir = path.join(sourcePath, "tasks");
  const tasksDirExists = await fs.exists(tasksDir);
  const searchDir = tasksDirExists ? tasksDir : sourcePath;

  const mdFiles = await findMarkdownFiles(searchDir, fs);

  // Parse index.md for ordering hints (if present).
  const indexPath = path.join(sourcePath, "index.md");
  const indexExists = await fs.exists(indexPath);
  let ordering: string[] | undefined;
  let discoveredProjectName: string | undefined;

  if (indexExists) {
    const indexContent = await fs.readFile(indexPath);
    const indexResult = parseIndexFile(indexContent);
    ordering = indexResult.taskOrder;
    discoveredProjectName = indexResult.projectName;
    warnings.push(...indexResult.warnings);
  }

  // Parse each task file.
  for (const filePath of mdFiles) {
    const filename = path.basename(filePath);
    // Skip index.md — it's metadata, not a task.
    if (filename.toLowerCase() === "index.md") continue;

    const content = await fs.readFile(filePath);
    const result = parseTaskFile(content, filename);
    warnings.push(...result.warnings);
    if (result.task) {
      tasks.push(result.task);
    }
  }

  // Apply ordering from index.md if available.
  const orderedTasks = ordering ? applyOrdering(tasks, ordering) : tasks;

  // Run AI classification if a classifier is provided.
  let classifiedTasks = orderedTasks;
  if (classify && orderedTasks.length > 0) {
    const inputs: TaskClassificationInput[] = orderedTasks.map((t) => ({
      title: t.title,
      description: t.description,
      acceptanceCriteria: t.acceptanceCriteria,
      rawType: t.metadata?.["rawType"] as string | undefined,
      rawStatus: t.metadata?.["status"] as string | undefined,
    }));
    const classResult = await classify(inputs);
    warnings.push(...classResult.warnings);

    classifiedTasks = orderedTasks.map((task, i) => {
      const classification = classResult.results[i];
      if (!classification) return task;
      return {
        ...task,
        taskType: classification.taskType,
        status: classification.status,
      };
    });
  }

  const manifest: ImportManifest = ImportManifestSchema.parse({
    sourcePath,
    formatVersion: "1.0",
    tasks: classifiedTasks,
    warnings,
    discoveredProjectName,
  });

  return manifest;
}

// ---------------------------------------------------------------------------
// Task file parsing
// ---------------------------------------------------------------------------

/**
 * Result of parsing a single markdown task file.
 */
export interface ParseTaskFileResult {
  /** The parsed task, or `null` if the file could not be parsed. */
  task: ImportedTask | null;
  /** Warnings generated during parsing. */
  warnings: ParseWarning[];
}

/**
 * Parse a single markdown task file into an {@link ImportedTask}.
 *
 * Extracts data from three sources within the file:
 * 1. **Metadata table** — the `| Field | Value |` table near the top.
 * 2. **Headed sections** — `## Description`, `## Goal`, `## Acceptance Criteria`, etc.
 * 3. **Filename** — the external reference (e.g. `T045` from `T045-copilot-cli-adapter.md`).
 *
 * @param content - Raw markdown content of the file.
 * @param filename - Basename of the file (used for `source` and `externalRef`).
 * @returns Parsed task and any warnings encountered.
 */
export function parseTaskFile(content: string, filename: string): ParseTaskFileResult {
  const warnings: ParseWarning[] = [];

  // Extract metadata from both sources; table takes precedence over bold.
  const tableMetadata = parseMetadataTable(content);
  const boldMetadata = parseBoldMetadata(content);
  const metadata = new Map<string, string>([...boldMetadata, ...tableMetadata]);

  // --- Title ---
  const title = extractTitle(content, metadata);
  if (!title) {
    warnings.push({
      file: filename,
      field: "title",
      message: "No title found — expected an H1 heading or metadata ID field.",
      severity: "error",
    });
    return { task: null, warnings };
  }

  // --- Task type ---
  const rawType = metadata.get("type") ?? metadata.get("tag");
  const taskType = rawType ? mapTaskType(rawType) : undefined;
  if (rawType && !taskType) {
    warnings.push({
      file: filename,
      field: "taskType",
      message: `Unrecognized task type "${rawType}". Defaulting to "chore".`,
      severity: "warning",
    });
  }
  if (!rawType) {
    warnings.push({
      file: filename,
      field: "taskType",
      message: 'No Type or Tag field in metadata. Defaulting to "chore".',
      severity: "warning",
    });
  }

  // --- Priority ---
  const rawPriority = metadata.get("priority");
  const priority = rawPriority ? mapPriority(rawPriority) : undefined;
  if (rawPriority && !priority) {
    warnings.push({
      file: filename,
      field: "priority",
      message: `Unrecognized priority "${rawPriority}". Defaulting to "medium".`,
      severity: "warning",
    });
  }

  // --- Description ---
  const description = extractSection(content, "Description");

  // --- Goal ---
  const goal = extractSection(content, "Goal");
  const fullDescription = [description, goal ? `**Goal:** ${goal}` : ""]
    .filter(Boolean)
    .join("\n\n");

  // --- Acceptance criteria ---
  const acSection = extractSection(content, "Acceptance Criteria");
  const acceptanceCriteria = acSection ? extractCheckboxItems(acSection) : undefined;

  // --- Definition of Done ---
  const dodSection = extractSection(content, "Definition of Done");
  const definitionOfDone = dodSection?.trim() || undefined;

  // --- Dependencies ---
  const rawDeps = metadata.get("dependencies");
  const dependencies =
    rawDeps && rawDeps.toLowerCase() !== "none" ? extractDependencyRefs(rawDeps) : undefined;

  // --- External ref ---
  const externalRef = extractExternalRef(filename);

  // --- Scope for suggested file scope ---
  const contextFilesSection = extractSection(content, "Context Files");
  const suggestedFileScope = contextFilesSection
    ? extractFileReferences(contextFilesSection)
    : undefined;

  // --- Metadata extras ---
  const extras: Record<string, unknown> = {};
  const status = metadata.get("status");
  if (status) extras["status"] = status;
  if (rawType) extras["rawType"] = rawType;
  const owner = metadata.get("owner");
  if (owner) extras["owner"] = owner;
  const epic = metadata.get("epic");
  if (epic) extras["epic"] = epic;
  const milestone = metadata.get("milestone");
  if (milestone) extras["milestone"] = milestone;
  const tag = metadata.get("tag");
  if (tag) extras["tag"] = tag;
  const aiExecutable = metadata.get("ai executable");
  if (aiExecutable) extras["aiExecutable"] = aiExecutable;
  const humanReview = metadata.get("human review required");
  if (humanReview) extras["humanReviewRequired"] = humanReview;
  const blocks = metadata.get("blocks");
  if (blocks && blocks.toLowerCase() !== "none") {
    extras["blocks"] = extractDependencyRefs(blocks);
  }

  const raw = {
    title,
    taskType: taskType ?? "chore",
    priority: priority ?? undefined,
    description: fullDescription || undefined,
    acceptanceCriteria:
      acceptanceCriteria && acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
    definitionOfDone,
    dependencies: dependencies && dependencies.length > 0 ? dependencies : undefined,
    suggestedFileScope:
      suggestedFileScope && suggestedFileScope.length > 0 ? suggestedFileScope : undefined,
    externalRef,
    source: filename,
    metadata: Object.keys(extras).length > 0 ? extras : undefined,
  };

  // Validate with Zod — collect issues as warnings rather than throwing.
  const parseResult = ImportedTaskSchema.safeParse(raw);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      warnings.push({
        file: filename,
        field: issue.path.join("."),
        message: issue.message,
        severity: "error",
      });
    }
    return { task: null, warnings };
  }

  return { task: parseResult.data, warnings };
}

// ---------------------------------------------------------------------------
// Metadata table parsing
// ---------------------------------------------------------------------------

/**
 * Parse the `| Field | Value |` metadata table from a markdown task file.
 *
 * Handles bold field names (e.g. `**ID**`), separator rows, and value cells
 * that contain markdown links or plain text. Field names are normalised to
 * lowercase for case-insensitive lookup.
 *
 * @param content - Full markdown content.
 * @returns Map of lowercase field name → raw value string.
 */
export function parseMetadataTable(content: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = content.split("\n");

  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect table rows: must start and end with |
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
      if (inTable) break; // Table ended
      continue;
    }

    // Split into cells (ignore first/last empty cells from leading/trailing |)
    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());

    if (cells.length < 2) continue;

    // Skip separator rows (e.g. | --- | --- |)
    if (isSeparatorRow(cells)) {
      inTable = true;
      continue;
    }

    // Skip header row (usually "Field" and "Value")
    if (!inTable) {
      // Check if this looks like a header
      const firstCell = cells[0]!.replace(/\*\*/g, "").toLowerCase();
      if (firstCell === "field") {
        continue;
      }
    }

    inTable = true;

    // Extract field name: strip bold markers
    const fieldName = cells[0]!.replace(/\*\*/g, "").trim().toLowerCase();
    const value = cells[1]!.trim();

    if (fieldName && value) {
      result.set(fieldName, value);
    }
  }

  return result;
}

/**
 * Parse bold key-value metadata from markdown content.
 *
 * Extracts `**Key:** value` pairs that appear before the first H2 heading.
 * Also handles backtick-wrapped values (`**Key:** \`value\``) and
 * colon-separated variants (`**Key**: value`).
 *
 * This covers markdown backlogs that use bold front-matter instead of
 * metadata tables:
 * ```markdown
 * **Status:** `done`
 * **Priority:** high
 * **Dependencies:** M12-006, M8
 * ```
 *
 * @param content - Full markdown content.
 * @returns Map of lowercase field name → raw value string.
 */
export function parseBoldMetadata(content: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = content.split("\n");

  // Bold key-value patterns:
  // 1. **Key:** value  (colon inside bold)
  // 2. **Key**: value  (colon outside bold)
  const boldPatternInside = /^\*\*([^*]+?):\*\*\s*(.+)/;
  const boldPatternOutside = /^\*\*([^*]+?)\*\*:\s*(.+)/;

  for (const line of lines) {
    const trimmed = line.trim();

    // Stop at the first H2 heading — metadata should be in the front matter
    if (/^##\s/.test(trimmed)) break;

    // Skip table rows — those are handled by parseMetadataTable
    if (trimmed.startsWith("|")) continue;

    const match = trimmed.match(boldPatternInside) ?? trimmed.match(boldPatternOutside);
    if (match) {
      const key = match[1]!.trim().toLowerCase();
      // Strip backticks and surrounding whitespace from value
      const rawValue = match[2]!.trim().replace(/^`|`$/g, "");
      if (key && rawValue) {
        result.set(key, rawValue);
      }
    }
  }

  return result;
}

/**
 * Extract the text content under a given H2 heading (`## Heading`).
 *
 * Captures all content between the target heading and the next heading of
 * equal or higher level (H1 or H2). Leading/trailing whitespace is stripped.
 *
 * @param content - Full markdown content.
 * @param heading - The heading text to search for (case-insensitive).
 * @returns Section content, or `undefined` if the heading was not found.
 */
export function extractSection(content: string, heading: string): string | undefined {
  const lines = content.split("\n");
  const headingLower = heading.toLowerCase();

  let capturing = false;
  const captured: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for heading match
    if (isH2(trimmed)) {
      if (capturing) break; // Next H2 found — stop capturing.
      const headingText = trimmed
        .replace(/^##\s+/, "")
        .trim()
        .toLowerCase();
      if (headingText === headingLower) {
        capturing = true;
        continue;
      }
    }

    // Stop at H1 if we're already capturing
    if (capturing && /^#\s+/.test(trimmed)) break;

    if (capturing) {
      captured.push(line);
    }
  }

  const result = captured.join("\n").trim();
  return result || undefined;
}

// ---------------------------------------------------------------------------
// Checkbox / list extraction
// ---------------------------------------------------------------------------

/**
 * Extract checkbox items from markdown content.
 *
 * Matches lines like `- [ ] Some criterion` or `- [x] Done criterion`,
 * stripping the checkbox prefix to return just the text.
 *
 * @param content - Section content that may contain checkbox lists.
 * @returns Array of criterion text strings (without checkbox markers).
 */
export function extractCheckboxItems(content: string): string[] {
  const items: string[] = [];
  const lines = content.split("\n");
  const checkboxPattern = /^[-*]\s+\[[ xX]\]\s+(.+)/;

  for (const line of lines) {
    const match = line.trim().match(checkboxPattern);
    if (match) {
      items.push(match[1]!.trim());
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Dependency extraction
// ---------------------------------------------------------------------------

/**
 * Extract task reference IDs from a dependency string.
 *
 * Handles markdown links like `[T002](./T002-filename.md)` as well as
 * plain references like `T002`. Multiple references are comma-separated.
 *
 * @param raw - Raw dependency value from the metadata table.
 * @returns Array of task reference strings (e.g. `["T002", "T003"]`).
 */
export function extractDependencyRefs(raw: string): string[] {
  const refs: string[] = [];
  // Match [TXXX](...) markdown links or standalone TXXX references
  const linkPattern = /\[(T\d+)\]/g;
  let match: RegExpExecArray | null;

  match = linkPattern.exec(raw);
  while (match !== null) {
    refs.push(match[1]!);
    match = linkPattern.exec(raw);
  }

  // If no markdown links found, try plain comma-separated refs
  if (refs.length === 0) {
    const plainPattern = /\b(T\d+)\b/g;
    match = plainPattern.exec(raw);
    while (match !== null) {
      refs.push(match[1]!);
      match = plainPattern.exec(raw);
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// External ref extraction
// ---------------------------------------------------------------------------

/**
 * Extract the task external reference from a filename.
 *
 * Matches patterns like `T045` from `T045-copilot-cli-adapter.md`.
 *
 * @param filename - Basename of the task file.
 * @returns External reference string, or `undefined` if no pattern matched.
 */
export function extractExternalRef(filename: string): string | undefined {
  const match = filename.match(/^(T\d+)/i);
  return match ? match[1]!.toUpperCase() : undefined;
}

// ---------------------------------------------------------------------------
// File reference extraction
// ---------------------------------------------------------------------------

/**
 * Extract file paths from a Context Files section.
 *
 * Looks for backtick-quoted paths or lines that look like file paths
 * (containing `/` and a file extension).
 *
 * @param content - Context Files section content.
 * @returns Array of file path strings.
 */
export function extractFileReferences(content: string): string[] {
  const paths: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    // Match backtick-quoted paths: `path/to/file.ts`
    const backtickMatches = line.matchAll(/`([^`]+\.[a-zA-Z]+)`/g);
    for (const m of backtickMatches) {
      paths.push(m[1]!);
    }
  }

  return [...new Set(paths)]; // Deduplicate
}

// ---------------------------------------------------------------------------
// Title extraction
// ---------------------------------------------------------------------------

/**
 * Extract the task title from the first H1 heading in the document.
 *
 * Strips common prefixes like "T045:" or "T045 -" to produce a clean title.
 * Falls back to the metadata table's ID field combined with the filename.
 *
 * @param content - Full markdown content.
 * @param metadata - Parsed metadata table for fallback.
 * @returns Cleaned title string, or `undefined` if none found.
 */
export function extractTitle(content: string, metadata: Map<string, string>): string | undefined {
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#\s+/.test(trimmed) && !isH2(trimmed)) {
      // Strip the # prefix and any task ID prefix like "T045: " or "T045 - "
      let title = trimmed.replace(/^#\s+/, "").trim();

      // Remove task ID prefix patterns: "T045: ", "T045 - ", "T045 – "
      title = title.replace(/^T\d+[\s]*[:–-]\s*/, "").trim();

      return title || undefined;
    }
  }

  // Fallback: use metadata ID
  const id = metadata.get("id");
  return id ? `Task ${id}` : undefined;
}

// ---------------------------------------------------------------------------
// Index file parsing
// ---------------------------------------------------------------------------

/**
 * Result of parsing the backlog `index.md` file.
 */
export interface ParseIndexResult {
  /** Ordered list of task external refs found in tables. */
  taskOrder: string[];
  /** Discovered project name from the document title. */
  projectName: string | undefined;
  /** Warnings generated during parsing. */
  warnings: ParseWarning[];
}

/**
 * Parse `index.md` for task ordering hints and project metadata.
 *
 * Scans tables in the index file for task ID references (e.g. `T045`)
 * and captures their order. Also extracts the project name from the
 * first H1 heading.
 *
 * @param content - Raw markdown content of index.md.
 * @returns Parsed ordering, project name, and any warnings.
 */
export function parseIndexFile(content: string): ParseIndexResult {
  const warnings: ParseWarning[] = [];
  const taskOrder: string[] = [];
  const seen = new Set<string>();

  const lines = content.split("\n");
  let projectName: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();

    // Extract project name from H1
    if (!projectName && /^#\s+/.test(trimmed) && !isH2(trimmed)) {
      projectName = trimmed.replace(/^#\s+/, "").trim() || undefined;
    }

    // Extract task refs from table rows
    if (trimmed.startsWith("|")) {
      const refPattern = /\b(T\d+)\b/g;
      let match: RegExpExecArray | null;
      match = refPattern.exec(trimmed);
      while (match !== null) {
        const ref = match[1]!;
        if (!seen.has(ref)) {
          seen.add(ref);
          taskOrder.push(ref);
        }
        match = refPattern.exec(trimmed);
      }
    }
  }

  return { taskOrder, projectName, warnings };
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * Reorder tasks according to the ordering from `index.md`.
 *
 * Tasks whose {@link ImportedTask.externalRef} appears in {@link ordering}
 * are placed first in that order. Remaining tasks are appended at the end
 * in their original order.
 *
 * @param tasks - Unordered tasks from parsing.
 * @param ordering - Task refs in desired order.
 * @returns Reordered tasks array.
 */
export function applyOrdering(
  tasks: readonly ImportedTask[],
  ordering: readonly string[],
): ImportedTask[] {
  const byRef = new Map<string, ImportedTask>();
  const noRef: ImportedTask[] = [];

  for (const task of tasks) {
    if (task.externalRef) {
      byRef.set(task.externalRef, task);
    } else {
      noRef.push(task);
    }
  }

  const ordered: ImportedTask[] = [];
  for (const ref of ordering) {
    const task = byRef.get(ref);
    if (task) {
      ordered.push(task);
      byRef.delete(ref);
    }
  }

  // Append tasks not mentioned in index ordering
  for (const task of byRef.values()) {
    ordered.push(task);
  }

  // Append tasks without external refs
  ordered.push(...noRef);

  return ordered;
}

// ---------------------------------------------------------------------------
// Field mapping helpers
// ---------------------------------------------------------------------------

/** Map from raw markdown task type to domain TaskType enum value. */
const TASK_TYPE_MAP: Record<string, string> = {
  feature: "feature",
  bug_fix: "bug_fix",
  bugfix: "bug_fix",
  "bug fix": "bug_fix",
  bug: "bug_fix",
  refactor: "refactor",
  refactoring: "refactor",
  chore: "chore",
  documentation: "documentation",
  docs: "documentation",
  test: "test",
  testing: "test",
  spike: "spike",
  research: "spike",
  // Backlog-specific types that map to chore
  foundation: "chore",
  infrastructure: "chore",
  integration: "feature",
  validation: "test",
  config: "chore",
  observability: "chore",
};

/**
 * Map a raw task type string from the metadata table to a valid domain
 * {@link TaskType} enum value.
 *
 * @param rawType - The raw type string (case-insensitive).
 * @returns The mapped TaskType, or `undefined` if no mapping exists.
 */
export function mapTaskType(rawType: string): string | undefined {
  return TASK_TYPE_MAP[rawType.toLowerCase().trim()];
}

/** Map from raw priority label to domain TaskPriority enum value. */
const PRIORITY_MAP: Record<string, string> = {
  p0: "critical",
  p1: "high",
  p2: "medium",
  p3: "low",
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

/**
 * Map a raw priority string from the metadata table to a valid domain
 * {@link TaskPriority} enum value.
 *
 * @param rawPriority - The raw priority string (case-insensitive).
 * @returns The mapped TaskPriority, or `undefined` if no mapping exists.
 */
export function mapPriority(rawPriority: string): string | undefined {
  return PRIORITY_MAP[rawPriority.toLowerCase().trim()];
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Recursively find all `.md` files in a directory tree.
 *
 * Uses the injected {@link FileSystem.readdir} to walk subdirectories.
 * Skips hidden directories (starting with `.`).
 *
 * @param dirPath - Root directory to search.
 * @param fs - Filesystem abstraction.
 * @returns Sorted array of absolute file paths.
 */
export async function findMarkdownFiles(dirPath: string, fs: FileSystem): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dirPath);

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory) {
      const nested = await findMarkdownFiles(fullPath, fs);
      results.push(...nested);
    } else if (entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/** Check whether a table row's cells are all separator dashes. */
function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^[-:]+$/.test(cell.trim()));
}

/** Check whether a line is an H2 heading. */
function isH2(line: string): boolean {
  return /^##\s+/.test(line) && !/^###/.test(line);
}
