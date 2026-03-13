/**
 * Create Repository dialog component.
 *
 * Provides a modal dialog with form fields for registering a new Git
 * repository within a project. Supports required fields (name, remoteUrl)
 * and optional/defaulted fields (defaultBranch, localCheckoutStrategy).
 * On success, the dialog closes and the repository list cache is
 * invalidated (handled by the useCreateRepository hook).
 *
 * @see T126 — Add Create Repository dialog to Project detail
 * @see docs/prd/007-technical-architecture.md §7.16
 */

import { useCallback, useState } from "react";
import { useCreateRepository } from "../../../api/hooks/use-repositories";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import type { CreateRepositoryInput } from "../../../api/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the CreateRepositoryDialog component. */
interface CreateRepositoryDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Callback when the dialog open state changes (close via cancel or backdrop). */
  readonly onOpenChange: (open: boolean) => void;
  /** Project ID that the repository will belong to. */
  readonly projectId: string;
}

/** Internal form state for the create repository dialog. */
interface FormState {
  name: string;
  remoteUrl: string;
  defaultBranch: string;
  localCheckoutStrategy: "worktree" | "clone";
}

const INITIAL_FORM_STATE: FormState = {
  name: "",
  remoteUrl: "",
  defaultBranch: "main",
  localCheckoutStrategy: "worktree",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validates whether a string is a well-formed URL.
 *
 * Uses the native URL constructor which supports http, https, ssh, and
 * other protocol schemes. Returns false for empty or malformed strings.
 */
function isValidUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new URL(value.trim());
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Modal dialog for creating a new repository within a project.
 *
 * Renders a form with required fields (name, remoteUrl) and defaulted
 * fields (defaultBranch defaults to "main", localCheckoutStrategy
 * defaults to "worktree"). Client-side validation enforces that name
 * and remoteUrl are non-empty and that remoteUrl is a valid URL.
 *
 * On successful submission, the repository list cache is automatically
 * invalidated by the underlying useCreateRepository mutation hook.
 */
export function CreateRepositoryDialog({
  open,
  onOpenChange,
  projectId,
}: CreateRepositoryDialogProps) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM_STATE);
  const [error, setError] = useState<string | null>(null);

  const createRepository = useCreateRepository(projectId);

  /** Updates a single form field and clears any existing error. */
  const updateField = useCallback(<K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }, []);

  /**
   * Whether the form passes client-side validation.
   * Name must be non-empty and remoteUrl must be a valid URL.
   */
  const isValid = form.name.trim().length > 0 && isValidUrl(form.remoteUrl);

  /** Resets form to initial state. */
  const resetForm = useCallback(() => {
    setForm(INITIAL_FORM_STATE);
    setError(null);
  }, []);

  /** Handles dialog close — resets form if not submitting. */
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !createRepository.isPending) {
        resetForm();
      }
      onOpenChange(nextOpen);
    },
    [createRepository.isPending, onOpenChange, resetForm],
  );

  /** Submits the form to create a new repository. */
  const handleSubmit = useCallback(() => {
    if (!isValid || createRepository.isPending) return;

    const input: CreateRepositoryInput = {
      name: form.name.trim(),
      remoteUrl: form.remoteUrl.trim(),
      defaultBranch: form.defaultBranch.trim() || "main",
      localCheckoutStrategy: form.localCheckoutStrategy,
    };

    createRepository.mutate(input, {
      onSuccess: () => {
        resetForm();
        onOpenChange(false);
      },
      onError: (err) => {
        setError(
          err instanceof Error ? err.message : "Failed to create repository. Please try again.",
        );
      },
    });
  }, [isValid, createRepository, form, resetForm, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="create-repository-dialog">
        <DialogHeader>
          <DialogTitle data-testid="create-repository-dialog-title">Add Repository</DialogTitle>
          <DialogDescription>
            Register a Git repository for this project. Required fields are marked with an asterisk.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name (required) */}
          <div className="space-y-2">
            <Label htmlFor="repo-name">Name *</Label>
            <Input
              id="repo-name"
              placeholder="Enter repository name"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              disabled={createRepository.isPending}
              data-testid="create-repository-name"
            />
          </div>

          {/* Remote URL (required) */}
          <div className="space-y-2">
            <Label htmlFor="repo-remote-url">Remote URL *</Label>
            <Input
              id="repo-remote-url"
              placeholder="https://github.com/org/repo.git"
              value={form.remoteUrl}
              onChange={(e) => updateField("remoteUrl", e.target.value)}
              disabled={createRepository.isPending}
              data-testid="create-repository-remote-url"
            />
            {form.remoteUrl.trim().length > 0 && !isValidUrl(form.remoteUrl) && (
              <p className="text-xs text-destructive" data-testid="create-repository-url-error">
                Please enter a valid URL
              </p>
            )}
          </div>

          {/* Default Branch */}
          <div className="space-y-2">
            <Label htmlFor="repo-default-branch">Default Branch</Label>
            <Input
              id="repo-default-branch"
              placeholder="main"
              value={form.defaultBranch}
              onChange={(e) => updateField("defaultBranch", e.target.value)}
              disabled={createRepository.isPending}
              data-testid="create-repository-default-branch"
            />
          </div>

          {/* Local Checkout Strategy */}
          <div className="space-y-2">
            <Label htmlFor="repo-checkout-strategy">Local Checkout Strategy</Label>
            <Select
              value={form.localCheckoutStrategy}
              onValueChange={(value) =>
                updateField("localCheckoutStrategy", value as "worktree" | "clone")
              }
              disabled={createRepository.isPending}
            >
              <SelectTrigger data-testid="create-repository-checkout-strategy">
                <SelectValue placeholder="Select strategy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="worktree" data-testid="create-repository-strategy-worktree">
                  Worktree
                </SelectItem>
                <SelectItem value="clone" data-testid="create-repository-strategy-clone">
                  Clone
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Error message */}
          {error && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
              data-testid="create-repository-error"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={createRepository.isPending}
            data-testid="create-repository-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || createRepository.isPending}
            data-testid="create-repository-submit"
          >
            {createRepository.isPending ? "Adding…" : "Add Repository"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
