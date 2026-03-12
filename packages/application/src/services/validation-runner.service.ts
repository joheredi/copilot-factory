/**
 * Validation runner service — orchestrates profile-based validation checks.
 *
 * This service is the single entry point for running validation checks against
 * a workspace. It loads the appropriate validation profile from a policy
 * snapshot, executes each check sequentially via a {@link CheckExecutorPort},
 * and aggregates results into a {@link ValidationRunResult}.
 *
 * **Execution order:** required checks first (in profile order), then optional
 * checks. All checks run regardless of earlier failures so that the operator
 * gets a complete picture.
 *
 * **Overall status rules (PRD §9.5.2):**
 * - If any required check has status `"failed"` or `"error"` → overall `"failed"`.
 * - If `fail_on_skipped_required_check` is true and any required check is
 *   `"skipped"` → overall `"failed"`.
 * - Optional check failures never affect overall status.
 * - Otherwise → overall `"passed"`.
 *
 * @module @factory/application/services/validation-runner
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5 Validation Policy
 * @see {@link file://docs/backlog/tasks/T054-validation-runner-abstraction.md}
 */

import type { ValidationPolicy } from "@factory/domain";
import { MissingValidationProfileError, ProfileSelectionSource } from "@factory/domain";

import {
  getTracer,
  SpanStatusCode,
  SpanNames,
  SpanAttributes,
  getStarterMetrics,
} from "@factory/observability";

import type {
  CheckExecutorPort,
  ValidationCheckOutcome,
  ValidationRunResult,
} from "../ports/validation-runner.ports.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Check statuses that indicate a check did not pass successfully.
 * Used when determining whether required checks caused overall failure.
 */
const FAILING_STATUSES = new Set<string>(["failed", "error"]);

// ─── Service Interface ──────────────────────────────────────────────────────

/**
 * Parameters for running validation against a workspace.
 */
export interface RunValidationParams {
  /** Identifier of the task being validated. Used for error context. */
  readonly taskId: string;

  /** Name of the validation profile to execute (e.g., "default-dev", "merge-gate"). */
  readonly profileName: string;

  /**
   * The resolved validation policy containing profile definitions.
   * Typically extracted from the effective {@link PolicySnapshot}.
   */
  readonly validationPolicy: ValidationPolicy;

  /** Absolute path to the workspace where checks should be executed. */
  readonly workspacePath: string;
}

/**
 * Service interface for orchestrating validation check execution.
 *
 * @example
 * ```typescript
 * const runner = createValidationRunnerService(checkExecutor);
 * const result = await runner.runValidation({
 *   taskId: "task-123",
 *   profileName: "default-dev",
 *   validationPolicy: snapshot.validation_policy,
 *   workspacePath: "/workspaces/task-123",
 * });
 *
 * if (result.overallStatus === "failed") {
 *   // Handle validation failure
 * }
 * ```
 */
