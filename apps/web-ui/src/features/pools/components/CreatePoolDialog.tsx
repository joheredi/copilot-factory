/**
 * Create Worker Pool dialog component.
 *
 * Provides a modal dialog with form fields for creating a new worker pool.
 * Supports required fields (name, poolType) and optional/defaulted fields
 * (provider, model, maxConcurrency, defaultTimeoutSec). On success, the
 * dialog closes and the pool list cache is invalidated (handled by the
 * useCreatePool hook).
 *
 * @see T127 — Add Create Worker Pool dialog to Pools page
 * @see docs/prd/007-technical-architecture.md §7.16
 */

import { useCallback, useState } from "react";
import { useCreatePool } from "../../../api/hooks/use-pools.js";
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
import type { CreatePoolInput, PoolType } from "../../../api/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the CreatePoolDialog component. */
interface CreatePoolDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Callback when the dialog open state changes (close via cancel or backdrop). */
  readonly onOpenChange: (open: boolean) => void;
}

/** Internal form state for the create pool dialog. */
interface FormState {
  name: string;
  poolType: PoolType | "";
  provider: string;
  model: string;
  maxConcurrency: string;
  defaultTimeoutSec: string;
}

const INITIAL_FORM_STATE: FormState = {
  name: "",
  poolType: "",
  provider: "",
  model: "",
  maxConcurrency: "3",
  defaultTimeoutSec: "3600",
};

/** Pool type options for the select dropdown. */
const POOL_TYPE_OPTIONS: { label: string; value: PoolType }[] = [
  { label: "Developer", value: "developer" },
  { label: "Reviewer", value: "reviewer" },
  { label: "Lead Reviewer", value: "lead-reviewer" },
  { label: "Merge Assist", value: "merge-assist" },
  { label: "Planner", value: "planner" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Modal dialog for creating a new worker pool.
 *
 * Renders a form with required fields (name, poolType) and optional/defaulted
 * fields (provider, model, maxConcurrency defaults to 3, defaultTimeoutSec
 * defaults to 3600). Client-side validation enforces that name and poolType
 * are non-empty before submission.
 *
 * On successful submission, the pool list cache is automatically invalidated
 * by the underlying useCreatePool mutation hook.
 */
export function CreatePoolDialog({ open, onOpenChange }: CreatePoolDialogProps) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM_STATE);
  const [error, setError] = useState<string | null>(null);

  const createPool = useCreatePool();

  /** Updates a single form field and clears any existing error. */
  const updateField = useCallback(<K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }, []);

  /** Whether the form passes client-side validation (name and poolType required). */
  const isValid = form.name.trim().length > 0 && form.poolType !== "";

  /** Resets form to initial state. */
  const resetForm = useCallback(() => {
    setForm(INITIAL_FORM_STATE);
    setError(null);
  }, []);

  /** Handles dialog close — resets form if not submitting. */
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !createPool.isPending) {
        resetForm();
      }
      onOpenChange(nextOpen);
    },
    [createPool.isPending, onOpenChange, resetForm],
  );

  /** Submits the form to create a new worker pool. */
  const handleSubmit = useCallback(() => {
    if (!isValid || createPool.isPending) return;

    const maxConcurrency = parseInt(form.maxConcurrency, 10);
    const defaultTimeoutSec = parseInt(form.defaultTimeoutSec, 10);

    const input: CreatePoolInput = {
      name: form.name.trim(),
      poolType: form.poolType as PoolType,
      ...(form.provider.trim() && { provider: form.provider.trim() }),
      ...(form.model.trim() && { model: form.model.trim() }),
      ...(Number.isFinite(maxConcurrency) && maxConcurrency > 0 && { maxConcurrency }),
      ...(Number.isFinite(defaultTimeoutSec) && defaultTimeoutSec > 0 && { defaultTimeoutSec }),
    };

    createPool.mutate(input, {
      onSuccess: () => {
        resetForm();
        onOpenChange(false);
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : "Failed to create pool. Please try again.");
      },
    });
  }, [isValid, createPool, form, resetForm, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="create-pool-dialog">
        <DialogHeader>
          <DialogTitle data-testid="create-pool-dialog-title">Create Worker Pool</DialogTitle>
          <DialogDescription>
            Create a new worker pool. Required fields are marked with an asterisk.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name (required) */}
          <div className="space-y-2">
            <Label htmlFor="pool-name">Name *</Label>
            <Input
              id="pool-name"
              placeholder="Enter pool name"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              disabled={createPool.isPending}
              data-testid="create-pool-name"
            />
          </div>

          {/* Pool Type (required) */}
          <div className="space-y-2">
            <Label htmlFor="pool-type">Pool Type *</Label>
            <Select
              value={form.poolType}
              onValueChange={(value) => updateField("poolType", value as PoolType)}
              disabled={createPool.isPending}
            >
              <SelectTrigger data-testid="create-pool-type">
                <SelectValue placeholder="Select pool type" />
              </SelectTrigger>
              <SelectContent>
                {POOL_TYPE_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    data-testid={`create-pool-type-${opt.value}`}
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Provider (optional) */}
          <div className="space-y-2">
            <Label htmlFor="pool-provider">Provider</Label>
            <Input
              id="pool-provider"
              placeholder="e.g. github-copilot"
              value={form.provider}
              onChange={(e) => updateField("provider", e.target.value)}
              disabled={createPool.isPending}
              data-testid="create-pool-provider"
            />
          </div>

          {/* Model (optional) */}
          <div className="space-y-2">
            <Label htmlFor="pool-model">Model</Label>
            <Input
              id="pool-model"
              placeholder="e.g. gpt-4o"
              value={form.model}
              onChange={(e) => updateField("model", e.target.value)}
              disabled={createPool.isPending}
              data-testid="create-pool-model"
            />
          </div>

          {/* Max Concurrency (defaulted) */}
          <div className="space-y-2">
            <Label htmlFor="pool-max-concurrency">Max Concurrency</Label>
            <Input
              id="pool-max-concurrency"
              type="number"
              min={1}
              placeholder="3"
              value={form.maxConcurrency}
              onChange={(e) => updateField("maxConcurrency", e.target.value)}
              disabled={createPool.isPending}
              data-testid="create-pool-max-concurrency"
            />
          </div>

          {/* Default Timeout (defaulted) */}
          <div className="space-y-2">
            <Label htmlFor="pool-default-timeout">Default Timeout (seconds)</Label>
            <Input
              id="pool-default-timeout"
              type="number"
              min={1}
              placeholder="3600"
              value={form.defaultTimeoutSec}
              onChange={(e) => updateField("defaultTimeoutSec", e.target.value)}
              disabled={createPool.isPending}
              data-testid="create-pool-default-timeout"
            />
          </div>

          {/* Error message */}
          {error && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
              data-testid="create-pool-error"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={createPool.isPending}
            data-testid="create-pool-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || createPool.isPending}
            data-testid="create-pool-submit"
          >
            {createPool.isPending ? "Creating…" : "Create Pool"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
