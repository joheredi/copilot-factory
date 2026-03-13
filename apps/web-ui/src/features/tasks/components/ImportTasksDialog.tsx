/**
 * Multi-step dialog for importing tasks from a local directory.
 *
 * Guides the operator through four steps:
 * 1. **Path Input** — enter a filesystem path and optional glob pattern, then scan.
 * 2. **Preview** — review discovered tasks in a table with checkboxes to
 *    include/exclude, see parse warnings, and edit the suggested project
 *    and repository names.
 * 3. **Confirm** — review a summary of what will be created before committing.
 * 4. **Result** — view created/skipped/error counts and navigate to the task list.
 *
 * State is fully reset when the dialog is closed and reopened, preventing
 * stale data from leaking across sessions.
 *
 * @see T118 — Build Import Tasks multi-step dialog
 * @see T117 — TanStack Query import hooks (useDiscoverTasks, useExecuteImport)
 */

import { useState, useCallback, useMemo } from "react";
import { Upload, Search, AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react";
import { useDiscoverTasks, useExecuteImport } from "../../../api/hooks/use-import.js";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.js";
import { Badge } from "../../../components/ui/badge.js";
import { Card, CardContent } from "../../../components/ui/card.js";
import type {
  DiscoverResponse,
  ExecuteImportResponse,
  ImportedTask,
  ParseWarning,
} from "../../../api/types.js";

type Step = 1 | 2 | 3 | 4;

/** Internal state tracked across dialog steps. */
interface DialogState {
  readonly step: Step;
  readonly path: string;
  readonly pattern: string;
  readonly discoverResult: DiscoverResponse | null;
  readonly selectedIndices: Set<number>;
  readonly projectName: string;
  readonly repositoryName: string;
  readonly importResult: ExecuteImportResponse | null;
  readonly error: string;
}

const INITIAL_STATE: DialogState = {
  step: 1,
  path: "",
  pattern: "",
  discoverResult: null,
  selectedIndices: new Set(),
  projectName: "",
  repositoryName: "",
  importResult: null,
  error: "",
};

/**
 * Returns a severity-appropriate icon for parse warnings.
 *
 * Maps warning severity levels to lucide icons so operators can
 * quickly distinguish informational notes from actionable errors.
 */
function warningSeverityIcon(severity: ParseWarning["severity"]) {
  switch (severity) {
    case "error":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case "info":
      return <Info className="h-4 w-4 text-blue-500" />;
  }
}

/**
 * Formats a task priority value into a human-readable badge variant.
 *
 * Ensures consistent visual treatment of priority levels across
 * the preview table.
 */
function priorityBadgeVariant(
  priority: string | undefined,
): "destructive" | "default" | "secondary" | "outline" {
  switch (priority) {
    case "critical":
      return "destructive";
    case "high":
      return "default";
    case "medium":
      return "secondary";
    default:
      return "outline";
  }
}

interface ImportTasksDialogProps {
  /** Controls whether the dialog is open. */
  readonly open: boolean;
  /** Callback invoked when the dialog's open state should change. */
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Multi-step import dialog component.
 *
 * Renders a four-step wizard inside a shadcn Dialog. Each step
 * has its own UI and advances to the next on successful completion.
 * The entire state resets when the dialog closes.
 */
export function ImportTasksDialog({ open, onOpenChange }: ImportTasksDialogProps) {
  const [state, setState] = useState<DialogState>(INITIAL_STATE);
  const discover = useDiscoverTasks();
  const executeImport = useExecuteImport();

  /** Resets all dialog state back to step 1. */
  const resetState = useCallback(() => {
    setState(INITIAL_STATE);
    discover.reset();
    executeImport.reset();
  }, [discover, executeImport]);

  /**
   * Handles dialog open/close transitions.
   *
   * Prevents closing while a mutation is in-flight to avoid
   * data loss. Resets state on close so re-opening is clean.
   */
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && (discover.isPending || executeImport.isPending)) {
        return;
      }
      if (!nextOpen) {
        resetState();
      }
      onOpenChange(nextOpen);
    },
    [discover.isPending, executeImport.isPending, onOpenChange, resetState],
  );

  /**
   * Initiates filesystem scanning via the discover mutation.
   *
   * On success, transitions to step 2 with all tasks pre-selected
   * and the suggested project/repository names populated.
   */
  const handleScan = useCallback(() => {
    if (!state.path.trim()) return;

    setState((prev) => ({ ...prev, error: "" }));
    discover.mutate(
      {
        path: state.path.trim(),
        ...(state.pattern.trim() && { pattern: state.pattern.trim() }),
      },
      {
        onSuccess: (result) => {
          const allIndices = new Set(result.tasks.map((_, i) => i));
          setState((prev) => ({
            ...prev,
            step: 2,
            discoverResult: result,
            selectedIndices: allIndices,
            projectName: result.suggestedProjectName,
            repositoryName: result.suggestedRepositoryName,
            error: "",
          }));
        },
        onError: (err) => {
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : "Failed to scan directory",
          }));
        },
      },
    );
  }, [state.path, state.pattern, discover]);

  /**
   * Toggles selection state for a single task in the preview table.
   *
   * Uses Set operations to add or remove the task index from
   * the selected set without mutating the existing set.
   */
  const toggleTask = useCallback((index: number) => {
    setState((prev) => {
      const next = new Set(prev.selectedIndices);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return { ...prev, selectedIndices: next };
    });
  }, []);

  /**
   * Toggles all tasks on or off based on current selection state.
   *
   * If all tasks are currently selected, deselects all. Otherwise
   * selects all tasks.
   */
  const toggleAll = useCallback(() => {
    setState((prev) => {
      if (!prev.discoverResult) return prev;
      const allSelected = prev.selectedIndices.size === prev.discoverResult.tasks.length;
      const next = allSelected
        ? new Set<number>()
        : new Set(prev.discoverResult.tasks.map((_, i) => i));
      return { ...prev, selectedIndices: next };
    });
  }, []);

  /** Selected task objects derived from indices and discover result. */
  const selectedTasks: ImportedTask[] = useMemo(() => {
    if (!state.discoverResult) return [];
    return state.discoverResult.tasks.filter((_, i) => state.selectedIndices.has(i));
  }, [state.discoverResult, state.selectedIndices]);

  /**
   * Advances from the preview step to the confirmation step.
   *
   * Requires at least one task to be selected and valid project/repo names.
   */
  const handleContinueToConfirm = useCallback(() => {
    if (selectedTasks.length === 0 || !state.projectName.trim()) return;
    setState((prev) => ({ ...prev, step: 3, error: "" }));
  }, [selectedTasks.length, state.projectName]);

  /**
   * Executes the import, creating tasks in the factory database.
   *
   * On success transitions to step 4 to show the result summary.
   */
  const handleImport = useCallback(() => {
    if (!state.discoverResult) return;

    setState((prev) => ({ ...prev, error: "" }));
    executeImport.mutate(
      {
        path: state.path.trim(),
        tasks: selectedTasks,
        projectName: state.projectName.trim(),
        ...(state.repositoryName.trim() && { repositoryName: state.repositoryName.trim() }),
      },
      {
        onSuccess: (result) => {
          setState((prev) => ({
            ...prev,
            step: 4,
            importResult: result,
            error: "",
          }));
        },
        onError: (err) => {
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : "Import failed",
          }));
        },
      },
    );
  }, [
    state.discoverResult,
    state.path,
    state.projectName,
    state.repositoryName,
    selectedTasks,
    executeImport,
  ]);

  /** Navigates back one step in the wizard flow. */
  const handleBack = useCallback(() => {
    setState((prev) => ({
      ...prev,
      step: Math.max(1, prev.step - 1) as Step,
      error: "",
    }));
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[85vh] overflow-y-auto"
        data-testid="import-tasks-dialog"
      >
        {/* Step indicator */}
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground mb-2"
          data-testid="step-indicator"
        >
          {(["Path", "Preview", "Confirm", "Result"] as const).map((label, i) => (
            <span key={label} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/50">→</span>}
              <span
                className={
                  state.step === i + 1
                    ? "font-semibold text-foreground"
                    : state.step > i + 1
                      ? "text-muted-foreground"
                      : "text-muted-foreground/50"
                }
              >
                {label}
              </span>
            </span>
          ))}
        </div>

        {/* Error banner */}
        {state.error && (
          <div
            className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
            data-testid="import-error"
          >
            {state.error}
          </div>
        )}

        {/* Step 1: Path Input */}
        {state.step === 1 && (
          <>
            <DialogHeader>
              <DialogTitle>Import Tasks</DialogTitle>
              <DialogDescription>
                Enter a local directory path to scan for task files. The scanner will detect
                markdown and JSON task formats automatically.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="import-path">
                  Directory Path <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="import-path"
                  placeholder="/path/to/backlog"
                  value={state.path}
                  onChange={(e) =>
                    setState((prev) => ({ ...prev, path: e.target.value, error: "" }))
                  }
                  disabled={discover.isPending}
                  data-testid="import-path-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="import-pattern">Glob Pattern (optional)</Label>
                <Input
                  id="import-pattern"
                  placeholder="*.md"
                  value={state.pattern}
                  onChange={(e) => setState((prev) => ({ ...prev, pattern: e.target.value }))}
                  disabled={discover.isPending}
                  data-testid="import-pattern-input"
                />
                <p className="text-xs text-muted-foreground">
                  Filter which files to scan. Leave empty to scan all supported formats.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={discover.isPending}
                data-testid="import-cancel-btn"
              >
                Cancel
              </Button>
              <Button
                onClick={handleScan}
                disabled={!state.path.trim() || discover.isPending}
                className="gap-2"
                data-testid="import-scan-btn"
              >
                <Search className="h-4 w-4" />
                {discover.isPending ? "Scanning…" : "Scan"}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 2: Preview */}
        {state.step === 2 && state.discoverResult && (
          <>
            <DialogHeader>
              <DialogTitle>Preview Discovered Tasks</DialogTitle>
              <DialogDescription>
                Found {state.discoverResult.tasks.length} task(s) in{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">{state.path}</code>. Select
                which tasks to import.
              </DialogDescription>
            </DialogHeader>

            {/* Warnings */}
            {state.discoverResult.warnings.length > 0 && (
              <div className="space-y-2" data-testid="import-warnings">
                {state.discoverResult.warnings.map((w, i) => (
                  <div
                    key={`${w.file}-${w.field ?? ""}-${i}`}
                    className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                      w.severity === "error"
                        ? "border-destructive/50 bg-destructive/10 text-destructive"
                        : w.severity === "warning"
                          ? "border-yellow-500/50 bg-yellow-50 text-yellow-800 dark:bg-yellow-950/20 dark:text-yellow-200"
                          : "border-blue-500/50 bg-blue-50 text-blue-800 dark:bg-blue-950/20 dark:text-blue-200"
                    }`}
                  >
                    {warningSeverityIcon(w.severity)}
                    <div>
                      <span className="font-medium">{w.file}</span>
                      {w.field && <span className="text-muted-foreground"> · {w.field}</span>}
                      <span>: {w.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Project / Repository name fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="import-project-name">
                  Project Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="import-project-name"
                  value={state.projectName}
                  onChange={(e) =>
                    setState((prev) => ({ ...prev, projectName: e.target.value, error: "" }))
                  }
                  data-testid="import-project-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="import-repository-name">Repository Name</Label>
                <Input
                  id="import-repository-name"
                  value={state.repositoryName}
                  onChange={(e) =>
                    setState((prev) => ({ ...prev, repositoryName: e.target.value }))
                  }
                  data-testid="import-repository-name"
                />
              </div>
            </div>

            {/* Task table */}
            <div className="max-h-[40vh] overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={
                          state.discoverResult.tasks.length > 0 &&
                          state.selectedIndices.size === state.discoverResult.tasks.length
                        }
                        onChange={toggleAll}
                        className="h-4 w-4 rounded border-gray-300 accent-primary"
                        aria-label="Select all tasks"
                        data-testid="import-select-all"
                      />
                    </TableHead>
                    <TableHead className="min-w-[200px]">Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Ref</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.discoverResult.tasks.map((task, index) => (
                    <TableRow key={`${task.title}-${index}`}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={state.selectedIndices.has(index)}
                          onChange={() => toggleTask(index)}
                          className="h-4 w-4 rounded border-gray-300 accent-primary"
                          aria-label={`Select ${task.title}`}
                          data-testid={`import-task-checkbox-${index}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{task.title}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {task.taskType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {task.priority && (
                          <Badge variant={priorityBadgeVariant(task.priority)} className="text-xs">
                            {task.priority}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {task.externalRef ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="text-sm text-muted-foreground" data-testid="import-selection-count">
              {state.selectedIndices.size} of {state.discoverResult.tasks.length} task(s) selected
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleBack} data-testid="import-back-btn">
                Back
              </Button>
              <Button
                onClick={handleContinueToConfirm}
                disabled={selectedTasks.length === 0 || !state.projectName.trim()}
                data-testid="import-continue-btn"
              >
                Continue
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 3: Confirm */}
        {state.step === 3 && (
          <>
            <DialogHeader>
              <DialogTitle>Confirm Import</DialogTitle>
              <DialogDescription>Review the import summary before proceeding.</DialogDescription>
            </DialogHeader>

            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <span className="text-muted-foreground">Tasks to import</span>
                  <span className="font-medium" data-testid="confirm-task-count">
                    {selectedTasks.length}
                  </span>

                  <span className="text-muted-foreground">Project</span>
                  <span className="font-medium" data-testid="confirm-project-name">
                    {state.projectName}
                  </span>

                  {state.repositoryName.trim() && (
                    <>
                      <span className="text-muted-foreground">Repository</span>
                      <span className="font-medium" data-testid="confirm-repository-name">
                        {state.repositoryName}
                      </span>
                    </>
                  )}

                  <span className="text-muted-foreground">Source path</span>
                  <span className="font-medium text-xs break-all" data-testid="confirm-source-path">
                    {state.path}
                  </span>
                </div>
              </CardContent>
            </Card>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={executeImport.isPending}
                data-testid="confirm-back-btn"
              >
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={executeImport.isPending}
                className="gap-2"
                data-testid="confirm-import-btn"
              >
                <Upload className="h-4 w-4" />
                {executeImport.isPending ? "Importing…" : "Import"}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 4: Result */}
        {state.step === 4 && state.importResult && (
          <>
            <DialogHeader>
              <DialogTitle>Import Complete</DialogTitle>
              <DialogDescription>The import has finished. See the summary below.</DialogDescription>
            </DialogHeader>

            <Card>
              <CardContent className="pt-6 space-y-4">
                {/* Success summary */}
                {state.importResult.created > 0 && (
                  <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                    <CheckCircle2 className="h-5 w-5" />
                    <span data-testid="result-created">
                      {state.importResult.created} task(s) created
                    </span>
                  </div>
                )}

                {state.importResult.skipped > 0 && (
                  <div className="flex items-center gap-2 text-sm text-yellow-700 dark:text-yellow-400">
                    <AlertTriangle className="h-5 w-5" />
                    <span data-testid="result-skipped">
                      {state.importResult.skipped} task(s) skipped
                    </span>
                  </div>
                )}

                {state.importResult.errors.length > 0 && (
                  <div className="space-y-2" data-testid="result-errors">
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <XCircle className="h-5 w-5" />
                      <span>{state.importResult.errors.length} error(s)</span>
                    </div>
                    <ul className="ml-7 space-y-1 text-xs text-destructive list-disc">
                      {state.importResult.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {state.importResult.created === 0 &&
                  state.importResult.skipped === 0 &&
                  state.importResult.errors.length === 0 && (
                    <p className="text-sm text-muted-foreground">No tasks were processed.</p>
                  )}
              </CardContent>
            </Card>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                data-testid="result-close-btn"
              >
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
