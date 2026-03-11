/**
 * Validation gate service — enforces validation quality gates on state transitions.
 *
 * Certain task state transitions are "gated" — they must not proceed unless
 * the latest validation run for the appropriate profile has passed. This
 * service encapsulates the mapping from transitions to required profiles and
 * the logic for querying and evaluating validation results.
 *
 * ## Gated transitions (PRD §9.5.2, §2.1)
 *
 * | From                     | To            | Required Profile |
 * | ------------------------ | ------------- | ---------------- |
 * | IN_DEVELOPMENT           | DEV_COMPLETE  | default-dev      |
 * | POST_MERGE_VALIDATION    | DONE          | merge-gate       |
 *
 * ## Explicitly non-gated transitions
 *
 * | From      | To               | Reason                              |
 * | --------- | ---------------- | ----------------------------------- |
 * | APPROVED  | QUEUED_FOR_MERGE | Uses existing review-phase results  |
 *
 * Callers invoke {@link ValidationGateService.checkGate} before calling the
 * transition service. If the gate reports `passed: true`, the caller can
 * set `requiredValidationsPassed` or `postMergeValidationPassed` to `true`
 * in the transition context. If not, the caller should reject the transition
 * and optionally emit a validation result packet via the packet emitter.
 *
 * @module @factory/application/services/validation-gate
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5.2
 * @see {@link file://docs/prd/002-data-model.md} §2.1 Task State Machine
 * @see {@link file://docs/backlog/tasks/T057-validation-gates.md}
 */

import { TaskStatus } from "@factory/domain";
import { DEFAULT_DEV_PROFILE_NAME, MERGE_GATE_PROFILE_NAME } from "@factory/domain";

import type {
  ValidationResultQueryPort,
  LatestValidationResult,
} from "../ports/validation-gate.ports.js";
import { ValidationGateError } from "../errors.js";

// ─── Gate Configuration ─────────────────────────────────────────────────────

/**
 * Configuration for a single validation gate.
 *
 * Maps a (fromStatus, toStatus) pair to the required validation profile.
 */
export interface GateConfig {
  /** Task status the transition starts from. */
  readonly fromStatus: TaskStatus;
  /** Task status the transition targets. */
  readonly toStatus: TaskStatus;
  /** The validation profile that must have passed. */
  readonly requiredProfile: string;
}

/**
 * The canonical list of gated transitions.
 *
 * This is the single source of truth for which transitions require
 * validation gates and which profile each gate demands.
 */
export const GATED_TRANSITIONS: readonly GateConfig[] = [
  {
    fromStatus: TaskStatus.IN_DEVELOPMENT,
    toStatus: TaskStatus.DEV_COMPLETE,
    requiredProfile: DEFAULT_DEV_PROFILE_NAME,
  },
  {
    fromStatus: TaskStatus.POST_MERGE_VALIDATION,
    toStatus: TaskStatus.DONE,
    requiredProfile: MERGE_GATE_PROFILE_NAME,
  },
] as const;

// ─── Service Parameters and Results ─────────────────────────────────────────

/**
 * Parameters for checking a validation gate.
 */
export interface CheckGateParams {
  /** The task whose transition is being validated. */
  readonly taskId: string;
  /** The current status of the task. */
  readonly fromStatus: TaskStatus;
  /** The desired target status. */
  readonly toStatus: TaskStatus;
}

/**
 * Result when the transition is not gated — no validation check is needed.
 */
export interface GateNotApplicableResult {
  readonly gated: false;
}

/**
 * Result when the gate check passed — the transition may proceed.
 */
export interface GatePassedResult {
  readonly gated: true;
  readonly passed: true;
  /** The profile that was checked. */
  readonly profileName: string;
  /** The validation run that satisfied the gate. */
  readonly validationRunId: string;
  /** When the passing validation run completed. */
  readonly completedAt: string;
}

/**
 * Result when the gate check failed — the transition must be blocked.
 */
export interface GateFailedResult {
  readonly gated: true;
  readonly passed: false;
  /** The profile that was required but not satisfied. */
  readonly profileName: string;
  /** Human-readable reason for the failure. */
  readonly reason: string;
  /** The latest validation result, if one exists (null if no run found). */
  readonly latestResult: LatestValidationResult | null;
}

