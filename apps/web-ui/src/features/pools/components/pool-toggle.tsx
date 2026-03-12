/**
 * Pool enable/disable toggle with confirmation dialog.
 *
 * Allows operators to toggle a pool's enabled state. Disabling a pool
 * is a disruptive action (stops scheduling new tasks to the pool), so
 * it requires confirmation via a dialog. Enabling a pool is safe and
 * does not require confirmation.
 *
 * Uses the existing `useUpdatePool` mutation to PATCH the pool's
 * `enabled` field, and shows inline success/error feedback.
 *
 * @see T105 — Integrate operator controls into pool and merge queue UI
 * @see docs/prd/006-additional-refinements.md §6.2 — Pool management
 */

import { useState } from "react";
import { Power, PowerOff } from "lucide-react";
import { Button } from "../../../components/ui/button.js";
import { ConfirmActionDialog } from "../../task-detail/components/operator-actions/ConfirmActionDialog.js";
import { useUpdatePool } from "../../../api/hooks/use-pools.js";
import type { ActionFeedback } from "../../task-detail/components/operator-actions/use-action-feedback.js";

/** Props for the PoolToggle component. */
export interface PoolToggleProps {
  /** Pool ID to toggle. */
  readonly poolId: string;
  /** Current enabled state of the pool. */
  readonly enabled: boolean;
  /** Callback when the action completes with feedback. */
  readonly onFeedback: (type: ActionFeedback["type"], message: string) => void;
}

/**
 * Toggle button for pool enabled/disabled state.
 *
 * When the pool is enabled, clicking shows a confirmation dialog
 * (disabling affects scheduling). When disabled, clicking enables
 * the pool immediately without confirmation.
 */
export function PoolToggle({ poolId, enabled, onFeedback }: PoolToggleProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const updatePool = useUpdatePool(poolId);

  function handleEnableClick() {
    updatePool.mutate(
      { enabled: true },
      {
        onSuccess: () => onFeedback("success", "Pool enabled successfully."),
        onError: (err) => onFeedback("error", `Failed to enable pool: ${(err as Error).message}`),
      },
    );
  }

  function handleDisableConfirm(reason: string) {
    updatePool.mutate(
      { enabled: false },
      {
        onSuccess: () => {
          setShowConfirm(false);
          onFeedback("success", `Pool disabled. Reason: ${reason}`);
        },
        onError: (err) => {
          setShowConfirm(false);
          onFeedback("error", `Failed to disable pool: ${(err as Error).message}`);
        },
      },
    );
  }

  if (enabled) {
    return (
      <>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowConfirm(true)}
          disabled={updatePool.isPending}
          data-testid="pool-disable-btn"
        >
          <PowerOff className="mr-1.5 h-4 w-4" />
          Disable Pool
        </Button>
        <ConfirmActionDialog
          open={showConfirm}
          onClose={() => setShowConfirm(false)}
          onConfirm={handleDisableConfirm}
          title="Disable Pool"
          description="Disabling this pool will stop scheduling new tasks to it. Existing active tasks will continue but no new work will be assigned. This affects overall scheduling capacity."
          isPending={updatePool.isPending}
          confirmLabel="Disable"
          confirmVariant="destructive"
        />
      </>
    );
  }

  return (
    <Button
      variant="default"
      size="sm"
      onClick={handleEnableClick}
      disabled={updatePool.isPending}
      data-testid="pool-enable-btn"
    >
      <Power className="mr-1.5 h-4 w-4" />
      {updatePool.isPending ? "Enabling…" : "Enable Pool"}
    </Button>
  );
}
