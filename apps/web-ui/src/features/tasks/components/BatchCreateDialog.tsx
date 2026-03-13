/**
 * Batch Create Tasks dialog component.
 *
 * Provides a modal dialog where operators can paste a JSON array of task
 * objects to create multiple tasks at once. Includes client-side validation
 * with per-item error reporting and a preview summary before submission.
 *
 * Flow:
 * 1. Operator pastes JSON array into monospace textarea
 * 2. Clicks "Validate" to parse and check required fields
 * 3. Preview shows count of valid tasks or lists validation errors
 * 4. Clicks "Create Tasks" to submit the batch via useCreateTaskBatch
 * 5. Success feedback shows count; dialog closes and task list refreshes
 *
 * @see T130 — Add Batch Task Import UI to Tasks page
 * @see docs/prd/007-technical-architecture.md §7.16
 */

import { useCallback, useMemo, useState } from "react";
import { useCreateTaskBatch } from "../../../api/hooks/use-tasks";
import { Button } from "../../../components/ui/button";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import type { CreateTaskInput } from "../../../api/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Valid values for the taskType field. */
const VALID_TASK_TYPES = new Set([
  "feature",
  "bug_fix",
  "refactor",
  "chore",
  "documentation",
  "test",
  "spike",
]);

/** Valid values for the priority field. */
const VALID_PRIORITIES = new Set(["critical", "high", "medium", "low"]);

/** Valid values for the source field. */
const VALID_SOURCES = new Set(["manual", "automated", "follow_up", "decomposition"]);

/** Valid values for the estimatedSize field. */
const VALID_SIZES = new Set(["xs", "s", "m", "l", "xl"]);

/** Valid values for the riskLevel field. */
const VALID_RISK_LEVELS = new Set(["high", "medium", "low"]);

/** Example JSON shown as placeholder text. */
const PLACEHOLDER_JSON = `[
  {
    "repositoryId": "repo-id",
    "title": "Implement feature X",
    "taskType": "feature",
    "priority": "high"
  }
]`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the BatchCreateDialog component. */
interface BatchCreateDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Callback when the dialog open state changes. */
  readonly onOpenChange: (open: boolean) => void;
}

