/**
 * Edit Task dialog component.
 *
 * Provides a modal dialog pre-populated with the current task's metadata
 * for editing. Supports all mutable task fields from the UpdateTaskInput
 * interface, with optimistic concurrency control via the `version` field.
 *
 * When submitted, only changed fields are sent in the payload (alongside
 * the required `version`). On success, the dialog closes and the task
 * cache is invalidated. On 409 Conflict (concurrent update), a clear
 * message instructs the user to refresh and retry.
 *
 * @see T129 — Add Edit Task form to Task detail page
 * @see docs/prd/007-technical-architecture.md §7.16
 */

import { useCallback, useEffect, useState } from "react";
import { useUpdateTask } from "../../../api/hooks/use-tasks";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
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
import type { Task, UpdateTaskInput, TaskPriority, TaskSize, RiskLevel } from "../../../api/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Available priority options with display labels. */
const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

/** Available risk level options with display labels. */
const RISK_LEVEL_OPTIONS: { value: RiskLevel; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

/** Available estimated size options with display labels. */
const ESTIMATED_SIZE_OPTIONS: { value: TaskSize; label: string }[] = [
  { value: "xs", label: "XS" },
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
  { value: "xl", label: "XL" },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the EditTaskDialog component. */
interface EditTaskDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Callback when the dialog open state changes. */
  readonly onOpenChange: (open: boolean) => void;
  /** The current task data to pre-populate the form with. */
  readonly task: Task;
}

/**
 * Internal form state for the edit task dialog.
 *
 * All fields are represented as strings so they can be bound directly
 * to form inputs. Array fields (acceptanceCriteria, definitionOfDone,
 * requiredCapabilities, suggestedFileScope) are stored as newline-
 * separated strings and converted back on submit.
 */
interface EditFormState {
  title: string;
  description: string;
  priority: string;
  externalRef: string;
  severity: string;
  acceptanceCriteria: string;
  definitionOfDone: string;
  estimatedSize: string;
  riskLevel: string;
  requiredCapabilities: string;
  suggestedFileScope: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a Task object to the internal form state representation.
 * Array fields are joined with newlines; null values become empty strings.
 */
function taskToFormState(task: Task): EditFormState {
  return {
    title: task.title,
    description: task.description ?? "",
    priority: task.priority,
    externalRef: task.externalRef ?? "",
    severity: task.severity ?? "",
    acceptanceCriteria: (task.acceptanceCriteria ?? []).join("\n"),
    definitionOfDone: (task.definitionOfDone ?? []).join("\n"),
    estimatedSize: task.estimatedSize ?? "",
    riskLevel: task.riskLevel ?? "",
    requiredCapabilities: (task.requiredCapabilities ?? []).join("\n"),
    suggestedFileScope: (task.suggestedFileScope ?? []).join("\n"),
  };
}

/**
 * Parses a newline-separated string into an array of non-empty trimmed values.
 * Returns undefined when the resulting array would be empty (no change payload).
 */
function parseLines(text: string): string[] | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines : undefined;
}

/**
 * Builds the minimal UpdateTaskInput by comparing the form state with
 * the original task data. Only fields that differ from the original are
 * included. The `version` field is always included for concurrency control.
 */
function buildUpdateInput(form: EditFormState, original: Task): UpdateTaskInput {
  const input: Record<string, unknown> = { version: original.version };

  if (form.title.trim() !== original.title) {
    input["title"] = form.title.trim();
  }

  const newDescription = form.description.trim() || null;
  if (newDescription !== (original.description ?? null)) {
    input["description"] = form.description.trim() || undefined;
  }

  if (form.priority !== original.priority) {
    input["priority"] = form.priority;
  }

  const newExternalRef = form.externalRef.trim() || null;
  if (newExternalRef !== (original.externalRef ?? null)) {
    input["externalRef"] = form.externalRef.trim() || undefined;
  }

  const newSeverity = form.severity.trim() || null;
  if (newSeverity !== (original.severity ?? null)) {
    input["severity"] = form.severity.trim() || undefined;
  }

  const newCriteria = parseLines(form.acceptanceCriteria);
  const origCriteria = original.acceptanceCriteria;
  if (JSON.stringify(newCriteria ?? null) !== JSON.stringify(origCriteria ?? null)) {
    input["acceptanceCriteria"] = newCriteria;
  }

  const newDod = parseLines(form.definitionOfDone);
  const origDod = original.definitionOfDone;
  if (JSON.stringify(newDod ?? null) !== JSON.stringify(origDod ?? null)) {
    input["definitionOfDone"] = newDod;
  }

  const newSize = form.estimatedSize || null;
  if (newSize !== (original.estimatedSize ?? null)) {
    input["estimatedSize"] = form.estimatedSize || undefined;
  }

  const newRisk = form.riskLevel || null;
  if (newRisk !== (original.riskLevel ?? null)) {
    input["riskLevel"] = form.riskLevel || undefined;
  }

  const newCaps = parseLines(form.requiredCapabilities);
  const origCaps = original.requiredCapabilities;
  if (JSON.stringify(newCaps ?? null) !== JSON.stringify(origCaps ?? null)) {
    input["requiredCapabilities"] = newCaps;
  }

  const newScope = parseLines(form.suggestedFileScope);
  const origScope = original.suggestedFileScope;
  if (JSON.stringify(newScope ?? null) !== JSON.stringify(origScope ?? null)) {
    input["suggestedFileScope"] = newScope;
  }

  return input as UpdateTaskInput;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Modal dialog for editing an existing task's metadata.
 *
 * Pre-populates all editable fields from the current task data. Uses
 * optimistic concurrency control — the task's `version` is included in
 * every update request. If the server detects a concurrent modification,
 * a 409 Conflict is returned and the user is prompted to refresh.
 *
 * Only changed fields are sent in the update payload to minimise write
 * amplification and reduce conflict surface area.
 */
export function EditTaskDialog({ open, onOpenChange, task }: EditTaskDialogProps) {
  const [form, setForm] = useState<EditFormState>(() => taskToFormState(task));
  const [error, setError] = useState<string | null>(null);

  const updateTask = useUpdateTask(task.id);

  // Re-populate form when the task data changes (e.g. after background refresh)
  // or when the dialog is reopened.
  useEffect(() => {
    if (open) {
      setForm(taskToFormState(task));
      setError(null);
    }
  }, [open, task]);

  /** Updates a single form field and clears any existing error. */
  const updateField = useCallback(
    <K extends keyof EditFormState>(field: K, value: EditFormState[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      setError(null);
    },
    [],
  );

  /** Whether the form passes client-side validation (title is required). */
  const isValid = form.title.trim().length > 0 && form.priority.length > 0;

  /** Handles dialog close — prevents close during submission. */
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && updateTask.isPending) return;
      onOpenChange(nextOpen);
    },
    [updateTask.isPending, onOpenChange],
  );

  /** Submits the form to update the task. */
  const handleSubmit = useCallback(() => {
    if (!isValid || updateTask.isPending) return;

    const input = buildUpdateInput(form, task);

    updateTask.mutate(input, {
      onSuccess: () => {
        onOpenChange(false);
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes("409") ||
          message.toLowerCase().includes("conflict") ||
          message.toLowerCase().includes("version")
        ) {
          setError(
            "This task was modified by another user. Please close this dialog and try again — your form will be refreshed with the latest data.",
          );
        } else {
          setError(message || "Failed to update task. Please try again.");
        }
      },
    });
  }, [isValid, updateTask, form, task, onOpenChange]);

  /**
   * Shared CSS classes for native select elements, matching the Input
   * component's appearance for visual consistency.
   */
  const selectClasses =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="edit-task-dialog">
        <DialogHeader>
          <DialogTitle data-testid="edit-task-dialog-title">Edit Task</DialogTitle>
          <DialogDescription>
            Update task metadata. Required fields are marked with an asterisk.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
          {/* Title (required) */}
          <div className="space-y-2">
            <Label htmlFor="edit-task-title">Title *</Label>
            <Input
              id="edit-task-title"
              placeholder="Enter task title"
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
              disabled={updateTask.isPending}
              data-testid="edit-task-title"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="edit-task-description">Description</Label>
            <Textarea
              id="edit-task-description"
              placeholder="Describe the task..."
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              disabled={updateTask.isPending}
              data-testid="edit-task-description"
            />
          </div>

          {/* Priority (required) */}
          <div className="space-y-2">
            <Label htmlFor="edit-task-priority">Priority *</Label>
            <select
              id="edit-task-priority"
              className={selectClasses}
              value={form.priority}
              onChange={(e) => updateField("priority", e.target.value)}
              disabled={updateTask.isPending}
              data-testid="edit-task-priority"
            >
              {PRIORITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Risk Level */}
          <div className="space-y-2">
            <Label htmlFor="edit-task-risk-level">Risk Level</Label>
            <select
              id="edit-task-risk-level"
              className={selectClasses}
              value={form.riskLevel}
              onChange={(e) => updateField("riskLevel", e.target.value)}
              disabled={updateTask.isPending}
              data-testid="edit-task-risk-level"
            >
              <option value="">None</option>
              {RISK_LEVEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Estimated Size */}
          <div className="space-y-2">
            <Label htmlFor="edit-task-estimated-size">Estimated Size</Label>
            <select
              id="edit-task-estimated-size"
              className={selectClasses}
              value={form.estimatedSize}
              onChange={(e) => updateField("estimatedSize", e.target.value)}
              disabled={updateTask.isPending}
              data-testid="edit-task-estimated-size"
            >
              <option value="">None</option>
              {ESTIMATED_SIZE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* External Reference */}
          <div className="space-y-2">
            <Label htmlFor="edit-task-external-ref">External Reference</Label>
            <Input
              id="edit-task-external-ref"
              placeholder="e.g., JIRA-123"
              value={form.externalRef}
              onChange={(e) => updateField("externalRef", e.target.value)}
              disabled={updateTask.isPending}
              data-testid="edit-task-external-ref"
            />
          </div>

          {/* Severity */}
          <div className="space-y-2">
            <Label htmlFor="edit-task-severity">Severity</Label>
            <Input
              id="edit-task-severity"
              placeholder="e.g., critical, major, minor"
              value={form.severity}
              onChange={(e) => updateField("severity", e.target.value)}
              disabled={updateTask.isPending}
              data-testid="edit-task-severity"
            />
          </div>

          {/* Acceptance Criteria */}
          <div className="space-y-2">
            <Label htmlFor="edit-task-acceptance-criteria">Acceptance Criteria</Label>
            <Textarea
              id="edit-task-acceptance-criteria"
              placeholder="Enter one criterion per line..."
              value={form.acceptanceCriteria}
              onChange={(e) => updateField("acceptanceCriteria", e.target.value)}
              disabled={updateTask.isPending}
              rows={3}
              data-testid="edit-task-acceptance-criteria"
            />
          </div>

          {/* Definition of Done */}
          <div className="space-y-2">
            <Label htmlFor="edit-task-definition-of-done">Definition of Done</Label>
            <Textarea
              id="edit-task-definition-of-done"
              placeholder="Enter one item per line..."
              value={form.definitionOfDone}
              onChange={(e) => updateField("definitionOfDone", e.target.value)}
              disabled={updateTask.isPending}
              rows={3}
              data-testid="edit-task-definition-of-done"
            />
          </div>

          {/* Required Capabilities */}
          <div className="space-y-2">
            <Label htmlFor="edit-task-required-capabilities">Required Capabilities</Label>
            <Textarea
              id="edit-task-required-capabilities"
              placeholder="Enter one capability per line..."
              value={form.requiredCapabilities}
              onChange={(e) => updateField("requiredCapabilities", e.target.value)}
              disabled={updateTask.isPending}
              rows={2}
              data-testid="edit-task-required-capabilities"
            />
          </div>

          {/* Suggested File Scope */}
          <div className="space-y-2">
            <Label htmlFor="edit-task-suggested-file-scope">Suggested File Scope</Label>
            <Textarea
              id="edit-task-suggested-file-scope"
              placeholder="Enter one path per line..."
              value={form.suggestedFileScope}
              onChange={(e) => updateField("suggestedFileScope", e.target.value)}
              disabled={updateTask.isPending}
              rows={2}
              data-testid="edit-task-suggested-file-scope"
            />
          </div>

          {/* Error message */}
          {error && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
              data-testid="edit-task-error"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={updateTask.isPending}
            data-testid="edit-task-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || updateTask.isPending}
            data-testid="edit-task-submit"
          >
            {updateTask.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
