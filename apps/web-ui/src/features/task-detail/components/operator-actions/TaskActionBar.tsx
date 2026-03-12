/**
 * Operator action bar for the task detail page.
 *
 * Renders state-dependent action buttons based on the current task status.
 * Handles confirmation dialogs, escalation resolution, priority changes,
 * and inline success/error feedback.
 *
 * This is the primary operator control surface for individual tasks.
 * Actions are dispatched through the TanStack Query mutation hooks
 * defined in `use-tasks.ts`, which handle cache invalidation
 * automatically so the UI refreshes after each action.
 *
 * @see T104 — Integrate operator controls into task detail UI
 * @see docs/prd/006-additional-refinements.md §6.2 — Operator actions
 */

import { useState } from "react";
import { Button } from "../../../../components/ui/button";
import { getActionsForStatus, type OperatorActionDef } from "./action-definitions";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { EscalationResolutionPanel } from "./EscalationResolutionPanel";
import { PriorityChangeSelect } from "./PriorityChangeSelect";
import { ActionFeedbackBanner } from "./ActionFeedbackBanner";
import { useActionFeedback } from "./use-action-feedback";
import {
  usePauseTask,
  useResumeTask,
  useRequeueTask,
  useForceUnblock,
  useCancelTask,
  useChangePriority,
  useRerunReview,
  useOverrideMergeOrder,
  useReopenTask,
  useResolveEscalation,
} from "../../../../api/hooks/use-tasks";
import type { TaskPriority, ResolveEscalationInput, Task } from "../../../../api/types";
import { ApiClientError } from "../../../../api/client";

/** Default actor ID for operator actions (placeholder until auth is integrated). */
const OPERATOR_ACTOR_ID = "operator";

/** Props for the TaskActionBar component. */
interface TaskActionBarProps {
  /** The task to display actions for. */
  readonly task: Task;
}

/**
 * Renders operator action controls for a task.
 *
 * Shows only actions valid for the current task state, with:
 * - Confirmation dialogs for destructive/state-changing actions
 * - Inline priority selector
 * - Escalation resolution panel for ESCALATED tasks
 * - Success/error feedback banners
 */
