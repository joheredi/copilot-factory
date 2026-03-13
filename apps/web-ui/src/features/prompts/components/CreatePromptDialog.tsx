/**
 * Create Prompt Template dialog component.
 *
 * Provides a modal dialog with form fields for creating a new prompt template.
 * On success the dialog closes and the template list cache is invalidated.
 *
 * @see docs/prd/007-technical-architecture.md §7.16
 */

import { useCallback, useState } from "react";
import { useCreatePromptTemplate } from "../../../api/hooks/use-prompt-templates.js";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";
import { Textarea } from "../../../components/ui/textarea.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreatePromptDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

interface FormState {
  name: string;
  role: string;
  version: string;
  templateText: string;
}

const INITIAL_FORM_STATE: FormState = {
  name: "",
  role: "",
  version: "1.0.0",
  templateText: "",
};

/** All agent roles available for selection. */
const ROLES = [
  { label: "Planner", value: "planner" },
  { label: "Developer", value: "developer" },
  { label: "Reviewer", value: "reviewer" },
  { label: "Lead Reviewer", value: "lead-reviewer" },
  { label: "Merge Assist", value: "merge-assist" },
  { label: "Validator", value: "validator" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreatePromptDialog({ open, onOpenChange }: CreatePromptDialogProps) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM_STATE);
  const [error, setError] = useState<string | null>(null);

  const createTemplate = useCreatePromptTemplate();

  const resetForm = useCallback(() => {
    setForm(INITIAL_FORM_STATE);
    setError(null);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !createTemplate.isPending) {
        resetForm();
      }
      onOpenChange(nextOpen);
    },
    [createTemplate.isPending, onOpenChange, resetForm],
  );

  const handleSubmit = useCallback(() => {
    if (createTemplate.isPending) return;

    // Basic validation
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!form.role) {
      setError("Role is required.");
      return;
    }
    if (!form.templateText.trim()) {
      setError("Template text is required.");
      return;
    }

    createTemplate.mutate(
      {
        name: form.name.trim(),
        role: form.role,
        version: form.version.trim() || "1.0.0",
        templateText: form.templateText,
      },
      {
        onSuccess: () => {
          resetForm();
          onOpenChange(false);
        },
        onError: (err) => {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to create prompt template. Please try again.",
          );
        },
      },
    );
  }, [createTemplate, form, resetForm, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="create-prompt-dialog">
        <DialogHeader>
          <DialogTitle data-testid="create-prompt-dialog-title">Create Prompt Template</DialogTitle>
          <DialogDescription>
            Create a new prompt template for an agent role. The template text defines the
            instructions sent to the AI agent.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="prompt-name">Name</Label>
            <Input
              id="prompt-name"
              placeholder="e.g. Developer System Prompt"
              value={form.name}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, name: e.target.value }));
                setError(null);
              }}
              disabled={createTemplate.isPending}
              data-testid="create-prompt-name"
            />
          </div>

          {/* Role */}
          <div className="space-y-2">
            <Label htmlFor="prompt-role">Role</Label>
            <Select
              value={form.role}
              onValueChange={(v) => {
                setForm((prev) => ({ ...prev, role: v }));
                setError(null);
              }}
              disabled={createTemplate.isPending}
            >
              <SelectTrigger id="prompt-role" data-testid="create-prompt-role">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Version */}
          <div className="space-y-2">
            <Label htmlFor="prompt-version">Version</Label>
            <Input
              id="prompt-version"
              placeholder="1.0.0"
              value={form.version}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, version: e.target.value }));
                setError(null);
              }}
              disabled={createTemplate.isPending}
              data-testid="create-prompt-version"
            />
          </div>

          {/* Template Text */}
          <div className="space-y-2">
            <Label htmlFor="prompt-text">Template Text</Label>
            <Textarea
              id="prompt-text"
              placeholder="Enter the prompt template text…"
              value={form.templateText}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, templateText: e.target.value }));
                setError(null);
              }}
              className="min-h-[200px] font-mono text-sm"
              disabled={createTemplate.isPending}
              data-testid="create-prompt-text"
            />
          </div>

          {/* Error message */}
          {error && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
              data-testid="create-prompt-error"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={createTemplate.isPending}
            data-testid="create-prompt-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createTemplate.isPending}
            data-testid="create-prompt-submit"
          >
            {createTemplate.isPending ? "Creating…" : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
