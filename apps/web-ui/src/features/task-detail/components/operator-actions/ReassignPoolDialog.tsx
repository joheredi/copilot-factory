/**
 * Reassign Pool dialog for moving a task to a different worker pool.
 *
 * Renders a dialog with a pool selector dropdown and a reason textarea.
 * Pools are fetched via the `usePools` hook. The operator selects a
 * target pool and provides a reason for the audit trail, then confirms
 * to trigger the reassignment.
 *
 * @see T131 — Add Reassign Pool operator action to Task detail
 * @see docs/prd/006-additional-refinements.md §6.2 — Operator actions
 */

import { useState } from "react";
import { Button } from "../../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { Label } from "../../../../components/ui/label";
import { Textarea } from "../../../../components/ui/textarea";
import { usePools } from "../../../../api/hooks/use-pools";

/** Props for the ReassignPoolDialog component. */
interface ReassignPoolDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should close (cancel or backdrop click). */
  readonly onClose: () => void;
  /** Called when the operator confirms the reassignment. */
  readonly onConfirm: (poolId: string, reason: string) => void;
  /** Whether the mutation is currently in progress. */
  readonly isPending: boolean;
  /** The current pool ID to exclude from selection (optional). */
  readonly currentPoolId?: string | null;
}

/**
 * Dialog for reassigning a task to a different worker pool.
 *
 * Fetches available pools via the API and presents them in a dropdown.
 * Requires both a pool selection and a reason before confirmation is enabled.
 * Resets form state when closed.
 */
export function ReassignPoolDialog({
  open,
  onClose,
  onConfirm,
  isPending,
  currentPoolId,
}: ReassignPoolDialogProps) {
  const [selectedPoolId, setSelectedPoolId] = useState("");
  const [reason, setReason] = useState("");

  const { data: poolsData, isLoading: poolsLoading } = usePools({ limit: 100 });
  const pools = poolsData?.data ?? [];

  /** Pools available for reassignment (excludes the current pool). */
  const availablePools = currentPoolId ? pools.filter((p) => p.id !== currentPoolId) : pools;

  const canConfirm = selectedPoolId.length > 0 && reason.trim().length > 0 && !isPending;

  function resetForm() {
    setSelectedPoolId("");
    setReason("");
  }

  function handleClose() {
    if (!isPending) {
      resetForm();
      onClose();
    }
  }

  function handleConfirm() {
    if (canConfirm) {
      onConfirm(selectedPoolId, reason.trim());
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent data-testid="reassign-pool-dialog">
        <DialogHeader>
          <DialogTitle>Reassign Worker Pool</DialogTitle>
          <DialogDescription>
            Move this task to a different worker pool. The task will be processed by workers in the
            selected pool.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="reassign-pool-select">Target Pool</Label>
            <select
              id="reassign-pool-select"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              value={selectedPoolId}
              onChange={(e) => setSelectedPoolId(e.target.value)}
              disabled={isPending || poolsLoading}
              data-testid="reassign-pool-select"
            >
              <option value="">{poolsLoading ? "Loading pools…" : "Select a pool"}</option>
              {availablePools.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.name} ({pool.poolType})
                </option>
              ))}
            </select>
            {!poolsLoading && availablePools.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No other pools available for reassignment.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reassign-pool-reason">Reason</Label>
            <Textarea
              id="reassign-pool-reason"
              placeholder="Enter a reason for this reassignment (required for audit trail)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isPending}
              data-testid="reassign-pool-reason"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isPending}
            data-testid="reassign-pool-cancel"
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm} data-testid="reassign-pool-submit">
            {isPending ? "Processing…" : "Reassign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
