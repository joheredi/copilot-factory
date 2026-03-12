/**
 * @module workspace-cleanup-policy
 * Domain rules for determining when a task workspace is eligible for cleanup.
 *
 * This module encodes the business rules from PRD §2.9 (Workspace Retention):
 * - Only terminal-state tasks (DONE, FAILED, CANCELLED) are eligible for cleanup.
 * - ESCALATED tasks are always retained (they are not terminal and need operator review).
 * - FAILED task workspaces are retained when `retain_failed_workspaces` is true.
 * - The `workspace_retention_hours` period must elapse after the task entered its
 *   terminal state before cleanup is allowed.
 *
 * The caller (typically the ReconcileWorkspacesCommand from T042) uses this function
 * to filter workspace candidates before invoking infrastructure-level cleanup.
 *
 * @see docs/prd/002-data-model.md §2.9 — Workspace Retention Rules
 * @see docs/prd/007-technical-architecture.md §7.10 — Workspace Strategy
 */

import { TaskStatus } from "./enums.js";
import { isTerminalState } from "./state-machines/task-state-machine.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Retention policy fields relevant to workspace cleanup eligibility.
 *
 * Defined here to avoid coupling the domain layer to the schemas package.
 * The shape matches the relevant subset of `RetentionPolicy` from `@factory/schemas`.
 */
export interface WorkspaceRetentionPolicy {
  /** Hours to retain workspace after task reaches terminal state. */
  readonly workspace_retention_hours: number;
  /** Whether to retain workspaces for FAILED tasks (for debugging). */
  readonly retain_failed_workspaces: boolean;
  /** Whether to retain workspaces for ESCALATED tasks (for operator review). */
  readonly retain_escalated_workspaces: boolean;
}

/**
 * Input parameters for the workspace cleanup eligibility check.
 */
export interface WorkspaceCleanupInput {
  /** Current status of the task whose workspace is being evaluated. */
  readonly taskStatus: TaskStatus;
  /** Effective retention policy for this task/project. */
  readonly retentionPolicy: WorkspaceRetentionPolicy;
  /**
   * Timestamp when the task entered its current terminal state.
   * Used with `workspace_retention_hours` to compute the retention deadline.
   * Ignored for non-terminal states.
   */
  readonly terminalStateAt: Date;
  /** Current time, used for retention period comparison. */
  readonly now: Date;
}

/**
 * Result of the workspace cleanup eligibility check.
 */
export interface WorkspaceCleanupEligibility {
  /** Whether the workspace is eligible for cleanup. */
  readonly eligible: boolean;
  /** Human-readable explanation of the eligibility decision. */
  readonly reason: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MS_PER_HOUR = 60 * 60 * 1000;

// ─── Eligibility Check ─────────────────────────────────────────────────────────

/**
 * Determine whether a task's workspace is eligible for cleanup.
 *
 * Encodes the retention rules from PRD §2.9:
 *
 * 1. **Non-terminal states** — not eligible. The workspace may still be needed.
 *    ESCALATED tasks are explicitly retained with a descriptive message even
 *    though they are technically non-terminal in the state machine.
 *
 * 2. **FAILED tasks with `retain_failed_workspaces: true`** — not eligible.
 *    The workspace is retained for developer debugging.
 *
 * 3. **Retention period not elapsed** — not eligible. The workspace must be
 *    retained for `workspace_retention_hours` after entering the terminal state.
 *
 * 4. **All checks pass** — eligible for cleanup.
 *
 * This function is **pure** and deterministic — it depends only on its inputs,
 * making it trivially testable.
 *
 * @param input - The task status, retention policy, and timing information.
 * @returns Eligibility decision with a human-readable reason.
 *
 * @example
 * ```ts
 * const result = isWorkspaceCleanupEligible({
 *   taskStatus: TaskStatus.DONE,
 *   retentionPolicy: DEFAULT_RETENTION_POLICY,
 *   terminalStateAt: new Date("2024-01-01T00:00:00Z"),
 *   now: new Date("2024-01-02T01:00:00Z"), // 25 hours later
 * });
 * // result.eligible === true
 * ```
 */
export function isWorkspaceCleanupEligible(
  input: WorkspaceCleanupInput,
): WorkspaceCleanupEligibility {
  const { taskStatus, retentionPolicy, terminalStateAt, now } = input;

  // Rule 1: ESCALATED tasks are always retained until operator resolution.
  // ESCALATED is not a terminal state but deserves a specific message because
  // it commonly appears in cleanup candidate lists.
  if (taskStatus === TaskStatus.ESCALATED) {
    return {
      eligible: false,
      reason: "Escalated workspaces are retained until operator resolution",
    };
  }

  // Rule 2: Non-terminal tasks are not eligible for cleanup.
  if (!isTerminalState(taskStatus)) {
    return {
      eligible: false,
      reason: `Task is in non-terminal state: ${taskStatus}`,
    };
  }

  // Rule 3: FAILED tasks with retain_failed_workspaces policy.
  if (taskStatus === TaskStatus.FAILED && retentionPolicy.retain_failed_workspaces) {
    return {
      eligible: false,
      reason: "Failed workspaces are retained per retention policy",
    };
  }

  // Rule 4: Check retention period.
  const retentionMs = retentionPolicy.workspace_retention_hours * MS_PER_HOUR;
  const elapsedMs = now.getTime() - terminalStateAt.getTime();

  if (elapsedMs < retentionMs) {
    const remainingHours = Math.ceil((retentionMs - elapsedMs) / MS_PER_HOUR);
    return {
      eligible: false,
      reason: `Retention period not elapsed (${String(remainingHours)}h remaining)`,
    };
  }

  // All checks passed — workspace is eligible for cleanup.
  return {
    eligible: true,
    reason: "Workspace eligible for cleanup: terminal state and retention period elapsed",
  };
}