export interface ValidationRunnerService {
  /**
   * Run all validation checks defined in the named profile.
   *
   * @param params - Validation parameters including task ID, profile name,
   *   policy, and workspace path.
   * @returns Aggregated validation result with per-check outcomes.
   * @throws {MissingValidationProfileError} If the profile name does not
   *   exist in the validation policy.
   */
  runValidation(params: RunValidationParams): Promise<ValidationRunResult>;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a new validation runner service.
 *
 * @param checkExecutor - Port for executing individual check commands.
 *   The runner calls this once per check in sequential order.
 * @returns A {@link ValidationRunnerService} instance.
 */
/** @internal OpenTelemetry tracer for validation spans. */
const validationTracer = getTracer("validation-runner");

export function createValidationRunnerService(
  checkExecutor: CheckExecutorPort,
): ValidationRunnerService {
  return {
    runValidation: async (params: RunValidationParams): Promise<ValidationRunResult> => {
      return validationTracer.startActiveSpan(SpanNames.VALIDATION_RUN, async (span) => {
        try {
          const { taskId, profileName, validationPolicy, workspacePath } = params;
          span.setAttribute(SpanAttributes.TASK_ID, taskId);
          span.setAttribute(SpanAttributes.VALIDATION_PROFILE, profileName);

          // ── 1. Load profile from policy ────────────────────────────────────

          const profile = validationPolicy.profiles[profileName];
          if (!profile) {
            throw new MissingValidationProfileError(
              profileName,
              ProfileSelectionSource.TASK_OVERRIDE,
              Object.keys(validationPolicy.profiles),
            );
          }

          // ── 2. Build check execution plan ──────────────────────────────────

          const requiredChecks = resolveChecks(
            profile.required_checks,
            profile.commands,
            "required",
          );
          const optionalChecks = resolveChecks(
            profile.optional_checks,
            profile.commands,
            "optional",
          );

          // ── 3. Execute checks sequentially ─────────────────────────────────

          const checkOutcomes: ValidationCheckOutcome[] = [];
          const startTime = Date.now();

          for (const check of [...requiredChecks, ...optionalChecks]) {
            if (check.command === undefined) {
              // Check has no command mapping — mark as skipped
              checkOutcomes.push({
                checkName: check.checkName,
                command: "",
                category: check.category,
                status: "skipped",
                durationMs: 0,
                errorMessage: `No command mapping found for check "${check.checkName}" in profile "${profileName}"`,
              });
              continue;
            }

            const executionResult = await checkExecutor.executeCheck({
              checkName: check.checkName,
              command: check.command,
              workspacePath,
            });

            checkOutcomes.push({
              checkName: executionResult.checkName,
              command: executionResult.command,
              category: check.category,
              status: executionResult.status,
              durationMs: executionResult.durationMs,
              output: executionResult.output,
              errorMessage: executionResult.errorMessage,
            });
          }

          const totalDurationMs = Date.now() - startTime;

          // ── 4. Aggregate results ───────────────────────────────────────────

          const requiredOutcomes = checkOutcomes.filter((c) => c.category === "required");
          const optionalOutcomes = checkOutcomes.filter((c) => c.category === "optional");

          const requiredPassedCount = requiredOutcomes.filter((c) => c.status === "passed").length;
          const requiredFailedCount = requiredOutcomes.filter((c) =>
            FAILING_STATUSES.has(c.status),
          ).length;
          const optionalPassedCount = optionalOutcomes.filter((c) => c.status === "passed").length;
          const optionalFailedCount = optionalOutcomes.filter((c) =>
            FAILING_STATUSES.has(c.status),
          ).length;
          const skippedCount = checkOutcomes.filter((c) => c.status === "skipped").length;

          const skippedRequiredCount = requiredOutcomes.filter(
            (c) => c.status === "skipped",
          ).length;

          // ── 5. Determine overall status ────────────────────────────────────

          const overallStatus = computeOverallStatus(
            requiredFailedCount,
            skippedRequiredCount,
            profile.fail_on_skipped_required_check,
          );

          // ── 6. Build summary ───────────────────────────────────────────────

          const summary = buildSummary({
            profileName,
            taskId,
            overallStatus,
            requiredPassedCount,
            requiredFailedCount,
            skippedRequiredCount,
            optionalPassedCount,
            optionalFailedCount,
            skippedCount,
          });

          span.setAttribute(SpanAttributes.RESULT_STATUS, overallStatus);
          span.setStatus({ code: SpanStatusCode.OK });

          // ── Metrics instrumentation (§10.13.3) ──────────────────────────
          const starterMetrics = getStarterMetrics();
          starterMetrics.validationRuns.inc({
            validation_profile: profileName,
            result: overallStatus,
          });
          starterMetrics.validationDuration.observe(
            { validation_profile: profileName },
            totalDurationMs / 1000,
          );

          return {
            profileName,
            overallStatus,
            checkOutcomes,
            summary,
            totalDurationMs,
            requiredPassedCount,
            requiredFailedCount,
            optionalPassedCount,
            optionalFailedCount,
            skippedCount,
          };
        } catch (error: unknown) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      });
    },
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Planned check to execute — includes the resolved command from the profile's
 * command map (or undefined if no mapping exists).
 */
interface PlannedCheck {
  readonly checkName: string;
  readonly command: string | undefined;
  readonly category: "required" | "optional";
}

/**
 * Resolve check names to planned checks by looking up commands in the
 * profile's command map.
 *
 * @param checkNames - Ordered list of check names from the profile.
 * @param commands - Map of check name → shell command.
 * @param category - Whether these are required or optional checks.
 * @returns Array of planned checks with resolved commands.
 */
function resolveChecks(
  checkNames: readonly string[],
  commands: Readonly<Record<string, string>>,
  category: "required" | "optional",
): PlannedCheck[] {
  return checkNames.map((checkName) => ({
    checkName,
    command: commands[checkName],
    category,
  }));
}

/**
 * Determine the overall validation status based on required check outcomes.
 *
 * Rules (PRD §9.5.2):
 * - Any required check failed or errored → "failed"
 * - Any required check skipped AND fail_on_skipped_required_check → "failed"
 * - Otherwise → "passed"
 *
 * @param requiredFailedCount - Number of required checks that failed or errored.
 * @param skippedRequiredCount - Number of required checks that were skipped.
 * @param failOnSkippedRequired - Whether skipped required checks cause failure.
 * @returns The overall validation status.
 */
function computeOverallStatus(
  requiredFailedCount: number,
  skippedRequiredCount: number,
  failOnSkippedRequired: boolean,
): "passed" | "failed" {
  if (requiredFailedCount > 0) {
    return "failed";
  }
  if (failOnSkippedRequired && skippedRequiredCount > 0) {
    return "failed";
  }
  return "passed";
}

/** Parameters for building a human-readable summary. */
interface SummaryParams {
  readonly profileName: string;
  readonly taskId: string;
  readonly overallStatus: "passed" | "failed";
  readonly requiredPassedCount: number;
  readonly requiredFailedCount: number;
  readonly skippedRequiredCount: number;
  readonly optionalPassedCount: number;
  readonly optionalFailedCount: number;
  readonly skippedCount: number;
}

/**
 * Build a human-readable summary of the validation run.
 *
 * @param p - Aggregated counts and metadata.
 * @returns A concise summary string.
 */
function buildSummary(p: SummaryParams): string {
  const statusLabel = p.overallStatus === "passed" ? "PASSED" : "FAILED";
  const requiredTotal = p.requiredPassedCount + p.requiredFailedCount + p.skippedRequiredCount;
  const parts: string[] = [
    `Validation ${statusLabel} for task ${p.taskId} using profile "${p.profileName}".`,
    `Required: ${p.requiredPassedCount}/${requiredTotal} passed.`,
  ];

  const optionalTotal = p.optionalPassedCount + p.optionalFailedCount;
  if (optionalTotal > 0) {
    parts.push(`Optional: ${p.optionalPassedCount}/${optionalTotal} passed.`);
  }

  if (p.skippedCount > 0) {
    parts.push(`${p.skippedCount} check(s) skipped.`);
  }

  return parts.join(" ");
}
