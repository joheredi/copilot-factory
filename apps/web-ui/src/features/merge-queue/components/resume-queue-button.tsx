/**
 * Resume button for a paused merge queue.
 *
 * When the merge queue has failed items, processing may be paused.
 * This button allows operators to requeue all failed items in one
 * action, effectively resuming queue processing. Requires confirmation
 * since it affects multiple tasks at once.
 *
 * Uses the requeue operator action endpoint for each failed item's
 * associated task.
 *
 * @see T105 — Integrate operator controls into pool and merge queue UI
 * @see docs/prd/006-additional-refinements.md §6.2 — Merge queue management
 */

import { useState } from "react";
import { PlayCircle } from "lucide-react";
import { Button } from "../../../components/ui/button.js";
import { ConfirmActionDialog } from "../../task-detail/components/operator-actions/ConfirmActionDialog.js";
import { apiPost } from "../../../api/client.js";
import type { OperatorActionResult } from "../../../api/types.js";
import type { ActionFeedback } from "../../task-detail/components/operator-actions/use-action-feedback.js";

/** Props for the ResumeQueueButton component. */
export interface ResumeQueueButtonProps {
  /** Task IDs of the failed merge queue items to requeue. */
  readonly failedTaskIds: readonly string[];
  /** Callback when the action completes with feedback. */
  readonly onFeedback: (type: ActionFeedback["type"], message: string) => void;
  /** Callback to refresh the merge queue data after requeue. */
  readonly onComplete: () => void;
}

/**
 * Button that requeues all failed merge queue items to resume processing.
 *
 * Shows a confirmation dialog listing the number of items that will be
 * requeued. Executes requeue actions sequentially to avoid overwhelming
 * the backend with concurrent state transitions.
 */
export function ResumeQueueButton({
  failedTaskIds,
  onFeedback,
  onComplete,
}: ResumeQueueButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function handleConfirm(reason: string) {
    setIsPending(true);
    let successCount = 0;
    let errorCount = 0;

    for (const taskId of failedTaskIds) {
      try {
        await apiPost<OperatorActionResult>(`/tasks/${taskId}/actions/requeue`, {
          actorId: "operator",
          reason,
        });
        successCount++;
      } catch {
        errorCount++;
      }
    }

    setIsPending(false);
    setShowConfirm(false);

    if (errorCount === 0) {
      onFeedback(
        "success",
        `Requeued ${successCount} failed item${successCount !== 1 ? "s" : ""}. Queue will resume processing.`,
      );
    } else {
      onFeedback(
        "error",
        `Requeued ${successCount} items, but ${errorCount} failed. Check individual items for details.`,
      );
    }
    onComplete();
  }

  if (failedTaskIds.length === 0) return null;

  return (
    <>
      <Button
        variant="default"
        size="sm"
        onClick={() => setShowConfirm(true)}
        disabled={isPending}
        data-testid="resume-queue-btn"
      >
        <PlayCircle className="mr-1.5 h-4 w-4" />
        Resume Queue
      </Button>
      <ConfirmActionDialog
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={(reason) => void handleConfirm(reason)}
        title="Resume Merge Queue"
        description={`This will requeue ${failedTaskIds.length} failed item${failedTaskIds.length !== 1 ? "s" : ""} for merge processing. Tasks will be re-evaluated and re-enter the merge pipeline.`}
        isPending={isPending}
        confirmLabel="Resume Queue"
        confirmVariant="default"
      />
    </>
  );
}
