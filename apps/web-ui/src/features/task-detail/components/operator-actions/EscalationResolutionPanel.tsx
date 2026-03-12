/**
 * Escalation resolution panel for ESCALATED tasks.
 *
 * Presents three resolution options:
 * - **Retry**: Re-assign the task to a worker (optionally in a different pool)
 * - **Cancel**: Permanently cancel the escalated task
 * - **Mark Done**: Mark the task as externally completed (requires evidence)
 *
 * Each option opens a confirmation dialog with fields specific to the
 * resolution type. The "mark done" path requires non-empty evidence
 * explaining how the task was completed outside the system.
 *
 * @see apps/control-plane/src/operator-actions/operator-actions.service.ts — resolveEscalation
 * @see T104 — Integrate operator controls into task detail UI
 */

import { useState } from "react";
import { RotateCcw, XCircle, CheckCircle2 } from "lucide-react";
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
import { Input } from "../../../../components/ui/input";
import type { ResolveEscalationInput } from "../../../../api/types";

/** Props for the EscalationResolutionPanel component. */
interface EscalationResolutionPanelProps {
  /** Callback to execute the resolution action. */
  readonly onResolve: (input: Omit<ResolveEscalationInput, "actorId">) => void;
  /** Whether the action is currently in progress. */
  readonly isPending: boolean;
}

/** Which resolution dialog is currently open. */
type ResolutionDialog = "retry" | "cancel" | "mark_done" | null;

/**
 * Panel with three resolution buttons for ESCALATED tasks.
 *
 * Each button opens a dialog tailored to that resolution type.
 * The panel itself is rendered inline within the task action bar.
 */
export function EscalationResolutionPanel({
  onResolve,
  isPending,
}: EscalationResolutionPanelProps) {
  const [activeDialog, setActiveDialog] = useState<ResolutionDialog>(null);
  const [reason, setReason] = useState("");
  const [poolId, setPoolId] = useState("");
  const [evidence, setEvidence] = useState("");

  function resetForm() {
    setReason("");
    setPoolId("");
    setEvidence("");
    setActiveDialog(null);
  }

  function handleClose() {
    if (!isPending) {
      resetForm();
    }
  }

  function handleRetryConfirm() {
    onResolve({
      resolutionType: "retry",
      reason: reason.trim(),
      ...(poolId.trim() ? { poolId: poolId.trim() } : {}),
    });
  }

  function handleCancelConfirm() {
    onResolve({
      resolutionType: "cancel",
      reason: reason.trim(),
    });
  }

  function handleMarkDoneConfirm() {
    onResolve({
      resolutionType: "mark_done",
      reason: reason.trim(),
      evidence: evidence.trim(),
    });
  }

  const canConfirmRetry = reason.trim().length > 0 && !isPending;
  const canConfirmCancel = reason.trim().length > 0 && !isPending;
  const canConfirmMarkDone = reason.trim().length > 0 && evidence.trim().length > 0 && !isPending;

  return (
    <div data-testid="escalation-resolution-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Resolve:</span>
        <Button
          variant="default"
          size="sm"
          onClick={() => setActiveDialog("retry")}
          disabled={isPending}
          data-testid="escalation-retry-btn"
          className="gap-1"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setActiveDialog("cancel")}
          disabled={isPending}
          data-testid="escalation-cancel-btn"
          className="gap-1"
        >
          <XCircle className="h-3.5 w-3.5" />
          Cancel Task
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setActiveDialog("mark_done")}
          disabled={isPending}
          data-testid="escalation-mark-done-btn"
          className="gap-1"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Mark Done
        </Button>
      </div>

      {/* Retry Dialog */}
      <Dialog open={activeDialog === "retry"} onOpenChange={(isOpen) => !isOpen && handleClose()}>
        <DialogContent data-testid="escalation-retry-dialog">
          <DialogHeader>
            <DialogTitle>Retry Escalated Task</DialogTitle>
            <DialogDescription>
              Re-assign this task to a worker for another attempt. Optionally specify a different
              worker pool.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="retry-reason">Reason</Label>
              <Textarea
                id="retry-reason"
                placeholder="Why should this task be retried?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={isPending}
                data-testid="escalation-retry-reason"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retry-pool-id">Pool ID (optional)</Label>
              <Input
                id="retry-pool-id"
                placeholder="Leave empty to use the default pool"
                value={poolId}
                onChange={(e) => setPoolId(e.target.value)}
                disabled={isPending}
                data-testid="escalation-retry-pool-id"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isPending}
              data-testid="escalation-retry-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRetryConfirm}
              disabled={!canConfirmRetry}
              data-testid="escalation-retry-submit"
            >
              {isPending ? "Processing…" : "Retry Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={activeDialog === "cancel"} onOpenChange={(isOpen) => !isOpen && handleClose()}>
        <DialogContent data-testid="escalation-cancel-dialog">
          <DialogHeader>
            <DialogTitle>Cancel Escalated Task</DialogTitle>
            <DialogDescription>
              Permanently cancel this task. This is appropriate when the task is no longer relevant
              or is a duplicate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="cancel-reason">Reason</Label>
              <Textarea
                id="cancel-reason"
                placeholder="Why is this task being cancelled?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={isPending}
                data-testid="escalation-cancel-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isPending}
              data-testid="escalation-cancel-back"
            >
              Back
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelConfirm}
              disabled={!canConfirmCancel}
              data-testid="escalation-cancel-submit"
            >
              {isPending ? "Processing…" : "Cancel Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Done Dialog */}
      <Dialog
        open={activeDialog === "mark_done"}
        onOpenChange={(isOpen) => !isOpen && handleClose()}
      >
        <DialogContent data-testid="escalation-mark-done-dialog">
          <DialogHeader>
            <DialogTitle>Mark Task as Done</DialogTitle>
            <DialogDescription>
              Mark this task as externally completed. This bypasses the normal quality pipeline and
              requires evidence of external completion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="mark-done-reason">Reason</Label>
              <Textarea
                id="mark-done-reason"
                placeholder="Why is this task being marked as done?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={isPending}
                data-testid="escalation-mark-done-reason"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mark-done-evidence">Evidence (required)</Label>
              <Textarea
                id="mark-done-evidence"
                placeholder="Provide evidence of external completion (e.g., PR link, commit SHA, deployment URL)..."
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                disabled={isPending}
                data-testid="escalation-mark-done-evidence"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isPending}
              data-testid="escalation-mark-done-back"
            >
              Back
            </Button>
            <Button
              onClick={handleMarkDoneConfirm}
              disabled={!canConfirmMarkDone}
              data-testid="escalation-mark-done-submit"
            >
              {isPending ? "Processing…" : "Mark as Done"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
