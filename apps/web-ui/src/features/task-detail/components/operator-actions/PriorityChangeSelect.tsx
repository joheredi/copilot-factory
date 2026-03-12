/**
 * Priority change control for operator actions.
 *
 * Renders a native select element for changing a task's priority.
 * Uses a native select to avoid adding a Radix Select dependency.
 * When the operator selects a new priority, the action is executed
 * immediately (no confirmation dialog needed for priority changes).
 *
 * @see T104 — Integrate operator controls into task detail UI
 */

import type { TaskPriority } from "../../../../api/types";

/** All valid priority values in display order. */
const PRIORITY_OPTIONS: readonly { value: TaskPriority; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;

/** Props for the PriorityChangeSelect component. */
interface PriorityChangeSelectProps {
  /** Current task priority. */
  readonly currentPriority: TaskPriority;
  /** Callback when a new priority is selected. */
  readonly onChangePriority: (priority: TaskPriority) => void;
  /** Whether the action is currently in progress. */
  readonly disabled: boolean;
}

/**
 * Inline priority selector for the task action bar.
 *
 * Only triggers the callback when the selected value differs from
 * the current priority, avoiding unnecessary API calls.
 */
export function PriorityChangeSelect({
  currentPriority,
  onChangePriority,
  disabled,
}: PriorityChangeSelectProps) {
  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newPriority = e.target.value as TaskPriority;
    if (newPriority !== currentPriority) {
      onChangePriority(newPriority);
    }
  }

  return (
    <div className="flex items-center gap-1.5" data-testid="priority-change-select">
      <label htmlFor="priority-select" className="text-sm text-muted-foreground whitespace-nowrap">
        Priority:
      </label>
      <select
        id="priority-select"
        value={currentPriority}
        onChange={handleChange}
        disabled={disabled}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="priority-select"
      >
        {PRIORITY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
