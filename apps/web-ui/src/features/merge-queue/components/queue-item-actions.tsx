/**
 * Per-item action controls for merge queue items.
 *
 * Provides operators with inline controls to reorder items in the
 * merge queue (via override-merge-order) or requeue individual failed
 * items. Uses the operator action API endpoints with confirmation
 * dialogs for safety.
 *
 * @see T105 — Integrate operator controls into pool and merge queue UI
 * @see docs/prd/006-additional-refinements.md §6.2 — Merge queue management
 */

import { useState } from "react";
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";
import { Label } from "../../../components/ui/label.js";
import { Textarea } from "../../../components/ui/textarea.js";
import { apiPost } from "../../../api/client.js";
import type { OperatorActionResult } from "../../../api/types.js";
import type { ActionFeedback } from "../../task-detail/components/operator-actions/use-action-feedback.js";

/** Props for the QueueItemActions component. */
export interface QueueItemActionsProps {
  /** Task ID associated with this merge queue item. */
  readonly taskId: string;
  /** Current position of the item in the queue. */
  readonly currentPosition: number;
  /** Current status of the merge queue item. */
  readonly status: string;
  /** Callback when the action completes with feedback. */
  readonly onFeedback: (type: ActionFeedback["type"], message: string) => void;
  /** Callback to refresh the merge queue data after action. */
  readonly onComplete: () => void;
}

/** Statuses where reorder is allowed (items not yet actively merging). */
const REORDERABLE_STATUSES = new Set(["ENQUEUED", "REQUEUED"]);

/** Statuses where requeue is offered (failed items). */
const REQUEUEABLE_STATUSES = new Set(["FAILED"]);

/**
 * Inline action controls for a merge queue item row.
 *
 * Renders reorder buttons (move up/down by one position) for items
 * in ENQUEUED or REQUEUED status, and a requeue button for FAILED
 * items. All actions require a reason via confirmation dialog.
 */
export function QueueItemActions({
  taskId,
  currentPosition,
  status,
  onFeedback,
  onComplete,
}: QueueItemActionsProps) {
  const [showReorderDialog, setShowReorderDialog] = useState(false);
  const [showRequeueDialog, setShowRequeueDialog] = useState(false);
  const [targetPosition, setTargetPosition] = useState(currentPosition);
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);

  const canReorder = REORDERABLE_STATUSES.has(status);
  const canRequeue = REQUEUEABLE_STATUSES.has(status);

  function handleReorder(newPosition: number) {
    setTargetPosition(newPosition);
    setShowReorderDialog(true);
  }

  async function confirmReorder() {
    if (!reason.trim()) return;
    setIsPending(true);
    try {
      await apiPost<OperatorActionResult>(`/tasks/${taskId}/actions/override-merge-order`, {
        actorId: "operator",
        position: targetPosition,
        reason: reason.trim(),
      });
      onFeedback("success", `Moved item from position ${currentPosition} to ${targetPosition}.`);
      onComplete();
    } catch (err) {
      onFeedback("error", `Failed to reorder: ${(err as Error).message}`);
    } finally {
      setIsPending(false);
      setShowReorderDialog(false);
      setReason("");
    }
  }

  async function confirmRequeue() {
    if (!reason.trim()) return;
    setIsPending(true);
    try {
      await apiPost<OperatorActionResult>(`/tasks/${taskId}/actions/requeue`, {
        actorId: "operator",
        reason: reason.trim(),
      });
      onFeedback("success", "Item requeued successfully.");
      onComplete();
    } catch (err) {
      onFeedback("error", `Failed to requeue: ${(err as Error).message}`);
    } finally {
      setIsPending(false);
      setShowRequeueDialog(false);
      setReason("");
    }
  }

  function handleClose(setter: (val: boolean) => void) {
    if (!isPending) {
      setter(false);
      setReason("");
    }
  }

  if (!canReorder && !canRequeue) return null;

  return (
    <div className="flex items-center gap-1" data-testid={`queue-actions-${taskId}`}>
      {canReorder && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => handleReorder(Math.max(1, currentPosition - 1))}
            disabled={currentPosition <= 1 || isPending}
            data-testid={`move-up-${taskId}`}
            aria-label="Move up in queue"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => handleReorder(currentPosition + 1)}
            disabled={isPending}
            data-testid={`move-down-${taskId}`}
            aria-label="Move down in queue"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
        </>
      )}

      {canRequeue && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowRequeueDialog(true)}
          disabled={isPending}
          data-testid={`requeue-item-${taskId}`}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Requeue
        </Button>
      )}

      {/* Reorder confirmation dialog */}
      <Dialog
        open={showReorderDialog}
        onOpenChange={(isOpen) => !isOpen && handleClose(setShowReorderDialog)}
      >
        <DialogContent data-testid="reorder-dialog">
          <DialogHeader>
            <DialogTitle>Change Queue Position</DialogTitle>
            <DialogDescription>
              Move this item from position {currentPosition} to a new position. Lower positions
              merge first.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="target-position">Target Position</Label>
              <Input
                id="target-position"
                type="number"
                min={1}
                value={targetPosition}
                onChange={(e) => setTargetPosition(parseInt(e.target.value, 10) || 1)}
                disabled={isPending}
                data-testid="reorder-position-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reorder-reason">Reason</Label>
              <Textarea
                id="reorder-reason"
                placeholder="Enter a reason for reordering (required for audit trail)..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={isPending}
                data-testid="reorder-reason-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleClose(setShowReorderDialog)}
              disabled={isPending}
              data-testid="reorder-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void confirmReorder()}
              disabled={!reason.trim() || isPending}
              data-testid="reorder-confirm-btn"
            >
              {isPending ? "Moving…" : "Move Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Requeue confirmation dialog */}
      <Dialog
        open={showRequeueDialog}
        onOpenChange={(isOpen) => !isOpen && handleClose(setShowRequeueDialog)}
      >
        <DialogContent data-testid="requeue-dialog">
          <DialogHeader>
            <DialogTitle>Requeue Failed Item</DialogTitle>
            <DialogDescription>
              This will requeue the failed item for another merge attempt. The task will re-enter
              the merge pipeline from the beginning.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="requeue-reason">Reason</Label>
              <Textarea
                id="requeue-reason"
                placeholder="Enter a reason for requeuing (required for audit trail)..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={isPending}
                data-testid="requeue-reason-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleClose(setShowRequeueDialog)}
              disabled={isPending}
              data-testid="requeue-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void confirmRequeue()}
              disabled={!reason.trim() || isPending}
              data-testid="requeue-confirm-btn"
            >
              {isPending ? "Requeuing…" : "Requeue Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
