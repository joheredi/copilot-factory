/**
 * Create Task dialog component.
 *
 * Provides a modal dialog with form fields for creating a new task.
 * Supports all required and optional fields from the CreateTaskInput
 * interface, with cascading project→repository selection.
 *
 * Form validation enforces required fields (title, taskType, priority,
 * repositoryId) before submission is allowed. On success, the dialog
 * closes and the task list cache is invalidated (handled by the
 * useCreateTask hook).
 *
 * @see T124 — Add Create Task dialog to Tasks page
 * @see docs/prd/007-technical-architecture.md §7.16
 */

import { useCallback, useState } from "react";
import { useCreateTask } from "../../../api/hooks/use-tasks";
import { useProjects } from "../../../api/hooks/use-projects";
import { useRepositories } from "../../../api/hooks/use-repositories";
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
import type {
  CreateTaskInput,
  TaskType,
  TaskPriority,
  TaskSize,
  RiskLevel,
} from "../../../api/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Available task type options with display labels. */
const TASK_TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: "feature", label: "Feature" },
  { value: "bug_fix", label: "Bug Fix" },
  { value: "refactor", label: "Refactor" },
  { value: "chore", label: "Chore" },
  { value: "documentation", label: "Documentation" },
  { value: "test", label: "Test" },
  { value: "spike", label: "Spike" },
];

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

/** Props for the CreateTaskDialog component. */
interface CreateTaskDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Callback when the dialog open state changes (close via cancel or backdrop). */
  readonly onOpenChange: (open: boolean) => void;
}

/** Internal form state for the create task dialog. */
interface FormState {
  title: string;
  description: string;
  taskType: string;
  priority: string;
  riskLevel: string;
  estimatedSize: string;
  acceptanceCriteria: string;
  projectId: string;
  repositoryId: string;
}

