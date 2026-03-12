/**
 * Confirmation dialog for operator actions that require a reason.
 *
 * Wraps the Radix Dialog primitive to present a modal that:
 * - Describes the action being taken
 * - Requires the operator to enter a reason (for audit trail)
 * - Shows a cancel/confirm button pair
 * - Disables confirm while the action is in progress
 *
 * Used by destructive and state-changing operator actions (cancel,
 * force-unblock, pause, reopen, etc.) to prevent accidental execution.
 *
 * @see T104 — Integrate operator controls into task detail UI
 * @see docs/prd/006-additional-refinements.md §6.2
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { Button } from "../../../../components/ui/button";
import { Label } from "../../../../components/ui/label";
import { Textarea } from "../../../../components/ui/textarea";

/** Props for the ConfirmActionDialog component. */
interface ConfirmActionDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Callback when the dialog is closed (cancel or backdrop click). */
  readonly onClose: () => void;
  /** Callback when the operator confirms the action with a reason. */
  readonly onConfirm: (reason: string) => void;
  /** Title displayed in the dialog header. */
  readonly title: string;
  /** Description of what the action will do. */
  readonly description: string;
  /** Whether the action is currently being executed. */
  readonly isPending: boolean;
  /** Label for the confirm button (defaults to "Confirm"). */
  readonly confirmLabel?: string;
  /** Visual variant for the confirm button. */
  readonly confirmVariant?: "default" | "destructive";
  /**
   * Whether to show an acknowledgment checkbox for in-progress work.
   * Used by the cancel action when a task is IN_DEVELOPMENT.
   */
  readonly showAcknowledgeInProgress?: boolean;
}

/**
 * Modal confirmation dialog for operator actions.
 *
 * Requires a non-empty reason text before the confirm button becomes
 * active. Resets internal state when closed.
 */
export function ConfirmActionDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  isPending,
  confirmLabel = "Confirm",
  confirmVariant = "default",
  showAcknowledgeInProgress = false,
}: ConfirmActionDialogProps) {
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const canConfirm =
    reason.trim().length > 0 && (!showAcknowledgeInProgress || acknowledged) && !isPending;

  function handleConfirm() {
    if (canConfirm) {
      onConfirm(reason.trim());
    }
  }

  function handleClose() {
    if (!isPending) {
      setReason("");
      setAcknowledged(false);
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent data-testid="confirm-action-dialog">
        <DialogHeader>
          <DialogTitle data-testid="confirm-dialog-title">{title}</DialogTitle>
          <DialogDescription data-testid="confirm-dialog-description">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="action-reason">Reason</Label>
            <Textarea
              id="action-reason"
              placeholder="Enter a reason for this action (required for audit trail)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isPending}
              data-testid="confirm-dialog-reason"
            />
          </div>

          {showAcknowledgeInProgress && (
            <label className="flex items-start gap-2 text-sm" data-testid="acknowledge-in-progress">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                disabled={isPending}
                className="mt-0.5"
              />
              <span>I acknowledge that this task has in-progress work that will be lost.</span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isPending}
            data-testid="confirm-dialog-cancel"
          >
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            onClick={handleConfirm}
            disabled={!canConfirm}
            data-testid="confirm-dialog-submit"
          >
            {isPending ? "Processing…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
