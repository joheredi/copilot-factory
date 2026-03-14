/**
 * AI-powered task classifier for the import pipeline.
 *
 * Uses GitHub Models API (via `gh auth token`) to classify imported tasks
 * with accurate `taskType` and `status` values by analyzing the full task
 * content — title, description, acceptance criteria, and any raw metadata.
 *
 * This replaces rigid deterministic mapping for task type and status
 * inference, providing flexibility across arbitrary markdown formats and
 * natural-language descriptions.
 *
 * Falls back gracefully to the deterministic defaults ("chore" / "BACKLOG")
 * when the AI service is unavailable (no token, network errors, etc.).
 *
 * @module import/ai-task-classifier
 */

import type { ImportedTask, ParseWarning } from "@factory/schemas";
import type { ImportedTaskStatus } from "@factory/schemas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for classifying a single task. */
export interface TaskClassificationInput {
  /** Task title. */
  title: string;
  /** Full description text (may include goal, scope, etc.). */
  description?: string;
  /** Acceptance criteria items. */
  acceptanceCriteria?: string[];
  /** Raw type string from the source (e.g., "foundation", "enhancement"). */
  rawType?: string;
  /** Raw status string from the source (e.g., "done", "in progress"). */
  rawStatus?: string;
}

/** Classification result for a single task. */
export interface TaskClassificationResult {
  taskType: ImportedTask["taskType"];
  status: ImportedTaskStatus;
}

/** Retry configuration for rate-limit resilience. */
export interface RetryOptions {
  /** Maximum number of retries per batch (default: 3). */
  maxRetries?: number;
  /** Initial backoff delay in ms when Retry-After is absent (default: 2000). */
  initialDelayMs?: number;
  /** Delay in ms between consecutive batches to avoid hitting rate limits (default: 500). */
  interBatchDelayMs?: number;
}