const INITIAL_FORM_STATE: FormState = {
  title: "",
  description: "",
  taskType: "",
  priority: "",
  riskLevel: "",
  estimatedSize: "",
  acceptanceCriteria: "",
  projectId: "",
  repositoryId: "",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Modal dialog for creating a new task.
 *
 * Renders a form with required fields (title, task type, priority,
 * repository) and optional fields (description, risk level, estimated
 * size, acceptance criteria). Uses cascading project→repository selection
 * since repositories are scoped to projects in the API.
 *
 * On successful submission, the task list cache is automatically
 * invalidated by the underlying useCreateTask mutation hook.
 */
export function CreateTaskDialog({ open, onOpenChange }: CreateTaskDialogProps) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM_STATE);
  const [error, setError] = useState<string | null>(null);

  const createTask = useCreateTask();
  const { data: projectsData } = useProjects({ limit: 100 });
  const { data: repositoriesData } = useRepositories(form.projectId || undefined, { limit: 100 });

  const projects = projectsData?.data ?? [];
  const repositories = repositoriesData?.data ?? [];

  /** Updates a single form field. */
  const updateField = useCallback(<K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }, []);

  /** Whether the form passes client-side validation. */
  const isValid =
    form.title.trim().length > 0 &&
    form.taskType.length > 0 &&
    form.priority.length > 0 &&
    form.repositoryId.length > 0;

  /** Resets form to initial state. */
  const resetForm = useCallback(() => {
    setForm(INITIAL_FORM_STATE);
    setError(null);
  }, []);

  /** Handles dialog close — resets form if not submitting. */
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !createTask.isPending) {
        resetForm();
      }
      onOpenChange(nextOpen);
    },
    [createTask.isPending, onOpenChange, resetForm],
  );

  /** Handles project change — clears repositoryId when project changes. */
  const handleProjectChange = useCallback((projectId: string) => {
    setForm((prev) => ({ ...prev, projectId, repositoryId: "" }));
    setError(null);
  }, []);

  /** Submits the form to create a new task. */
  const handleSubmit = useCallback(() => {
    if (!isValid || createTask.isPending) return;

    const acceptanceCriteria = form.acceptanceCriteria
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const input: CreateTaskInput = {
      title: form.title.trim(),
      repositoryId: form.repositoryId,
      taskType: form.taskType as TaskType,
      priority: form.priority as TaskPriority,
      source: "manual",
      ...(form.description.trim() && { description: form.description.trim() }),
      ...(form.riskLevel && { riskLevel: form.riskLevel as RiskLevel }),
      ...(form.estimatedSize && { estimatedSize: form.estimatedSize as TaskSize }),
      ...(acceptanceCriteria.length > 0 && { acceptanceCriteria }),
    };

    createTask.mutate(input, {
      onSuccess: () => {
        resetForm();
        onOpenChange(false);
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : "Failed to create task. Please try again.");
      },
    });
  }, [isValid, createTask, form, resetForm, onOpenChange]);

  /**
   * Shared CSS classes for native select elements, matching the Input
   * component's appearance for visual consistency.
   */
  const selectClasses =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="create-task-dialog">
        <DialogHeader>
          <DialogTitle data-testid="create-task-dialog-title">Create Task</DialogTitle>
          <DialogDescription>
            Create a new task. Required fields are marked with an asterisk.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
          {/* Title (required) */}
          <div className="space-y-2">
            <Label htmlFor="task-title">Title *</Label>
            <Input
              id="task-title"
              placeholder="Enter task title"
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
              disabled={createTask.isPending}
              data-testid="create-task-title"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              placeholder="Describe the task..."
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              disabled={createTask.isPending}
              data-testid="create-task-description"
            />
          </div>

          {/* Task Type (required) */}
          <div className="space-y-2">
            <Label htmlFor="task-type">Task Type *</Label>
            <select
              id="task-type"
              className={selectClasses}
              value={form.taskType}
              onChange={(e) => updateField("taskType", e.target.value)}
              disabled={createTask.isPending}
              data-testid="create-task-type"
            >
              <option value="">Select task type</option>
              {TASK_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Priority (required) */}
          <div className="space-y-2">
            <Label htmlFor="task-priority">Priority *</Label>
            <select
              id="task-priority"
              className={selectClasses}
              value={form.priority}
              onChange={(e) => updateField("priority", e.target.value)}
              disabled={createTask.isPending}
              data-testid="create-task-priority"
            >
              <option value="">Select priority</option>
              {PRIORITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Risk Level */}
          <div className="space-y-2">
            <Label htmlFor="task-risk-level">Risk Level</Label>
            <select
              id="task-risk-level"
              className={selectClasses}
              value={form.riskLevel}
              onChange={(e) => updateField("riskLevel", e.target.value)}
              disabled={createTask.isPending}
              data-testid="create-task-risk-level"
            >
              <option value="">Select risk level</option>
              {RISK_LEVEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Estimated Size */}
          <div className="space-y-2">
            <Label htmlFor="task-estimated-size">Estimated Size</Label>
            <select
              id="task-estimated-size"
              className={selectClasses}
              value={form.estimatedSize}
              onChange={(e) => updateField("estimatedSize", e.target.value)}
              disabled={createTask.isPending}
              data-testid="create-task-estimated-size"
            >
              <option value="">Select size</option>
              {ESTIMATED_SIZE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Acceptance Criteria */}
          <div className="space-y-2">
            <Label htmlFor="task-acceptance-criteria">Acceptance Criteria</Label>
            <Textarea
              id="task-acceptance-criteria"
              placeholder="Enter one criterion per line..."
              value={form.acceptanceCriteria}
              onChange={(e) => updateField("acceptanceCriteria", e.target.value)}
              disabled={createTask.isPending}
              rows={3}
              data-testid="create-task-acceptance-criteria"
            />
          </div>

          {/* Project (for repository filtering) */}
          <div className="space-y-2">
            <Label htmlFor="task-project">Project *</Label>
            <select
              id="task-project"
              className={selectClasses}
              value={form.projectId}
              onChange={(e) => handleProjectChange(e.target.value)}
              disabled={createTask.isPending}
              data-testid="create-task-project"
            >
              <option value="">Select project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            {projects.length === 0 && (
              <p className="text-xs text-muted-foreground" data-testid="no-projects-hint">
                No projects available. Create a project first.
              </p>
            )}
          </div>

          {/* Repository (required, filtered by project) */}
          <div className="space-y-2">
            <Label htmlFor="task-repository">Repository *</Label>
            <select
              id="task-repository"
              className={selectClasses}
              value={form.repositoryId}
              onChange={(e) => updateField("repositoryId", e.target.value)}
              disabled={createTask.isPending || !form.projectId}
              data-testid="create-task-repository"
            >
              <option value="">
                {form.projectId ? "Select repository" : "Select a project first"}
              </option>
              {repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.name}
                </option>
              ))}
            </select>
            {form.projectId && repositories.length === 0 && (
              <p className="text-xs text-muted-foreground" data-testid="no-repositories-hint">
                No repositories in this project. Create a repository first.
              </p>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
              data-testid="create-task-error"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={createTask.isPending}
            data-testid="create-task-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || createTask.isPending}
            data-testid="create-task-submit"
          >
            {createTask.isPending ? "Creating…" : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
