/**
 * Inline concurrency limit editor for a worker pool.
 *
 * Allows operators to change the maximum concurrency of a pool without
 * navigating to a separate edit form. Displays the current value with
 * a pencil icon; clicking opens an inline number input with save/cancel
 * buttons. Changes are confirmed via dialog since concurrency changes
 * affect scheduling throughput.
 *
 * Uses the existing `useUpdatePool` mutation.
 *
 * @see T105 — Integrate operator controls into pool and merge queue UI
 * @see docs/prd/006-additional-refinements.md §6.1 — Configurable pools
 */

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import { useUpdatePool } from "../../../api/hooks/use-pools.js";
import type { ActionFeedback } from "../../task-detail/components/operator-actions/use-action-feedback.js";

/** Props for the ConcurrencyEditor component. */
export interface ConcurrencyEditorProps {
  /** Pool ID to update. */
  readonly poolId: string;
  /** Current max concurrency value. */
  readonly currentValue: number;
  /** Callback when the action completes with feedback. */
  readonly onFeedback: (type: ActionFeedback["type"], message: string) => void;
}

/** Minimum allowed concurrency value. */
const MIN_CONCURRENCY = 1;

/** Maximum allowed concurrency value. */
const MAX_CONCURRENCY = 100;

/**
 * Inline editor for pool max concurrency.
 *
 * Shows the current value with an edit button. When editing, renders
 * a number input with save/cancel controls. Validates the range
 * (1–100) before allowing save.
 */
export function ConcurrencyEditor({ poolId, currentValue, onFeedback }: ConcurrencyEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(currentValue));
  const updatePool = useUpdatePool(poolId);

  const parsedValue = parseInt(editValue, 10);
  const isValid =
    !isNaN(parsedValue) && parsedValue >= MIN_CONCURRENCY && parsedValue <= MAX_CONCURRENCY;

  function startEditing() {
    setEditValue(String(currentValue));
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setEditValue(String(currentValue));
  }

  function handleSave() {
    if (!isValid || parsedValue === currentValue) {
      cancelEditing();
      return;
    }

    updatePool.mutate(
      { maxConcurrency: parsedValue },
      {
        onSuccess: () => {
          setIsEditing(false);
          onFeedback("success", `Concurrency updated from ${currentValue} to ${parsedValue}.`);
        },
        onError: (err) => {
          setIsEditing(false);
          onFeedback("error", `Failed to update concurrency: ${(err as Error).message}`);
        },
      },
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") cancelEditing();
  }

  if (!isEditing) {
    return (
      <div className="flex items-center gap-2" data-testid="concurrency-display">
        <span className="text-2xl font-bold" data-testid="stat-max-concurrency">
          {currentValue}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={startEditing}
          data-testid="concurrency-edit-btn"
          aria-label="Edit max concurrency"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5" data-testid="concurrency-editor">
      <Input
        type="number"
        min={MIN_CONCURRENCY}
        max={MAX_CONCURRENCY}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={updatePool.isPending}
        className="h-8 w-20 text-center text-lg font-bold"
        data-testid="concurrency-input"
        autoFocus
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-green-600 hover:text-green-700"
        onClick={handleSave}
        disabled={!isValid || updatePool.isPending}
        data-testid="concurrency-save-btn"
        aria-label="Save concurrency"
      >
        <Check className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
        onClick={cancelEditing}
        disabled={updatePool.isPending}
        data-testid="concurrency-cancel-btn"
        aria-label="Cancel editing"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