export function TaskActionBar({ task }: TaskActionBarProps) {
  const [confirmAction, setConfirmAction] = useState<OperatorActionDef | null>(null);
  const { feedback, showSuccess, showError, clearFeedback } = useActionFeedback();

  const actions = getActionsForStatus(task.status);

  // Mutation hooks
  const pauseMutation = usePauseTask(task.id);
  const resumeMutation = useResumeTask(task.id);
  const requeueMutation = useRequeueTask(task.id);
  const forceUnblockMutation = useForceUnblock(task.id);
  const cancelMutation = useCancelTask(task.id);
  const changePriorityMutation = useChangePriority(task.id);
  const rerunReviewMutation = useRerunReview(task.id);
  const overrideMergeOrderMutation = useOverrideMergeOrder(task.id);
  const reopenMutation = useReopenTask(task.id);
  const resolveEscalationMutation = useResolveEscalation(task.id);

  const anyPending =
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    requeueMutation.isPending ||
    forceUnblockMutation.isPending ||
    cancelMutation.isPending ||
    changePriorityMutation.isPending ||
    rerunReviewMutation.isPending ||
    overrideMergeOrderMutation.isPending ||
    reopenMutation.isPending ||
    resolveEscalationMutation.isPending;

  /**
   * Extracts a user-friendly error message from a mutation error.
   */
  function getErrorMessage(error: unknown): string {
    if (error instanceof ApiClientError) {
      return error.body?.message ?? error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "An unexpected error occurred.";
  }

  /**
   * Executes a confirmed operator action by dispatching to the
   * appropriate mutation hook based on the action ID.
   */
  function executeAction(actionDef: OperatorActionDef, reason: string) {
    const input = { actorId: OPERATOR_ACTOR_ID, reason };

    const callbacks = {
      onSuccess: () => {
        showSuccess(`${actionDef.label} completed successfully.`);
        setConfirmAction(null);
      },
      onError: (error: unknown) => {
        showError(getErrorMessage(error));
        setConfirmAction(null);
      },
    };

    switch (actionDef.id) {
      case "pause":
        pauseMutation.mutate(input, callbacks);
        break;
      case "resume":
        resumeMutation.mutate(input, callbacks);
        break;
      case "requeue":
        requeueMutation.mutate(input, callbacks);
        break;
      case "force-unblock":
        forceUnblockMutation.mutate(input, callbacks);
        break;
      case "cancel":
        cancelMutation.mutate(
          {
            ...input,
            ...(task.status === "IN_DEVELOPMENT" ? { acknowledgeInProgressWork: true } : {}),
          },
          callbacks,
        );
        break;
      case "rerun-review":
        rerunReviewMutation.mutate(input, callbacks);
        break;
      case "override-merge-order":
        overrideMergeOrderMutation.mutate({ ...input, position: 1 }, callbacks);
        break;
      case "reopen":
        reopenMutation.mutate(input, callbacks);
        break;
      default:
        break;
    }
  }

  /**
   * Handles priority change from the select dropdown.
   */
  function handlePriorityChange(priority: TaskPriority) {
    changePriorityMutation.mutate(
      { actorId: OPERATOR_ACTOR_ID, reason: `Priority changed to ${priority}`, priority },
      {
        onSuccess: () => showSuccess(`Priority changed to ${priority}.`),
        onError: (error) => showError(getErrorMessage(error)),
      },
    );
  }

  /**
   * Handles escalation resolution.
   */
  function handleResolveEscalation(input: Omit<ResolveEscalationInput, "actorId">) {
    resolveEscalationMutation.mutate(
      { ...input, actorId: OPERATOR_ACTOR_ID },
      {
        onSuccess: () => showSuccess(`Escalation resolved: ${input.resolutionType}.`),
        onError: (error) => showError(getErrorMessage(error)),
      },
    );
  }

  /**
   * Handles action button click — either opens confirmation dialog
   * or executes immediately for non-confirmation actions.
   */
  function handleActionClick(actionDef: OperatorActionDef) {
    if (actionDef.requiresConfirmation) {
      setConfirmAction(actionDef);
    }
  }

  if (actions.length === 0) return null;

  // Separate special actions from regular ones
  const hasPriorityAction = actions.some((a) => a.id === "change-priority");
  const hasEscalationAction = actions.some((a) => a.id === "resolve-escalation");
  const regularActions = actions.filter(
    (a) => a.id !== "change-priority" && a.id !== "resolve-escalation",
  );

  return (
    <div className="space-y-3" data-testid="task-action-bar">
      <ActionFeedbackBanner feedback={feedback} onDismiss={clearFeedback} />

      <div className="flex flex-wrap items-center gap-2">
        {/* Priority dropdown */}
        {hasPriorityAction && (
          <PriorityChangeSelect
            currentPriority={task.priority as TaskPriority}
            onChangePriority={handlePriorityChange}
            disabled={anyPending}
          />
        )}

        {/* Divider between priority and action buttons */}
        {hasPriorityAction && regularActions.length > 0 && (
          <div className="mx-1 h-6 w-px bg-border" />
        )}

        {/* Regular action buttons */}
        {regularActions.map((actionDef) => (
          <Button
            key={actionDef.id}
            variant={actionDef.variant}
            size="sm"
            onClick={() => handleActionClick(actionDef)}
            disabled={anyPending}
            data-testid={`action-btn-${actionDef.id}`}
          >
            {actionDef.label}
          </Button>
        ))}

        {/* Escalation resolution panel */}
        {hasEscalationAction && (
          <EscalationResolutionPanel onResolve={handleResolveEscalation} isPending={anyPending} />
        )}
      </div>

      {/* Confirmation dialog for the active action */}
      {confirmAction && (
        <ConfirmActionDialog
          open={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirm={(reason) => executeAction(confirmAction, reason)}
          title={confirmAction.label}
          description={confirmAction.description}
          isPending={anyPending}
          confirmLabel={confirmAction.label}
          confirmVariant={confirmAction.variant === "destructive" ? "destructive" : "default"}
          showAcknowledgeInProgress={
            confirmAction.id === "cancel" && task.status === "IN_DEVELOPMENT"
          }
        />
      )}
    </div>
  );
}
