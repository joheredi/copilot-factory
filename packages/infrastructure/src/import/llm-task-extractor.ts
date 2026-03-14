/**
 * LLM-based task extractor for the import pipeline.
 *
 * Uses `@github/copilot-sdk` to send markdown task file content to an LLM
 * and receive structured {@link ImportedTask} data back. This replaces the
 * deterministic regex-based parsing with intelligent extraction that handles
 * arbitrary markdown formats.
 *
 * Falls back gracefully when the Copilot SDK is unavailable (no CLI, no
 * auth token, API errors). Individual file extraction failures produce
 * warnings rather than hard errors.
 *
 * @module import/llm-task-extractor
 * @see {@link @factory/schemas!ImportedTask} — output contract
 * @see {@link @factory/schemas!ImportManifest} — manifest shape
 */

import type { ImportedTask, ParseWarning } from "@factory/schemas";
import { ImportedTaskSchema } from "@factory/schemas";

// NOTE: @github/copilot-sdk is imported dynamically to avoid ESM resolution
// issues (vscode-jsonrpc) in test environments. See createDefaultClientFactory()
// and extractTasksWithLlm() for the dynamic import points.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal interface for a CopilotClient-like object.
 * Decouples the extractor from the concrete SDK class for testability.
 */
export interface CopilotClientLike {
  start(): Promise<void>;
  createSession(config: unknown): Promise<CopilotSessionLike>;
  stop(): Promise<unknown>;
}

/**
 * Minimal interface for a CopilotSession-like object.
 */
export interface CopilotSessionLike {
  sendAndWait(
    options: { prompt: string },
    timeout?: number,
  ): Promise<{ data?: { content?: string } } | undefined>;
  disconnect(): Promise<void>;
}

/** A markdown file to be processed by the LLM extractor. */
export interface MarkdownFileInput {
  /** Basename of the file (e.g., "T045-copilot-cli-adapter.md"). */
  readonly filename: string;
  /** Raw markdown content of the file. */
  readonly content: string;
}

/** Result of LLM extraction for a batch of files. */
export interface LlmExtractionResult {
  /** Successfully extracted and validated tasks. */
  readonly tasks: ImportedTask[];
  /** Warnings generated during extraction. */
  readonly warnings: ParseWarning[];
  /** Filenames that failed LLM extraction and need deterministic fallback. */
  readonly failedFiles: readonly string[];
}

/**
 * Factory function type for creating a CopilotClient.
 * Injected for testability — tests provide a mock factory.
 */
export type CopilotClientFactory = () => CopilotClientLike;

/** Configuration for the LLM task extractor. */
export interface LlmTaskExtractorConfig {
  /** Model to use for extraction. Defaults to "gpt-4.1". */
  readonly model?: string;
}

/**
 * Dynamically load the `@github/copilot-sdk` module and return a client factory.
 *
 * Uses dynamic import to avoid loading the SDK at module evaluation time
 * (which would break tests due to `vscode-jsonrpc` ESM resolution issues).
 *
 * Use this in production code. Tests should supply a mock factory.
 */
export async function createCopilotClientFactory(): Promise<CopilotClientFactory> {
  const sdk = await import("@github/copilot-sdk");
  return () => new sdk.CopilotClient();
}

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

/**
 * Build the system prompt that instructs the LLM on extraction rules and
 * the expected output schema.
 */