/** Dependencies injectable for testing. */
export interface AiClassifierDeps {
  /** Function that returns a GitHub token. Override in tests. */
  getToken: () => Promise<string | null>;
  /** Function that makes HTTP requests. Override in tests. */
  fetchFn: typeof fetch;
  /** Optional progress callback invoked after each batch completes. */
  onProgress?: (classified: number, total: number) => void;
  /** Optional callback when a batch is being retried after a rate limit. */
  onRetry?: (batchNumber: number, waitMs: number, attempt: number, maxRetries: number) => void;
  /** Retry configuration. */
  retryOptions?: RetryOptions;
  /** Sleep function — injectable for testing. Defaults to real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_MODELS_URL = "https://models.inference.ai.azure.com/chat/completions";
const MODEL = "gpt-4o-mini";
/** Max tasks per API call to stay under the 8K token limit. */
const BATCH_SIZE = 20;

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 2_000;
const DEFAULT_INTER_BATCH_DELAY_MS = 500;
/** Never wait longer than 2 minutes for a single retry. */
const MAX_WAIT_MS = 120_000;

const VALID_TASK_TYPES = [
  "feature",
  "bug_fix",
  "refactor",
  "chore",
  "documentation",
  "test",
  "spike",
] as const;
const VALID_STATUSES = ["BACKLOG", "DONE", "CANCELLED"] as const;

/** Status codes that indicate a transient/rate-limit error worth retrying. */
const RETRYABLE_STATUS_CODES = new Set([429, 503]);

// ---------------------------------------------------------------------------
// Sleep & rate-limit helpers
// ---------------------------------------------------------------------------

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract the number of seconds to wait from a 429 response.
 *
 * Checks (in order):
 * 1. `Retry-After` response header (seconds)
 * 2. `"Please wait N seconds"` pattern in the response body
 *
 * Returns the wait time in milliseconds, clamped to {@link MAX_WAIT_MS},
 * or `undefined` if no hint is found.
 */
function parseRetryAfter(response: Response, body: string): number | undefined {
  // 1. Standard Retry-After header
  const headerVal = response.headers.get("retry-after");
  if (headerVal) {
    const seconds = Number(headerVal);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1_000, MAX_WAIT_MS);
    }
  }

  // 2. Body pattern: "Please wait N seconds"
  const match = body.match(/wait\s+(\d+)\s+second/i);
  if (match?.[1]) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1_000, MAX_WAIT_MS);
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildClassificationPrompt(tasks: TaskClassificationInput[]): string {
  const taskDescriptions = tasks.map((t, i) => {
    const parts = [`Task ${i}:`, `  Title: ${t.title}`];
    if (t.description) parts.push(`  Description: ${t.description.slice(0, 500)}`);
    if (t.acceptanceCriteria?.length) {
      parts.push(`  Acceptance Criteria: ${t.acceptanceCriteria.join("; ").slice(0, 300)}`);
    }
    if (t.rawType) parts.push(`  Source Type: ${t.rawType}`);
    if (t.rawStatus) parts.push(`  Source Status: ${t.rawStatus}`);
    return parts.join("\n");
  });

  return `Classify each task below. For each, determine:
1. taskType: one of ${VALID_TASK_TYPES.join(", ")}
2. status: one of ${VALID_STATUSES.join(", ")}

taskType guidelines:
- "feature" = new functionality, capabilities, integrations, API endpoints, UI components
- "bug_fix" = fixing broken behavior, errors, regressions
- "refactor" = restructuring existing code without changing behavior
- "chore" = maintenance, configuration, build system, dependency updates
- "documentation" = docs, README, comments, API docs
- "test" = adding or improving tests, test infrastructure, validation
- "spike" = research, investigation, proof of concept, exploration

status guidelines:
- "DONE" = completed, finished, merged, closed, shipped, implemented, resolved
- "CANCELLED" = cancelled, abandoned, won't do, dropped, rejected, obsolete
- "BACKLOG" = everything else (not started, in progress, planned, blocked, pending)

Reply with ONLY a JSON array of objects, one per task, in order:
[{"taskType":"...","status":"..."},...]

${taskDescriptions.join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

/**
 * Get a GitHub token from the `gh` CLI.
 *
 * Uses `gh auth token` which works when the user is authenticated with
 * the GitHub CLI. Returns null if the command fails.
 */
export async function getGitHubToken(): Promise<string | null> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("gh", ["auth", "token"], { timeout: 5000 });
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core classifier
// ---------------------------------------------------------------------------

/** Error subclass that carries the HTTP status and response body for retryable errors. */
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly response: Response,
    readonly body: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Classify an array of imported tasks using GitHub Models API.
 *
 * Splits tasks into batches of {@link BATCH_SIZE} to stay under the
 * API token limit, then merges results back in order. Falls back to
 * deterministic defaults when AI is unavailable.
 *
 * Rate-limit resilience:
 * - Adds a configurable inter-batch delay to spread token usage.
 * - Retries 429/503 errors with exponential backoff, honouring the
 *   `Retry-After` header or the body's "wait N seconds" hint.
 * - Falls back to deterministic classification only after retries
 *   are exhausted.
 *
 * @param tasks - Tasks to classify.
 * @param deps - Injectable dependencies (token resolution, fetch).
 * @returns Classification results aligned by index with the input array,
 *   plus any warnings generated.
 */
export async function classifyImportedTasks(
  tasks: TaskClassificationInput[],
  deps: Partial<AiClassifierDeps> = {},
): Promise<{ results: TaskClassificationResult[]; warnings: ParseWarning[] }> {
  const warnings: ParseWarning[] = [];

  if (tasks.length === 0) {
    return { results: [], warnings };
  }

  const getToken = deps.getToken ?? getGitHubToken;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const sleepFn = deps.sleep ?? defaultSleep;
  const maxRetries = deps.retryOptions?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelayMs = deps.retryOptions?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const interBatchDelayMs = deps.retryOptions?.interBatchDelayMs ?? DEFAULT_INTER_BATCH_DELAY_MS;

  // ── Check token availability ───────────────────────────────────────────
  const token = await getToken();
  if (!token) {
    warnings.push({
      file: "ai-classifier",
      field: "auth",
      message:
        "GitHub token not available — falling back to deterministic classification. " +
        "Run `gh auth login` to enable AI-powered task classification.",
      severity: "info",
    });
    return { results: tasks.map(deterministicFallback), warnings };
  }

  // ── Classify in batches with retry ─────────────────────────────────────
  const allResults: TaskClassificationResult[] = [];
  const onProgress = deps.onProgress;
  const totalBatches = Math.ceil(tasks.length / BATCH_SIZE);

  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    let succeeded = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const batchResults = await classifyBatch(batch, token, fetchFn);
        allResults.push(...batchResults);
        succeeded = true;
        break;
      } catch (err: unknown) {
        const isRetryable = err instanceof ApiError && RETRYABLE_STATUS_CODES.has(err.status);

        if (!isRetryable || attempt === maxRetries) {
          // Non-retryable or retries exhausted → deterministic fallback
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push({
            file: "ai-classifier",
            field: "classification",
            message: `AI classification failed for batch ${batchNumber}: ${msg}. Using deterministic fallback for this batch.`,
            severity: "warning",
          });
          allResults.push(...batch.map(deterministicFallback));
          succeeded = true; // Mark as handled (via fallback)
          break;
        }

        // Compute wait time: prefer API hint, fall back to exponential backoff
        const apiHintMs = parseRetryAfter(err.response, err.body);
        const backoffMs = initialDelayMs * Math.pow(2, attempt);
        const waitMs = Math.min(apiHintMs ?? backoffMs, MAX_WAIT_MS);

        if (deps.onRetry) {
          deps.onRetry(batchNumber, waitMs, attempt + 1, maxRetries);
        }

        await sleepFn(waitMs);
      }
    }

    // Defensive: should never happen, but ensures allResults stays aligned
    if (!succeeded) {
      allResults.push(...batch.map(deterministicFallback));
    }

    if (onProgress) {
      onProgress(Math.min(i + BATCH_SIZE, tasks.length), tasks.length);
    }

    // Inter-batch delay to proactively avoid rate limits (skip after last batch)
    if (batchNumber < totalBatches) {
      await sleepFn(interBatchDelayMs);
    }
  }

  return { results: allResults, warnings };
}

/**
 * Classify a single batch of tasks via the GitHub Models API.
 *
 * Throws {@link ApiError} for non-OK responses so the caller can
 * distinguish retryable from non-retryable failures.
 *
 * @internal
 */
async function classifyBatch(
  batch: TaskClassificationInput[],
  token: string,
  fetchFn: typeof fetch,
): Promise<TaskClassificationResult[]> {
  const prompt = buildClassificationPrompt(batch);

  const response = await fetchFn(GITHUB_MODELS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: Math.max(100, batch.length * 30),
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ApiError(
      `GitHub Models API returned ${response.status}: ${body.slice(0, 200)}`,
      response.status,
      response,
      body,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Empty response from GitHub Models API");
  }

  const parsed = parseClassificationResponse(content, batch.length);

  // If the model returned fewer results than expected, use what we got
  // and fill the rest with deterministic fallback.
  if (parsed.length < batch.length) {
    for (let i = parsed.length; i < batch.length; i++) {
      parsed.push(deterministicFallback(batch[i]!));
    }
  }

  // If the model returned more, truncate to match batch size.
  return parsed.slice(0, batch.length);
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Parse the LLM response into structured classification results.
 *
 * Handles cases where the model wraps JSON in markdown code fences or
 * includes extra text around the array.
 */
export function parseClassificationResponse(
  content: string,
  _expectedCount: number,
): TaskClassificationResult[] {
  // Strip markdown code fences if present
  let cleaned = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

  // Extract the JSON array from the response
  const arrayStart = cleaned.indexOf("[");
  const arrayEnd = cleaned.lastIndexOf("]");
  if (arrayStart === -1 || arrayEnd === -1) {
    throw new Error("No JSON array found in response");
  }
  cleaned = cleaned.slice(arrayStart, arrayEnd + 1);

  const raw = JSON.parse(cleaned) as unknown[];
  if (!Array.isArray(raw)) {
    throw new Error("Parsed response is not an array");
  }

  return raw.map((item) => {
    const obj = item as Record<string, unknown>;
    const taskType = normalizeTaskType(obj["taskType"] as string);
    const status = normalizeStatus(obj["status"] as string);

    if (!taskType || !status) {
      // Fall back for this individual task if the model produced bad values
      return {
        taskType: taskType ?? "chore",
        status: status ?? "BACKLOG",
      };
    }

    return { taskType, status };
  });
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeTaskType(raw: string | undefined): ImportedTask["taskType"] | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase().trim();
  if ((VALID_TASK_TYPES as readonly string[]).includes(lower)) {
    return lower as ImportedTask["taskType"];
  }
  // Handle common LLM variants
  if (lower === "bugfix" || lower === "bug fix" || lower === "bug") return "bug_fix";
  if (lower === "docs") return "documentation";
  if (lower === "research") return "spike";
  return undefined;
}

function normalizeStatus(raw: string | undefined): ImportedTaskStatus | undefined {
  if (!raw) return undefined;
  const upper = raw.toUpperCase().trim();
  if ((VALID_STATUSES as readonly string[]).includes(upper)) {
    return upper as ImportedTaskStatus;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Deterministic fallback
// ---------------------------------------------------------------------------

/** Simple rule-based mapping used when AI is unavailable. */
const STATUS_MAP: Record<string, ImportedTaskStatus> = {
  done: "DONE",
  completed: "DONE",
  complete: "DONE",
  finished: "DONE",
  merged: "DONE",
  closed: "DONE",
  shipped: "DONE",
  resolved: "DONE",
  implemented: "DONE",
  cancelled: "CANCELLED",
  canceled: "CANCELLED",
  abandoned: "CANCELLED",
  "won't do": "CANCELLED",
  wontdo: "CANCELLED",
  dropped: "CANCELLED",
  rejected: "CANCELLED",
  obsolete: "CANCELLED",
};

const TYPE_FALLBACK_MAP: Record<string, ImportedTask["taskType"]> = {
  feature: "feature",
  enhancement: "feature",
  improvement: "feature",
  bug_fix: "bug_fix",
  bugfix: "bug_fix",
  "bug fix": "bug_fix",
  bug: "bug_fix",
  fix: "bug_fix",
  refactor: "refactor",
  refactoring: "refactor",
  chore: "chore",
  maintenance: "chore",
  foundation: "chore",
  infrastructure: "chore",
  config: "chore",
  configuration: "chore",
  observability: "chore",
  setup: "chore",
  documentation: "documentation",
  docs: "documentation",
  test: "test",
  testing: "test",
  validation: "test",
  spike: "spike",
  research: "spike",
  investigation: "spike",
  exploration: "spike",
  integration: "feature",
};

function deterministicFallback(input: TaskClassificationInput): TaskClassificationResult {
  const rawStatus = input.rawStatus?.toLowerCase().trim() ?? "";
  const rawType = input.rawType?.toLowerCase().trim() ?? "";

  return {
    taskType: TYPE_FALLBACK_MAP[rawType] ?? "chore",
    status: STATUS_MAP[rawStatus] ?? "BACKLOG",
  };
}