/** Result of validating the JSON input. */
interface ValidationResult {
  /** Whether all tasks passed validation. */
  readonly valid: boolean;
  /** Validated task objects (only populated when valid is true). */
  readonly tasks: CreateTaskInput[];
  /** Per-item validation error messages. */
  readonly errors: string[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates a single task object against the CreateTaskInput schema.
 * Returns an array of error messages (empty if valid).
 *
 * Checks all required fields (repositoryId, title, taskType, priority)
 * and validates enum values for optional fields when present.
 *
 * @param item - The object to validate
 * @param index - Zero-based index for error reporting
 * @returns Array of error strings (empty means valid)
 */
function validateTaskItem(item: unknown, index: number): string[] {
  const errors: string[] = [];
  const label = `Task ${index + 1}`;

  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    errors.push(`${label}: must be an object`);
    return errors;
  }

  const obj = item as Record<string, unknown>;

  // Required fields
  if (typeof obj.repositoryId !== "string" || obj.repositoryId.trim().length === 0) {
    errors.push(`${label}: missing or empty "repositoryId"`);
  }
  if (typeof obj.title !== "string" || obj.title.trim().length === 0) {
    errors.push(`${label}: missing or empty "title"`);
  }
  if (obj.title !== undefined && typeof obj.title === "string" && obj.title.length > 500) {
    errors.push(`${label}: "title" exceeds 500 characters`);
  }
  if (typeof obj.taskType !== "string" || !VALID_TASK_TYPES.has(obj.taskType)) {
    errors.push(
      `${label}: invalid "taskType" — must be one of: ${[...VALID_TASK_TYPES].join(", ")}`,
    );
  }
  if (typeof obj.priority !== "string" || !VALID_PRIORITIES.has(obj.priority)) {
    errors.push(
      `${label}: invalid "priority" — must be one of: ${[...VALID_PRIORITIES].join(", ")}`,
    );
  }

  // Optional enum fields
  if (
    obj.source !== undefined &&
    (typeof obj.source !== "string" || !VALID_SOURCES.has(obj.source))
  ) {
    errors.push(`${label}: invalid "source" — must be one of: ${[...VALID_SOURCES].join(", ")}`);
  }
  if (
    obj.estimatedSize !== undefined &&
    (typeof obj.estimatedSize !== "string" || !VALID_SIZES.has(obj.estimatedSize))
  ) {
    errors.push(
      `${label}: invalid "estimatedSize" — must be one of: ${[...VALID_SIZES].join(", ")}`,
    );
  }
  if (
    obj.riskLevel !== undefined &&
    (typeof obj.riskLevel !== "string" || !VALID_RISK_LEVELS.has(obj.riskLevel))
  ) {
    errors.push(
      `${label}: invalid "riskLevel" — must be one of: ${[...VALID_RISK_LEVELS].join(", ")}`,
    );
  }

  // Optional string fields
  if (obj.description !== undefined && typeof obj.description !== "string") {
    errors.push(`${label}: "description" must be a string`);
  }
  if (obj.externalRef !== undefined && typeof obj.externalRef !== "string") {
    errors.push(`${label}: "externalRef" must be a string`);
  }
  if (obj.severity !== undefined && typeof obj.severity !== "string") {
    errors.push(`${label}: "severity" must be a string`);
  }

  // Optional string array fields
  for (const field of [
    "acceptanceCriteria",
    "definitionOfDone",
    "requiredCapabilities",
    "suggestedFileScope",
  ]) {
    if (obj[field] !== undefined) {
      if (!Array.isArray(obj[field])) {
        errors.push(`${label}: "${field}" must be an array of strings`);
      } else if (!(obj[field] as unknown[]).every((v) => typeof v === "string")) {
        errors.push(`${label}: "${field}" must contain only strings`);
      }
    }
  }

  return errors;
}

/**
 * Parses and validates a JSON string as an array of CreateTaskInput objects.
 *
 * Performs two levels of validation:
 * 1. JSON syntax — must be a parseable JSON array
 * 2. Schema validation — each item is checked against required fields
 *    and enum constraints
 *
 * @param jsonStr - Raw JSON string from the textarea
 * @returns ValidationResult with valid flag, parsed tasks, and error list
 */
function validateJsonInput(jsonStr: string): ValidationResult {
  const trimmed = jsonStr.trim();
  if (trimmed.length === 0) {
    return { valid: false, tasks: [], errors: ["JSON input is empty"] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { valid: false, tasks: [], errors: ["Invalid JSON syntax. Please check your input."] };
  }

  if (!Array.isArray(parsed)) {
    return { valid: false, tasks: [], errors: ["Input must be a JSON array of task objects."] };
  }

  if (parsed.length === 0) {
    return { valid: false, tasks: [], errors: ["Array is empty. Provide at least one task."] };
  }

  const allErrors: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const itemErrors = validateTaskItem(parsed[i], i);
    allErrors.push(...itemErrors);
  }

  if (allErrors.length > 0) {
    return { valid: false, tasks: [], errors: allErrors };
  }

  return { valid: true, tasks: parsed as CreateTaskInput[], errors: [] };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Modal dialog for batch-creating tasks from a JSON array.
 *
 * Renders a monospace textarea where operators paste a JSON array of task
 * objects. Provides a "Validate" button for client-side validation with
 * detailed per-item error reporting, followed by a "Create Tasks" button
 * that submits the validated batch.
 *
 * The dialog prevents closing during pending mutations and resets all
 * state when closed.
 */
export function BatchCreateDialog({ open, onOpenChange }: BatchCreateDialogProps) {
  const [jsonInput, setJsonInput] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createBatch = useCreateTaskBatch();

  /** Resets all dialog state to initial values. */
  const resetState = useCallback(() => {
    setJsonInput("");
    setValidation(null);
    setError(null);
  }, []);

  /** Handles dialog open/close — resets state on close if not submitting. */
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !createBatch.isPending) {
        resetState();
      }
      onOpenChange(nextOpen);
    },
    [createBatch.isPending, onOpenChange, resetState],
  );

  /** Handles textarea changes — clears previous validation and errors. */
  const handleJsonChange = useCallback((value: string) => {
    setJsonInput(value);
    setValidation(null);
    setError(null);
  }, []);

  /** Runs client-side validation on the current JSON input. */
  const handleValidate = useCallback(() => {
    const result = validateJsonInput(jsonInput);
    setValidation(result);
    setError(null);
  }, [jsonInput]);

  /** Submits the validated batch of tasks. */
  const handleSubmit = useCallback(() => {
    if (!validation?.valid || createBatch.isPending) return;

    createBatch.mutate(validation.tasks, {
      onSuccess: () => {
        resetState();
        onOpenChange(false);
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : "Failed to create tasks. Please try again.");
      },
    });
  }, [validation, createBatch, resetState, onOpenChange]);

  /** Whether the Create button should be enabled. */
  const canSubmit = useMemo(
    () => validation?.valid === true && !createBatch.isPending,
    [validation, createBatch.isPending],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="batch-create-dialog">
        <DialogHeader>
          <DialogTitle data-testid="batch-create-dialog-title">Create Batch</DialogTitle>
          <DialogDescription>
            Paste a JSON array of task objects to create multiple tasks at once. Each task requires{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">repositoryId</code>,{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">title</code>,{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">taskType</code>, and{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">priority</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
          {/* JSON textarea */}
          <div className="space-y-2">
            <Label htmlFor="batch-json-input">Task JSON *</Label>
            <Textarea
              id="batch-json-input"
              className="font-mono text-sm min-h-[200px]"
              placeholder={PLACEHOLDER_JSON}
              value={jsonInput}
              onChange={(e) => handleJsonChange(e.target.value)}
              disabled={createBatch.isPending}
              data-testid="batch-json-input"
            />
          </div>

          {/* Validate button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleValidate}
            disabled={jsonInput.trim().length === 0 || createBatch.isPending}
            data-testid="batch-validate-button"
          >
            Validate
          </Button>

          {/* Validation success preview */}
          {validation?.valid && (
            <div
              className="rounded-md border border-green-500/50 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400"
              data-testid="batch-validation-success"
            >
              ✓ {validation.tasks.length} task{validation.tasks.length !== 1 ? "s" : ""} ready to
              create
            </div>
          )}

          {/* Validation errors */}
          {validation && !validation.valid && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive space-y-1"
              role="alert"
              data-testid="batch-validation-errors"
            >
              <p className="font-medium">Validation failed:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {validation.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Submission error */}
          {error && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
              data-testid="batch-create-error"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={createBatch.isPending}
            data-testid="batch-create-cancel"
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} data-testid="batch-create-submit">
            {createBatch.isPending
              ? "Creating…"
              : `Create${validation?.valid ? ` ${validation.tasks.length}` : ""} Task${validation?.valid && validation.tasks.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Export validation helpers for testing
export { validateJsonInput, validateTaskItem };
