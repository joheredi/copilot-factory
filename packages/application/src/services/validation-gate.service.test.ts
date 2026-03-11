/**
 * Tests for the validation gate service.
 *
 * Verifies that gated state transitions are correctly blocked or allowed
 * based on the latest validation run results. These tests are critical
 * because the validation gate is a quality enforcement boundary — if it
 * fails silently, untested code could reach production.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5.2
 * @see {@link file://docs/backlog/tasks/T057-validation-gates.md}
 */

import { describe, it, expect } from "vitest";
import { TaskStatus } from "@factory/domain";
import { DEFAULT_DEV_PROFILE_NAME, MERGE_GATE_PROFILE_NAME } from "@factory/domain";

import type {
  ValidationResultQueryPort,
  LatestValidationResult,
} from "../ports/validation-gate.ports.js";
import {
  createValidationGateService,
  enforceValidationGate,
  GATED_TRANSITIONS,
} from "./validation-gate.service.js";
import type {
  ValidationGateService,
  GatePassedResult,
  GateFailedResult,
} from "./validation-gate.service.js";
import { ValidationGateError } from "../errors.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

/**
 * Create a fake ValidationResultQueryPort that returns predefined results.
 *
 * @param results - Map of `taskId:profileName` → result. Returns null for
 *   keys not in the map.
 */
function createFakeQueryPort(
  results: Record<string, LatestValidationResult | null> = {},
): ValidationResultQueryPort {
  return {
    findLatestByTaskAndProfile(taskId: string, profileName: string): LatestValidationResult | null {
      const key = `${taskId}:${profileName}`;
      return results[key] ?? null;
    },
  };
}

/**
 * Create a passing validation result for test fixtures.
 */