function buildSystemPrompt(): string {
  return `You are a structured data extractor. Your job is to extract task metadata from markdown files into a specific JSON schema.

For each markdown file you receive, extract the following fields into a JSON object:

REQUIRED FIELDS:
- "title" (string, 1-500 chars): The main task title. Strip any task ID prefixes like "T045: " or "M15-005: ".
- "taskType" (string): One of: "feature", "bug_fix", "refactor", "chore", "documentation", "test", "spike"
  Guidelines: "feature" = new functionality/capabilities, "bug_fix" = fixing broken behavior, "refactor" = restructuring without behavior change, "chore" = maintenance/config/build, "documentation" = docs/README, "test" = adding/improving tests, "spike" = research/investigation

OPTIONAL FIELDS (include only when present in the source):
- "priority" (string): One of: "critical", "high", "medium", "low". Default to "medium" if unclear.
- "riskLevel" (string): One of: "high", "medium", "low"
- "estimatedSize" (string): One of: "xs", "s", "m", "l", "xl"
- "acceptanceCriteria" (string[]): List of acceptance criteria items. Strip checkbox markers.
- "definitionOfDone" (string): What constitutes "done" for this task.
- "dependencies" (string[]): Task reference IDs this depends on. ALWAYS extract if a Dependencies field exists in the metadata.
  Common formats: "M15-003, M15-004" → ["M15-003", "M15-004"], "T002, T003" → ["T002", "T003"], "[T002](./T002-file.md)" → ["T002"]
  Look in metadata tables, bold key-value pairs (**Dependencies:** ...), and headed sections.
- "suggestedFileScope" (string[]): File paths or glob patterns mentioned as relevant.
  Look in ANY section — "Context Files", "Files to Create/Modify", "Scope", "Implementation Notes", etc.
  Extract paths from backticks, table cells, and bullet lists.
- "externalRef" (string): Task ID from the filename (e.g., "T045" from "T045-some-task.md", "M15-005" from "M15-005-ownership-api.md").
- "status" (string): One of: "BACKLOG", "DONE", "CANCELLED".
  Mapping guide:
  → "BACKLOG": not-started, to-do, todo, planned, backlog, new, open, pending, in-progress, started, active, blocked, on-hold, or any unrecognized value
  → "DONE": done, complete, completed, finished, shipped, merged, closed, resolved, implemented
  → "CANCELLED": cancelled, canceled, abandoned, dropped, won't-do, wontfix, obsolete
  Default to "BACKLOG" if unclear or not specified.
- "metadata" (object): Any extra fields from the source (owner, epic, milestone, tags, etc.)

IMPORTANT: Do NOT include a "description" field. The full raw markdown content is stored separately as the description.

EXTRACTION RULES:
1. Look for metadata in tables (| Field | Value |), bold key-value pairs (**Key:** value), and headed sections (## Heading).
2. The "source" field will be set automatically — do not include it.
3. For dependencies, extract task refs like "T002" from markdown links [T002](./T002-file.md) or plain text. Also handle milestone-style refs like "M15-003".
4. For acceptanceCriteria, extract items from checkbox lists (- [ ] item) or bullet lists.
5. For suggestedFileScope, look for file paths in backticks in any section that mentions files.

RESPONSE FORMAT:
Respond with ONLY a valid JSON object (no markdown fences, no explanation). The JSON object must have this shape:
{"task": {<fields>}}

If you cannot extract a meaningful task from the content, respond with:
{"task": null, "reason": "explanation"}`;
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

/**
 * Parse and validate an LLM response into an ImportedTask.
 *
 * Handles JSON wrapped in markdown code fences and extracts the task
 * object from the expected `{"task": {...}}` envelope.
 */
export function parseLlmResponse(
  raw: string,
  filename: string,
): { task: ImportedTask | null; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = [];

  // Strip markdown code fences if present
  let cleaned = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  cleaned = cleaned.trim();

  // Find JSON object boundaries
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart === -1 || objEnd === -1) {
    warnings.push({
      file: filename,
      field: "llm-response",
      message: "LLM response did not contain a JSON object",
      severity: "warning",
    });
    return { task: null, warnings };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned.slice(objStart, objEnd + 1)) as Record<string, unknown>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push({
      file: filename,
      field: "llm-response",
      message: `Failed to parse LLM JSON response: ${msg}`,
      severity: "warning",
    });
    return { task: null, warnings };
  }

  // Extract task from envelope
  const taskData = parsed["task"];
  if (taskData === null || taskData === undefined) {
    const reason = (parsed["reason"] as string) ?? "LLM could not extract task";
    warnings.push({
      file: filename,
      field: "llm-extraction",
      message: reason,
      severity: "warning",
    });
    return { task: null, warnings };
  }

  // Inject source filename
  const taskObj = { ...(taskData as Record<string, unknown>), source: filename };

  // Validate against Zod schema
  const result = ImportedTaskSchema.safeParse(taskObj);
  if (!result.success) {
    for (const issue of result.error.issues) {
      warnings.push({
        file: filename,
        field: issue.path.join("."),
        message: `LLM extraction schema error: ${issue.message}`,
        severity: "warning",
      });
    }
    return { task: null, warnings };
  }

  return { task: result.data, warnings };
}