/**
 * Discriminated union of all possible gate check outcomes.
 */
export type ValidationGateResult = GateNotApplicableResult | GatePassedResult | GateFailedResult;

// ─── Service Interface ──────────────────────────────────────────────────────

/**
 * The validation gate service interface.
 *
 * Provides a single method to check whether a proposed task state transition
 * is allowed by the validation quality gates.
 */
export interface ValidationGateService {
  /**
   * Check whether a proposed transition is blocked by a validation gate.
   *
   * For non-gated transitions, returns `{ gated: false }`.
   * For gated transitions, queries the latest validation result and returns
   * a pass/fail decision.
   *
   * @param params - The transition to check.
   * @returns The gate check result.
   */
  checkGate(params: CheckGateParams): ValidationGateResult;
}

// ─── Dependencies ───────────────────────────────────────────────────────────

/**
 * Dependencies injected into the validation gate service factory.
 */
export interface ValidationGateServiceDependencies {
  /** Port for querying latest validation run results. */
  readonly validationResultQuery: ValidationResultQueryPort;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a new ValidationGateService instance.
 *
 * The service uses the injected {@link ValidationResultQueryPort} to look up
 * the latest validation results and evaluate gate conditions.
 *
 * @param deps - Injected dependencies.
 * @returns A configured ValidationGateService.
 */
export function createValidationGateService(
  deps: ValidationGateServiceDependencies,
): ValidationGateService {
  return {
    checkGate(params: CheckGateParams): ValidationGateResult {
      const { taskId, fromStatus, toStatus } = params;

      // Find the gate configuration for this transition
      const gate = findGateConfig(fromStatus, toStatus);
      if (!gate) {
        return { gated: false };
      }

      // Query latest validation result for the required profile
      const latestResult = deps.validationResultQuery.findLatestByTaskAndProfile(
        taskId,
        gate.requiredProfile,
      );

      // No validation run exists — gate fails
      if (latestResult === null) {
        return {
          gated: true,
          passed: false,
          profileName: gate.requiredProfile,
          reason:
            `No validation run found for task "${taskId}" with profile "${gate.requiredProfile}". ` +
            `A passing validation run is required before ${fromStatus} → ${toStatus}.`,
          latestResult: null,
        };
      }

      // Latest validation run failed — gate fails
      if (latestResult.overallStatus !== "passed") {
        return {
          gated: true,
          passed: false,
          profileName: gate.requiredProfile,
          reason:
            `Latest validation run "${latestResult.validationRunId}" for profile "${gate.requiredProfile}" ` +
            `has status "${latestResult.overallStatus}". A passing result is required before ${fromStatus} → ${toStatus}.`,
          latestResult,
        };
      }

      // Validation passed — gate allows transition
      return {
        gated: true,
        passed: true,
        profileName: gate.requiredProfile,
        validationRunId: latestResult.validationRunId,
        completedAt: latestResult.completedAt,
      };
    },
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Look up the gate configuration for a given (from, to) transition pair.
 *
 * @returns The gate config if the transition is gated, or `undefined` if not.
 */
function findGateConfig(fromStatus: TaskStatus, toStatus: TaskStatus): GateConfig | undefined {
  return GATED_TRANSITIONS.find((g) => g.fromStatus === fromStatus && g.toStatus === toStatus);
}

// ─── Convenience: Enforce Gate ──────────────────────────────────────────────

/**
 * Enforce a validation gate, throwing {@link ValidationGateError} if the
 * gate check fails.
 *
 * This is a convenience function for callers who want exception-based
 * control flow rather than inspecting the result discriminated union.
 * Non-gated transitions pass through without throwing.
 *
 * @param service - The validation gate service to use.
 * @param params - The transition to check.
 * @returns The gate result (always `gated: false` or `gated: true, passed: true`).
 * @throws {ValidationGateError} If the gate check fails.
 */
export function enforceValidationGate(
  service: ValidationGateService,
  params: CheckGateParams,
): GateNotApplicableResult | GatePassedResult {
  const result = service.checkGate(params);
  if (result.gated && !result.passed) {
    throw new ValidationGateError(
      params.taskId,
      params.fromStatus,
      params.toStatus,
      result.profileName,
      result.reason,
    );
  }
  return result as GateNotApplicableResult | GatePassedResult;
}
