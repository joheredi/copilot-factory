/**
 * Ports for the validation gate service.
 *
 * Defines the contract for querying validation run results so the
 * {@link ValidationGateService} can determine whether a gated state
 * transition should be allowed. The port abstracts the persistence layer
 * (database, in-memory store, etc.) from the gate-checking logic.
 *
 * @module @factory/application/ports/validation-gate
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5.2 Validation Gates
 * @see {@link file://docs/backlog/tasks/T057-validation-gates.md}
 */

// ─── Latest Validation Result ───────────────────────────────────────────────

/**
 * A summary of the most recent validation run for a given task and profile.
 *
 * This is the minimal data the gate service needs to make a pass/fail
 * decision. The full {@link ValidationResultPacket} is available via the
 * artifact store if richer diagnostics are needed.
 */
export interface LatestValidationResult {
  /** Unique identifier of the validation run. */
  readonly validationRunId: string;

  /** The profile name that was executed (e.g., "default-dev", "merge-gate"). */
  readonly profileName: string;

  /** Aggregate outcome: "passed" if all required checks succeeded, "failed" otherwise. */
  readonly overallStatus: "passed" | "failed";

  /** ISO-8601 timestamp of when the validation run completed. */
  readonly completedAt: string;
}

// ─── Query Port ─────────────────────────────────────────────────────────────

/**
 * Port for querying validation run results.
 *
 * Implementations must return the most recent validation result for a given
 * task and profile combination. "Most recent" means the highest `completedAt`
 * timestamp or the latest inserted row, depending on the storage backend.
 */
export interface ValidationResultQueryPort {
  /**
   * Find the latest validation run result for a task and profile.
   *
   * @param taskId - The task being validated.
   * @param profileName - The validation profile (e.g., "default-dev").
   * @returns The latest result, or `null` if no validation run exists.
   */
  findLatestByTaskAndProfile(taskId: string, profileName: string): LatestValidationResult | null;
}