// ---------------------------------------------------------------------------
// LLM Task Extractor
// ---------------------------------------------------------------------------

/**
 * Extract tasks from markdown files using the Copilot SDK.
 *
 * Creates a CopilotClient session with a schema-aware system prompt,
 * sends each markdown file's content, and parses the structured JSON
 * response into validated {@link ImportedTask} objects.
 *
 * @param files - Markdown files to process.
 * @param clientFactory - Factory for creating a CopilotClient instance.
 * @param config - Optional extraction configuration.
 * @returns Extracted tasks, warnings, and list of files that need fallback.
 */
export async function extractTasksWithLlm(
  files: readonly MarkdownFileInput[],
  clientFactory: CopilotClientFactory,
  config?: LlmTaskExtractorConfig,
): Promise<LlmExtractionResult> {
  const tasks: ImportedTask[] = [];
  const warnings: ParseWarning[] = [];
  const failedFiles: string[] = [];

  if (files.length === 0) {
    return { tasks, warnings, failedFiles };
  }

  // Start the Copilot client
  let client: CopilotClientLike;
  try {
    client = clientFactory();
    await client.start();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push({
      file: "llm-extractor",
      field: "client",
      message: `Copilot SDK unavailable — falling back to deterministic parsing. Error: ${msg}`,
      severity: "info",
    });
    return {
      tasks: [],
      warnings,
      failedFiles: files.map((f) => f.filename),
    };
  }

  // Dynamically load approveAll for permission handling
  let approveAllFn: unknown;
  try {
    const sdk = await import("@github/copilot-sdk");
    approveAllFn = sdk.approveAll;
  } catch {
    // If SDK can't be loaded for approveAll, use a simple approve-all function
    approveAllFn = () => ({ kind: "approved" as const });
  }

  let session: CopilotSessionLike | undefined;
  try {
    session = (await client.createSession({
      model: config?.model ?? "gpt-4.1",
      onPermissionRequest: approveAllFn,
      systemMessage: {
        mode: "replace" as const,
        content: buildSystemPrompt(),
      },
    })) as CopilotSessionLike;

    // Process each file in the session
    for (const file of files) {
      try {
        const prompt = `Extract the task from this markdown file (filename: "${file.filename}"):\n\n${file.content}`;

        const response = await session.sendAndWait({ prompt });
        const content = response?.data?.content;

        if (!content) {
          warnings.push({
            file: file.filename,
            field: "llm-response",
            message: "LLM returned empty response",
            severity: "warning",
          });
          failedFiles.push(file.filename);
          continue;
        }

        const parseResult = parseLlmResponse(content, file.filename);
        warnings.push(...parseResult.warnings);

        if (parseResult.task) {
          tasks.push(parseResult.task);
        } else {
          failedFiles.push(file.filename);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push({
          file: file.filename,
          field: "llm-extraction",
          message: `LLM extraction failed: ${msg}`,
          severity: "warning",
        });
        failedFiles.push(file.filename);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push({
      file: "llm-extractor",
      field: "session",
      message: `Failed to create Copilot session — falling back to deterministic parsing. Error: ${msg}`,
      severity: "info",
    });
    return {
      tasks: [],
      warnings,
      failedFiles: files.map((f) => f.filename),
    };
  } finally {
    // Clean up session and client
    try {
      if (session) await session.disconnect();
    } catch {
      // Ignore cleanup errors
    }
    try {
      await client.stop();
    } catch {
      // Ignore cleanup errors
    }
  }

  return { tasks, warnings, failedFiles };
}
