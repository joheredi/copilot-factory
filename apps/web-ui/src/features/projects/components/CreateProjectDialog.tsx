/**
 * Create Project dialog component.
 *
 * Provides a modal dialog with form fields for creating a new project.
 * Supports required fields (name, owner) and an optional description.
 * On success, the dialog closes and the project list cache is
 * invalidated (handled by the useCreateProject hook).
 *
 * @see T125 — Add Create Project dialog
 * @see docs/prd/007-technical-architecture.md §7.16
 */

import { useCallback, useState } from "react";
import { useCreateProject } from "../../../api/hooks/use-projects";
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
import type { CreateProjectInput } from "../../../api/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the CreateProjectDialog component. */
interface CreateProjectDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Callback when the dialog open state changes (close via cancel or backdrop). */
  readonly onOpenChange: (open: boolean) => void;
}

/** Internal form state for the create project dialog. */
interface FormState {
  name: string;
  description: string;
  owner: string;
}

const INITIAL_FORM_STATE: FormState = {
  name: "",
  description: "",
  owner: "",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Modal dialog for creating a new project.
 *
 * Renders a form with required fields (name, owner) and an optional
 * description textarea. Client-side validation enforces that name and
 * owner are non-empty before submission. Duplicate project names are
 * caught by the API and displayed as an error message.
 *
 * On successful submission, the project list cache is automatically
 * invalidated by the underlying useCreateProject mutation hook.
 */
export function CreateProjectDialog({ open, onOpenChange }: CreateProjectDialogProps) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM_STATE);
  const [error, setError] = useState<string | null>(null);

  const createProject = useCreateProject();

  /** Updates a single form field and clears any existing error. */
  const updateField = useCallback(<K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }, []);

  /** Whether the form passes client-side validation (name and owner required). */
  const isValid = form.name.trim().length > 0 && form.owner.trim().length > 0;

  /** Resets form to initial state. */
  const resetForm = useCallback(() => {
    setForm(INITIAL_FORM_STATE);
    setError(null);
  }, []);

  /** Handles dialog close — resets form if not submitting. */
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !createProject.isPending) {
        resetForm();
      }
      onOpenChange(nextOpen);
    },
    [createProject.isPending, onOpenChange, resetForm],
  );

  /** Submits the form to create a new project. */
  const handleSubmit = useCallback(() => {
    if (!isValid || createProject.isPending) return;

    const input: CreateProjectInput = {
      name: form.name.trim(),
      owner: form.owner.trim(),
      ...(form.description.trim() && { description: form.description.trim() }),
    };

    createProject.mutate(input, {
      onSuccess: () => {
        resetForm();
        onOpenChange(false);
      },
      onError: (err) => {
        setError(
          err instanceof Error ? err.message : "Failed to create project. Please try again.",
        );
      },
    });
  }, [isValid, createProject, form, resetForm, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="create-project-dialog">
        <DialogHeader>
          <DialogTitle data-testid="create-project-dialog-title">Create Project</DialogTitle>
          <DialogDescription>
            Create a new project. Required fields are marked with an asterisk.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name (required) */}
          <div className="space-y-2">
            <Label htmlFor="project-name">Name *</Label>
            <Input
              id="project-name"
              placeholder="Enter project name"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              disabled={createProject.isPending}
              data-testid="create-project-name"
            />
          </div>

          {/* Owner (required) */}
          <div className="space-y-2">
            <Label htmlFor="project-owner">Owner *</Label>
            <Input
              id="project-owner"
              placeholder="Enter owner (user or team)"
              value={form.owner}
              onChange={(e) => updateField("owner", e.target.value)}
              disabled={createProject.isPending}
              data-testid="create-project-owner"
            />
          </div>

          {/* Description (optional) */}
          <div className="space-y-2">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              placeholder="Describe the project..."
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              disabled={createProject.isPending}
              data-testid="create-project-description"
            />
          </div>

          {/* Error message */}
          {error && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
              data-testid="create-project-error"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={createProject.isPending}
            data-testid="create-project-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || createProject.isPending}
            data-testid="create-project-submit"
          >
            {createProject.isPending ? "Creating…" : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
