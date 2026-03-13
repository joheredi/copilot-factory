/**
 * Create Agent Profile dialog component.
 *
 * Provides a modal dialog with form fields for creating a new agent profile
 * within a worker pool. All fields are optional policy/template IDs — the
 * profile acts as a container linking a pool to its behavioral policies.
 *
 * On success, the dialog closes and the profile list cache is invalidated
 * (handled by the useCreateAgentProfile hook).
 *
 * @see T128 — Add Create Agent Profile dialog to Pool detail
 * @see docs/prd/007-technical-architecture.md §7.16
 */

import { useCallback, useState } from "react";
import { useCreateAgentProfile } from "../../../api/hooks/use-pools.js";
import { usePromptTemplates } from "../../../api/hooks/use-prompt-templates.js";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";
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
import type { CreateAgentProfileInput } from "../../../api/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the CreateProfileDialog component. */
interface CreateProfileDialogProps {
  /** ID of the pool this profile will belong to. */
  readonly poolId: string;
  /** Pool type used to filter prompt templates by matching role. */
  readonly poolType?: string;
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Callback when the dialog open state changes (close via cancel or backdrop). */
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Internal form state for the create profile dialog.
 *
 * All fields are optional policy/template IDs. Empty strings
 * are treated as "not set" and omitted from the API payload.
 */
interface FormState {
  promptTemplateId: string;
  toolPolicyId: string;
  commandPolicyId: string;
  fileScopePolicyId: string;
  validationPolicyId: string;
  reviewPolicyId: string;
  budgetPolicyId: string;
  retryPolicyId: string;
}

const INITIAL_FORM_STATE: FormState = {
  promptTemplateId: "",
  toolPolicyId: "",
  commandPolicyId: "",
  fileScopePolicyId: "",
  validationPolicyId: "",
  reviewPolicyId: "",
  budgetPolicyId: "",
  retryPolicyId: "",
};

/**
 * Field configuration for rendering the form. Each entry describes a single
 * policy/template ID field with its form key, label, and placeholder text.
 */
const PROFILE_FIELDS: {
  key: keyof FormState;
  label: string;
  placeholder: string;
}[] = [
  {
    key: "toolPolicyId",
    label: "Tool Policy ID",
    placeholder: "UUID of the tool policy",
  },
  {
    key: "commandPolicyId",
    label: "Command Policy ID",
    placeholder: "UUID of the command policy",
  },
  {
    key: "fileScopePolicyId",
    label: "File Scope Policy ID",
    placeholder: "UUID of the file scope policy",
  },
  {
    key: "validationPolicyId",
    label: "Validation Policy ID",
    placeholder: "UUID of the validation policy",
  },
  {
    key: "reviewPolicyId",
    label: "Review Policy ID",
    placeholder: "UUID of the review policy",
  },
  {
    key: "budgetPolicyId",
    label: "Budget Policy ID",
    placeholder: "UUID of the budget policy",
  },
  {
    key: "retryPolicyId",
    label: "Retry Policy ID",
    placeholder: "UUID of the retry policy",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Modal dialog for creating a new agent profile within a pool.
 *
 * Renders a form with all-optional policy ID fields. Since every field is
 * optional, submission is always allowed — even an empty profile is valid
 * (the operator can attach policies later). On successful submission, the
 * profile list cache is automatically invalidated by the underlying
 * useCreateAgentProfile mutation hook.
 */
export function CreateProfileDialog({
  poolId,
  poolType,
  open,
  onOpenChange,
}: CreateProfileDialogProps) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM_STATE);
  const [error, setError] = useState<string | null>(null);

  const createProfile = useCreateAgentProfile(poolId);
  const { data: templates } = usePromptTemplates(poolType);
  const templateList = templates ?? [];

  /** Updates a single form field and clears any existing error. */
  const updateField = useCallback(<K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }, []);

  /** Resets form to initial state. */
  const resetForm = useCallback(() => {
    setForm(INITIAL_FORM_STATE);
    setError(null);
  }, []);

  /** Handles dialog close — resets form if not submitting. */
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !createProfile.isPending) {
        resetForm();
      }
      onOpenChange(nextOpen);
    },
    [createProfile.isPending, onOpenChange, resetForm],
  );

  /** Submits the form to create a new agent profile. */
  const handleSubmit = useCallback(() => {
    if (createProfile.isPending) return;

    const input: CreateAgentProfileInput = {};

    // Only include non-empty fields in the payload
    for (const { key } of PROFILE_FIELDS) {
      const value = form[key].trim();
      if (value) {
        (input as Record<string, string>)[key] = value;
      }
    }

    createProfile.mutate(input, {
      onSuccess: () => {
        resetForm();
        onOpenChange(false);
      },
      onError: (err) => {
        setError(
          err instanceof Error ? err.message : "Failed to create agent profile. Please try again.",
        );
      },
    });
  }, [createProfile, form, resetForm, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="create-profile-dialog">
        <DialogHeader>
          <DialogTitle data-testid="create-profile-dialog-title">Create Agent Profile</DialogTitle>
          <DialogDescription>
            Create a new agent profile for this pool. All fields are optional — attach policy and
            template IDs to configure agent behavior.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
          {/* Prompt Template picker */}
          <div className="space-y-2">
            <Label htmlFor="profile-promptTemplateId">Prompt Template</Label>
            <Select
              value={form.promptTemplateId || "__none__"}
              onValueChange={(v) => {
                updateField("promptTemplateId", v === "__none__" ? "" : v);
              }}
              disabled={createProfile.isPending}
            >
              <SelectTrigger
                id="profile-promptTemplateId"
                data-testid="create-profile-promptTemplateId"
              >
                <SelectValue placeholder="Select a prompt template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {templateList.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} (v{t.version})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Remaining policy ID fields */}
          {PROFILE_FIELDS.map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`profile-${key}`}>{label}</Label>
              <Input
                id={`profile-${key}`}
                placeholder={placeholder}
                value={form[key]}
                onChange={(e) => updateField(key, e.target.value)}
                disabled={createProfile.isPending}
                data-testid={`create-profile-${key}`}
              />
            </div>
          ))}

          {/* Error message */}
          {error && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
              data-testid="create-profile-error"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={createProfile.isPending}
            data-testid="create-profile-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createProfile.isPending}
            data-testid="create-profile-submit"
          >
            {createProfile.isPending ? "Creating…" : "Create Profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
