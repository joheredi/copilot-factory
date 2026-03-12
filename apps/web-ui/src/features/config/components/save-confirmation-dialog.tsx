import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";
import { Button } from "../../../components/ui/button.js";

/**
 * Props for the {@link SaveConfirmationDialog} component.
 */
export interface SaveConfirmationDialogProps {
  /** Whether the dialog is currently open. */
  readonly open: boolean;
  /** Callback to close the dialog. */
  readonly onOpenChange: (open: boolean) => void;
  /** Callback invoked when the user confirms the save. */
  readonly onConfirm: () => void;
  /** Name of the entity being saved (e.g., "Default Policy Set"). */
  readonly entityName: string;
  /** Brief description of the changes being saved. */
  readonly changeDescription: string;
  /** Whether a save operation is currently in progress. */
  readonly isSaving?: boolean;
}

/**
 * Confirmation dialog displayed before saving configuration changes.
 *
 * Requires the operator to explicitly confirm before persisting changes,
 * preventing accidental modifications to factory configuration. Shows
 * the entity name and a summary of what will change.
 *
 * @see T099 — Build configuration editor view
 */
export function SaveConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
  entityName,
  changeDescription,
  isSaving = false,
}: SaveConfirmationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="save-confirmation-dialog">
        <DialogHeader>
          <DialogTitle>Confirm Save</DialogTitle>
          <DialogDescription>
            You are about to save changes to <strong>{entityName}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground" data-testid="save-change-description">
            {changeDescription}
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            data-testid="save-cancel-btn"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isSaving}
            data-testid="save-confirm-btn"
          >
            {isSaving ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