function passingResult(overrides: Partial<LatestValidationResult> = {}): LatestValidationResult {
  return {
    validationRunId: "vr-passing-001",
    profileName: DEFAULT_DEV_PROFILE_NAME,
    overallStatus: "passed",
    completedAt: "2026-03-11T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * Create a failing validation result for test fixtures.
 */
function failingResult(overrides: Partial<LatestValidationResult> = {}): LatestValidationResult {
  return {
    validationRunId: "vr-failing-001",
    profileName: DEFAULT_DEV_PROFILE_NAME,
    overallStatus: "failed",
    completedAt: "2026-03-11T10:00:00.000Z",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ValidationGateService", () => {
  // ── Gate Configuration ──────────────────────────────────────────────────

  describe("GATED_TRANSITIONS configuration", () => {
    /**
     * Validates that the canonical gate list includes exactly the two
     * transitions specified in PRD §9.5.2. If a new gated transition is
     * added later, this test must be updated intentionally.
     */
    it("should define exactly the expected gated transitions", () => {
      expect(GATED_TRANSITIONS).toHaveLength(2);

      const devCompleteGate = GATED_TRANSITIONS.find(
        (g) => g.fromStatus === TaskStatus.IN_DEVELOPMENT && g.toStatus === TaskStatus.DEV_COMPLETE,
      );
      expect(devCompleteGate).toBeDefined();
      expect(devCompleteGate!.requiredProfile).toBe(DEFAULT_DEV_PROFILE_NAME);

      const doneGate = GATED_TRANSITIONS.find(
        (g) => g.fromStatus === TaskStatus.POST_MERGE_VALIDATION && g.toStatus === TaskStatus.DONE,
      );
      expect(doneGate).toBeDefined();
      expect(doneGate!.requiredProfile).toBe(MERGE_GATE_PROFILE_NAME);
    });
  });

  // ── Non-Gated Transitions ─────────────────────────────────────────────

  describe("non-gated transitions", () => {
    let service: ValidationGateService;

    /**
     * Use empty query port — non-gated transitions should never
     * query for validation results.
     */
    const queryPort = createFakeQueryPort();

    /**
     * Non-gated transitions must return `{ gated: false }` immediately
     * without querying validation results. This ensures the gate service
     * does not accidentally block transitions it should not control.
     */
    it("should return gated: false for BACKLOG → READY", () => {
      service = createValidationGateService({ validationResultQuery: queryPort });
      const result = service.checkGate({
        taskId: "task-001",
        fromStatus: TaskStatus.BACKLOG,
        toStatus: TaskStatus.READY,
      });
      expect(result.gated).toBe(false);
    });

    /**
     * APPROVED → QUEUED_FOR_MERGE is explicitly documented as NOT requiring
     * re-validation (T057 out-of-scope). This test enforces that contract.
     */
    it("should return gated: false for APPROVED → QUEUED_FOR_MERGE", () => {
      service = createValidationGateService({ validationResultQuery: queryPort });
      const result = service.checkGate({
        taskId: "task-001",
        fromStatus: TaskStatus.APPROVED,
        toStatus: TaskStatus.QUEUED_FOR_MERGE,
      });
      expect(result.gated).toBe(false);
    });

    it("should return gated: false for READY → ASSIGNED", () => {
      service = createValidationGateService({ validationResultQuery: queryPort });
      const result = service.checkGate({
        taskId: "task-001",
        fromStatus: TaskStatus.READY,
        toStatus: TaskStatus.ASSIGNED,
      });
      expect(result.gated).toBe(false);
    });

    it("should return gated: false for IN_REVIEW → APPROVED", () => {
      service = createValidationGateService({ validationResultQuery: queryPort });
      const result = service.checkGate({
        taskId: "task-001",
        fromStatus: TaskStatus.IN_REVIEW,
        toStatus: TaskStatus.APPROVED,
      });
      expect(result.gated).toBe(false);
    });

    it("should return gated: false for MERGING → POST_MERGE_VALIDATION", () => {
      service = createValidationGateService({ validationResultQuery: queryPort });
      const result = service.checkGate({
        taskId: "task-001",
        fromStatus: TaskStatus.MERGING,
        toStatus: TaskStatus.POST_MERGE_VALIDATION,
      });
      expect(result.gated).toBe(false);
    });
  });

  // ── IN_DEVELOPMENT → DEV_COMPLETE Gate ────────────────────────────────

  describe("IN_DEVELOPMENT → DEV_COMPLETE gate (default-dev profile)", () => {
    const taskId = "task-dev-001";
    const fromStatus = TaskStatus.IN_DEVELOPMENT;
    const toStatus = TaskStatus.DEV_COMPLETE;

    /**
     * When the latest default-dev validation run passed, the gate must
     * allow the transition and return the run details so callers can
     * record which validation run satisfied the gate.
     */
    it("should pass when latest default-dev validation run has passed", () => {
      const result = passingResult({ profileName: DEFAULT_DEV_PROFILE_NAME });
      const queryPort = createFakeQueryPort({
        [`${taskId}:${DEFAULT_DEV_PROFILE_NAME}`]: result,
      });
      const service = createValidationGateService({ validationResultQuery: queryPort });

      const gateResult = service.checkGate({ taskId, fromStatus, toStatus });

      expect(gateResult.gated).toBe(true);
      expect((gateResult as GatePassedResult).passed).toBe(true);
      expect((gateResult as GatePassedResult).profileName).toBe(DEFAULT_DEV_PROFILE_NAME);
      expect((gateResult as GatePassedResult).validationRunId).toBe(result.validationRunId);
      expect((gateResult as GatePassedResult).completedAt).toBe(result.completedAt);
    });

    /**
     * When the latest validation run failed, the gate must block the
     * transition and include the failing run's details for diagnostics.
     * This prevents untested or broken code from advancing to review.
     */
    it("should fail when latest default-dev validation run has failed", () => {
      const result = failingResult({ profileName: DEFAULT_DEV_PROFILE_NAME });
      const queryPort = createFakeQueryPort({
        [`${taskId}:${DEFAULT_DEV_PROFILE_NAME}`]: result,
      });
      const service = createValidationGateService({ validationResultQuery: queryPort });

      const gateResult = service.checkGate({ taskId, fromStatus, toStatus });

      expect(gateResult.gated).toBe(true);
      expect((gateResult as GateFailedResult).passed).toBe(false);
      expect((gateResult as GateFailedResult).profileName).toBe(DEFAULT_DEV_PROFILE_NAME);
      expect((gateResult as GateFailedResult).reason).toContain("failed");
      expect((gateResult as GateFailedResult).reason).toContain(DEFAULT_DEV_PROFILE_NAME);
      expect((gateResult as GateFailedResult).latestResult).toBe(result);
    });

    /**
     * When no validation run exists at all, the gate must fail. This
     * catches the case where a worker emits a DevResultPacket but the
     * validation runner was never invoked (or crashed before completing).
     */
    it("should fail when no validation run exists for the task", () => {
      const queryPort = createFakeQueryPort(); // empty — returns null
      const service = createValidationGateService({ validationResultQuery: queryPort });

      const gateResult = service.checkGate({ taskId, fromStatus, toStatus });

      expect(gateResult.gated).toBe(true);
      expect((gateResult as GateFailedResult).passed).toBe(false);
      expect((gateResult as GateFailedResult).profileName).toBe(DEFAULT_DEV_PROFILE_NAME);
      expect((gateResult as GateFailedResult).reason).toContain("No validation run found");
      expect((gateResult as GateFailedResult).latestResult).toBeNull();
    });

    /**
     * The gate should only look at results for the correct profile.
     * A passing merge-gate run should NOT satisfy the default-dev gate.
     */
    it("should not be satisfied by a different profile's passing result", () => {
      const queryPort = createFakeQueryPort({
        // merge-gate passes but default-dev has no result
        [`${taskId}:${MERGE_GATE_PROFILE_NAME}`]: passingResult({
          profileName: MERGE_GATE_PROFILE_NAME,
        }),
      });
      const service = createValidationGateService({ validationResultQuery: queryPort });

      const gateResult = service.checkGate({ taskId, fromStatus, toStatus });

      expect(gateResult.gated).toBe(true);
      expect((gateResult as GateFailedResult).passed).toBe(false);
    });
  });

  // ── POST_MERGE_VALIDATION → DONE Gate ─────────────────────────────────

  describe("POST_MERGE_VALIDATION → DONE gate (merge-gate profile)", () => {
    const taskId = "task-merge-001";
    const fromStatus = TaskStatus.POST_MERGE_VALIDATION;
    const toStatus = TaskStatus.DONE;

    /**
     * When the latest merge-gate validation run passed, the gate must
     * allow the POST_MERGE_VALIDATION → DONE transition. This is the
     * final quality gate before a task is marked complete.
     */
    it("should pass when latest merge-gate validation run has passed", () => {
      const result = passingResult({
        validationRunId: "vr-merge-pass-001",
        profileName: MERGE_GATE_PROFILE_NAME,
      });
      const queryPort = createFakeQueryPort({
        [`${taskId}:${MERGE_GATE_PROFILE_NAME}`]: result,
      });
      const service = createValidationGateService({ validationResultQuery: queryPort });

      const gateResult = service.checkGate({ taskId, fromStatus, toStatus });

      expect(gateResult.gated).toBe(true);
      expect((gateResult as GatePassedResult).passed).toBe(true);
      expect((gateResult as GatePassedResult).profileName).toBe(MERGE_GATE_PROFILE_NAME);
      expect((gateResult as GatePassedResult).validationRunId).toBe("vr-merge-pass-001");
    });

    /**
     * When the latest merge-gate validation run failed, the task must
     * not reach DONE. Failed post-merge validation typically indicates
     * the merged code broke something on the target branch.
     */
    it("should fail when latest merge-gate validation run has failed", () => {
      const result = failingResult({
        validationRunId: "vr-merge-fail-001",
        profileName: MERGE_GATE_PROFILE_NAME,
      });
      const queryPort = createFakeQueryPort({
        [`${taskId}:${MERGE_GATE_PROFILE_NAME}`]: result,
      });
      const service = createValidationGateService({ validationResultQuery: queryPort });

      const gateResult = service.checkGate({ taskId, fromStatus, toStatus });

      expect(gateResult.gated).toBe(true);
      expect((gateResult as GateFailedResult).passed).toBe(false);
      expect((gateResult as GateFailedResult).profileName).toBe(MERGE_GATE_PROFILE_NAME);
      expect((gateResult as GateFailedResult).reason).toContain("failed");
      expect((gateResult as GateFailedResult).latestResult).toBe(result);
    });

    /**
     * When no merge-gate validation run exists, the gate blocks. This
     * catches cases where the post-merge validation step was never triggered.
     */
    it("should fail when no merge-gate validation run exists", () => {
      const queryPort = createFakeQueryPort();
      const service = createValidationGateService({ validationResultQuery: queryPort });

      const gateResult = service.checkGate({ taskId, fromStatus, toStatus });

      expect(gateResult.gated).toBe(true);
      expect((gateResult as GateFailedResult).passed).toBe(false);
      expect((gateResult as GateFailedResult).reason).toContain("No validation run found");
      expect((gateResult as GateFailedResult).latestResult).toBeNull();
    });

    /**
     * A passing default-dev run must not satisfy the merge-gate
     * requirement. Each gate requires its specific profile.
     */
    it("should not be satisfied by a default-dev profile's passing result", () => {
      const queryPort = createFakeQueryPort({
        [`${taskId}:${DEFAULT_DEV_PROFILE_NAME}`]: passingResult({
          profileName: DEFAULT_DEV_PROFILE_NAME,
        }),
      });
      const service = createValidationGateService({ validationResultQuery: queryPort });

      const gateResult = service.checkGate({ taskId, fromStatus, toStatus });

      expect(gateResult.gated).toBe(true);
      expect((gateResult as GateFailedResult).passed).toBe(false);
    });
  });

  // ── Different Tasks Are Isolated ──────────────────────────────────────

  describe("task isolation", () => {
    /**
     * Validation results for one task must not leak to another task.
     * This verifies the query port is called with the correct taskId.
     */
    it("should not use another task's validation results", () => {
      const queryPort = createFakeQueryPort({
        // task-A has a passing result, task-B does not
        [`task-A:${DEFAULT_DEV_PROFILE_NAME}`]: passingResult(),
      });
      const service = createValidationGateService({ validationResultQuery: queryPort });

      const resultA = service.checkGate({
        taskId: "task-A",
        fromStatus: TaskStatus.IN_DEVELOPMENT,
        toStatus: TaskStatus.DEV_COMPLETE,
      });
      expect(resultA.gated).toBe(true);
      expect((resultA as GatePassedResult).passed).toBe(true);

      const resultB = service.checkGate({
        taskId: "task-B",
        fromStatus: TaskStatus.IN_DEVELOPMENT,
        toStatus: TaskStatus.DEV_COMPLETE,
      });
      expect(resultB.gated).toBe(true);
      expect((resultB as GateFailedResult).passed).toBe(false);
    });
  });

  // ── enforceValidationGate Convenience Function ────────────────────────

  describe("enforceValidationGate", () => {
    /**
     * For non-gated transitions, enforceValidationGate should return
     * the result without throwing. Callers can safely call it on any
     * transition without worrying about false exceptions.
     */
    it("should return result for non-gated transitions", () => {
      const queryPort = createFakeQueryPort();
      const service = createValidationGateService({ validationResultQuery: queryPort });

      const result = enforceValidationGate(service, {
        taskId: "task-001",
        fromStatus: TaskStatus.BACKLOG,
        toStatus: TaskStatus.READY,
      });

      expect(result.gated).toBe(false);
    });

    /**
     * For gated transitions with passing validation, enforceValidationGate
     * should return the passed result.
     */
    it("should return result for passing gated transitions", () => {
      const queryPort = createFakeQueryPort({
        [`task-001:${DEFAULT_DEV_PROFILE_NAME}`]: passingResult(),
      });
      const service = createValidationGateService({ validationResultQuery: queryPort });

      const result = enforceValidationGate(service, {
        taskId: "task-001",
        fromStatus: TaskStatus.IN_DEVELOPMENT,
        toStatus: TaskStatus.DEV_COMPLETE,
      });

      expect(result.gated).toBe(true);
      expect((result as GatePassedResult).passed).toBe(true);
    });

    /**
     * For gated transitions that fail, enforceValidationGate must throw
     * a ValidationGateError with all diagnostic fields populated. This
     * enables callers to catch the error and emit a validation_result_packet.
     */
    it("should throw ValidationGateError for failing gated transitions", () => {
      const queryPort = createFakeQueryPort(); // no results
      const service = createValidationGateService({ validationResultQuery: queryPort });

      expect(() =>
        enforceValidationGate(service, {
          taskId: "task-001",
          fromStatus: TaskStatus.IN_DEVELOPMENT,
          toStatus: TaskStatus.DEV_COMPLETE,
        }),
      ).toThrow(ValidationGateError);
    });

    /**
     * Verify the thrown error has the correct diagnostic properties so
     * downstream error handlers can produce useful messages.
     */
    it("should include task and transition details in the thrown error", () => {
      const queryPort = createFakeQueryPort();
      const service = createValidationGateService({ validationResultQuery: queryPort });

      try {
        enforceValidationGate(service, {
          taskId: "task-err-001",
          fromStatus: TaskStatus.IN_DEVELOPMENT,
          toStatus: TaskStatus.DEV_COMPLETE,
        });
        expect.fail("Expected ValidationGateError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationGateError);
        const gateError = error as ValidationGateError;
        expect(gateError.taskId).toBe("task-err-001");
        expect(gateError.fromStatus).toBe(TaskStatus.IN_DEVELOPMENT);
        expect(gateError.toStatus).toBe(TaskStatus.DEV_COMPLETE);
        expect(gateError.requiredProfile).toBe(DEFAULT_DEV_PROFILE_NAME);
        expect(gateError.reason).toContain("No validation run found");
      }
    });

    /**
     * Verify the error message is human-readable and contains the
     * transition details for log/audit consumption.
     */
    it("should produce a human-readable error message", () => {
      const queryPort = createFakeQueryPort({
        [`task-msg-001:${MERGE_GATE_PROFILE_NAME}`]: failingResult({
          profileName: MERGE_GATE_PROFILE_NAME,
        }),
      });
      const service = createValidationGateService({ validationResultQuery: queryPort });

      try {
        enforceValidationGate(service, {
          taskId: "task-msg-001",
          fromStatus: TaskStatus.POST_MERGE_VALIDATION,
          toStatus: TaskStatus.DONE,
        });
        expect.fail("Expected ValidationGateError to be thrown");
      } catch (error) {
        const gateError = error as ValidationGateError;
        expect(gateError.message).toContain("POST_MERGE_VALIDATION");
        expect(gateError.message).toContain("DONE");
        expect(gateError.message).toContain("task-msg-001");
      }
    });
  });
});
