/**
 * Ports for the validation runner service.
 *
 * Defines the contract for executing individual validation checks. The
 * concrete implementation (T055) will run shell commands against a workspace;
 * the port abstraction lets the runner be tested with fakes.
 *
 * @module @factory/application/ports/validation-runner
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5 Validation Policy
 */

// ─── Check Execution Port ───────────────────────────────────────────────────

/**
 * Parameters for executing a single validation check.
 */
export interface ExecuteCheckParams {
  /** Human-readable check name (e.g., "test", "lint", "build"). */
  readonly checkName: string;

  /** Shell command to execute (e.g., "pnpm test"). */
  readonly command: string;

  /** Absolute path to the workspace where the command should run. */
  readonly workspacePath: string;
}

/**
 * Result of executing a single validation check.
 *
 * Produced by the {@link CheckExecutorPort} after running one command.
 */
export interface CheckExecutionResult {
  /** Name of the check that was executed. */
  readonly checkName: string;

  /** Command that was executed. */
  readonly command: string;

  /** Outcome of the check execution. */
  readonly status: "passed" | "failed" | "skipped" | "error";

  /** Wall-clock duration of the check in milliseconds. */
  readonly durationMs: number;

  /** Captured stdout/stderr output (may be truncated). */
  readonly output?: string;

  /** Error message if the check errored (distinct from a test failure). */
  readonly errorMessage?: string;
}

/**
 * Port for executing a single validation check command.
 *
 * Implementations run a shell command in a workspace directory and return
 * a structured result. The validation runner calls this port once per check
 * in sequential order.
 *
 * @see T055 for the concrete implementation that executes real commands.
 */
export interface CheckExecutorPort {
  /**
   * Execute a single validation check.
   *
   * @param params - Check name, command, and workspace path.
   * @returns The execution result with status, duration, and optional output.
   */
  executeCheck(params: ExecuteCheckParams): Promise<CheckExecutionResult>;
}

// ─── Validation Result Types ────────────────────────────────────────────────

/**
 * Result for a single check within a validation run, enriched with
 * the check's category (required vs optional).
 */
export interface ValidationCheckOutcome {
  /** Name of the check (e.g., "test", "lint"). */
  readonly checkName: string;

  /** Command that was executed. */
  readonly command: string;

  /** Whether this check is required or optional in the profile. */
  readonly category: "required" | "optional";

  /** Outcome of the check execution. */
  readonly status: "passed" | "failed" | "skipped" | "error";

  /** Wall-clock duration of the check in milliseconds. */
  readonly durationMs: number;

  /** Captured stdout/stderr output (may be truncated). */
  readonly output?: string;

  /** Error message if the check errored. */
  readonly errorMessage?: string;
}

/**
 * Aggregated result of running all checks in a validation profile.
 *
 * The {@link overallStatus} is "failed" if any required check failed,
 * errored, or was skipped when `fail_on_skipped_required_check` is true.
 * Optional check failures do not affect the overall status.
 */
export interface ValidationRunResult {
  /** Name of the validation profile that was executed. */
  readonly profileName: string;

  /** Aggregated pass/fail status. */
  readonly overallStatus: "passed" | "failed";

  /** Per-check outcomes in execution order. */
  readonly checkOutcomes: readonly ValidationCheckOutcome[];

  /** Human-readable summary of the validation run. */
  readonly summary: string;

  /** Total wall-clock duration of all checks in milliseconds. */
  readonly totalDurationMs: number;

  /** Count of required checks that passed. */
  readonly requiredPassedCount: number;

  /** Count of required checks that failed or errored. */
  readonly requiredFailedCount: number;

  /** Count of optional checks that passed. */
  readonly optionalPassedCount: number;

  /** Count of optional checks that failed or errored. */
  readonly optionalFailedCount: number;

  /** Count of checks that were skipped. */
  readonly skippedCount: number;
}
