/**
 * Tests for the validation runner service.
 *
 * These tests verify the core orchestration logic of the validation runner:
 * profile loading, sequential check execution, result aggregation, and
 * overall status computation.
 *
 * **Why these tests matter:**
 * The validation runner is the single gateway that determines whether a task
 * passes or fails validation. Incorrect aggregation (e.g., treating optional
 * failures as blockers, or ignoring skipped required checks) would break the
 * entire quality pipeline. These tests ensure the runner correctly implements
 * PRD §9.5 validation policy semantics.
 *
 * @module @factory/application/services/validation-runner.test
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5
 */

import { describe, it, expect } from "vitest";

import { MissingValidationProfileError } from "@factory/domain";

import type {
  CheckExecutorPort,
  CheckExecutionResult,
  ExecuteCheckParams,
} from "../ports/validation-runner.ports.js";

import { createValidationRunnerService } from "./validation-runner.service.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

/** Minimal validation policy with a single "default-dev" profile. */
const DEFAULT_DEV_POLICY = {
  profiles: {
    "default-dev": {
      required_checks: ["test", "lint"],
      optional_checks: ["build"],
      commands: {
        test: "pnpm test",
        lint: "pnpm lint",
        build: "pnpm build",
      },
      fail_on_skipped_required_check: true,
    },
  },
} as const;

/** Policy with multiple profiles for testing profile selection. */
const MULTI_PROFILE_POLICY = {
  profiles: {
    "default-dev": {
      required_checks: ["test", "lint"],
      optional_checks: ["build"],
      commands: {
        test: "pnpm test",
        lint: "pnpm lint",
        build: "pnpm build",
      },
      fail_on_skipped_required_check: true,
    },
    "merge-gate": {
      required_checks: ["test", "build"],
      optional_checks: ["lint"],
      commands: {
        test: "pnpm test",
        build: "pnpm build",
        lint: "pnpm lint",
      },
      fail_on_skipped_required_check: true,
    },
    lenient: {
      required_checks: ["test"],
      optional_checks: ["lint", "build"],
      commands: {
        test: "pnpm test",
        lint: "pnpm lint",
        build: "pnpm build",
      },
      fail_on_skipped_required_check: false,
    },
  },
} as const;

/** Policy with a profile that has a check without a command mapping. */
const MISSING_COMMAND_POLICY = {
  profiles: {
    incomplete: {
      required_checks: ["test", "security-scan"],
      optional_checks: ["lint"],
      commands: {
        test: "pnpm test",
        lint: "pnpm lint",
        // "security-scan" intentionally has no command mapping
      },
      fail_on_skipped_required_check: true,
    },
  },
} as const;

/** Policy with a profile where fail_on_skipped_required_check is false. */
const SKIP_TOLERANT_POLICY = {
  profiles: {
    tolerant: {
      required_checks: ["test", "security-scan"],
      optional_checks: [],
      commands: {
        test: "pnpm test",
        // "security-scan" intentionally missing
      },
      fail_on_skipped_required_check: false,
    },
  },
} as const;

const TASK_ID = "task-test-001";
const WORKSPACE_PATH = "/workspaces/task-test-001";

// ─── Fake Check Executor ────────────────────────────────────────────────────

/**
 * Create a fake check executor that returns predetermined results for
 * each check name. Allows testing the runner's aggregation logic without
 * real command execution.
 */
function createFakeCheckExecutor(
  resultMap: Record<string, Omit<CheckExecutionResult, "checkName" | "command">>,
): CheckExecutorPort & { calls: ExecuteCheckParams[] } {
  const calls: ExecuteCheckParams[] = [];

  return {
    calls,
    executeCheck: async (params: ExecuteCheckParams): Promise<CheckExecutionResult> => {
      calls.push(params);
      const result = resultMap[params.checkName];
      if (!result) {
        return {
          checkName: params.checkName,
          command: params.command,
          status: "error",
          durationMs: 0,
          errorMessage: `No fake result configured for check "${params.checkName}"`,
        };
      }
      return {
        checkName: params.checkName,
        command: params.command,
        ...result,
      };
    },
  };
}

/** Helper to create a passing result. */
function passingResult(durationMs = 100): Omit<CheckExecutionResult, "checkName" | "command"> {
  return { status: "passed", durationMs };
}

/** Helper to create a failing result. */
function failingResult(durationMs = 200): Omit<CheckExecutionResult, "checkName" | "command"> {
  return { status: "failed", durationMs, output: "Some test failed" };
}

/** Helper to create an error result. */
function errorResult(durationMs = 50): Omit<CheckExecutionResult, "checkName" | "command"> {
  return { status: "error", durationMs, errorMessage: "Process crashed" };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ValidationRunnerService", () => {
  // ── Profile Loading ──────────────────────────────────────────────────

  describe("profile loading", () => {
    /**
     * Verifies that requesting a non-existent profile throws
     * MissingValidationProfileError. This prevents silent misconfiguration
     * where the orchestrator thinks validation passed because it ran no checks.
     */
    it("throws MissingValidationProfileError when profile does not exist", async () => {
      const executor = createFakeCheckExecutor({});
      const runner = createValidationRunnerService(executor);

      await expect(
        runner.runValidation({
          taskId: TASK_ID,
          profileName: "nonexistent-profile",
          validationPolicy: DEFAULT_DEV_POLICY,
          workspacePath: WORKSPACE_PATH,
        }),
      ).rejects.toThrow(MissingValidationProfileError);
    });

    /**
     * Verifies that the error includes available profile names, helping
     * operators diagnose misconfiguration quickly.
     */
    it("includes available profiles in the error", async () => {
      const executor = createFakeCheckExecutor({});
      const runner = createValidationRunnerService(executor);

      try {
        await runner.runValidation({
          taskId: TASK_ID,
          profileName: "bad-name",
          validationPolicy: MULTI_PROFILE_POLICY,
          workspacePath: WORKSPACE_PATH,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(MissingValidationProfileError);
        const error = err as MissingValidationProfileError;
        expect(error.profileName).toBe("bad-name");
        expect(error.availableProfiles).toContain("default-dev");
        expect(error.availableProfiles).toContain("merge-gate");
        expect(error.availableProfiles).toContain("lenient");
      }
    });

    /**
     * Verifies that a valid profile loads and executes successfully.
     * This is the happy-path baseline.
     */
    it("loads and executes a valid profile", async () => {
      const executor = createFakeCheckExecutor({
        test: passingResult(),
        lint: passingResult(),
        build: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.profileName).toBe("default-dev");
      expect(result.overallStatus).toBe("passed");
      expect(result.checkOutcomes).toHaveLength(3);
    });
  });

  // ── Check Execution Order ────────────────────────────────────────────

  describe("check execution order", () => {
    /**
     * Verifies that required checks execute before optional checks, matching
     * PRD §9.5 which specifies required checks must complete first. This
     * ensures operators see critical failures before nice-to-have results.
     */
    it("executes required checks before optional checks", async () => {
      const executor = createFakeCheckExecutor({
        test: passingResult(10),
        lint: passingResult(20),
        build: passingResult(30),
      });
      const runner = createValidationRunnerService(executor);

      await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      // Verify execution order via the executor's call log
      expect(executor.calls).toHaveLength(3);
      expect(executor.calls[0]!.checkName).toBe("test"); // required
      expect(executor.calls[1]!.checkName).toBe("lint"); // required
      expect(executor.calls[2]!.checkName).toBe("build"); // optional
    });

    /**
     * Verifies that checks are passed the correct workspace path and
     * command from the profile's command map.
     */
    it("passes correct workspace path and commands to executor", async () => {
      const executor = createFakeCheckExecutor({
        test: passingResult(),
        lint: passingResult(),
        build: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      for (const call of executor.calls) {
        expect(call.workspacePath).toBe(WORKSPACE_PATH);
      }
      expect(executor.calls[0]!.command).toBe("pnpm test");
      expect(executor.calls[1]!.command).toBe("pnpm lint");
      expect(executor.calls[2]!.command).toBe("pnpm build");
    });

    /**
     * Verifies that all checks run even after a required check fails.
     * The runner must continue executing remaining checks to provide
     * a complete validation picture.
     */
    it("continues running all checks after a required check fails", async () => {
      const executor = createFakeCheckExecutor({
        test: failingResult(),
        lint: passingResult(),
        build: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      // All 3 checks should have been executed
      expect(executor.calls).toHaveLength(3);
      expect(result.checkOutcomes).toHaveLength(3);
    });
  });

  // ── Overall Status: Required Check Failures ──────────────────────────

  describe("overall status — required check failures", () => {
    /**
     * Verifies that all required checks passing yields overall "passed".
     * This is the core happy path for the quality gate.
     */
    it("passes when all required checks pass", async () => {
      const executor = createFakeCheckExecutor({
        test: passingResult(),
        lint: passingResult(),
        build: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.overallStatus).toBe("passed");
      expect(result.requiredPassedCount).toBe(2);
      expect(result.requiredFailedCount).toBe(0);
    });

    /**
     * Verifies that a single required check failure makes the overall
     * result "failed". This is the critical safety invariant: the quality
     * gate must block progression when required checks fail.
     */
    it("fails when any required check fails", async () => {
      const executor = createFakeCheckExecutor({
        test: failingResult(),
        lint: passingResult(),
        build: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.overallStatus).toBe("failed");
      expect(result.requiredFailedCount).toBe(1);
      expect(result.requiredPassedCount).toBe(1);
    });

    /**
     * Verifies that a required check erroring (crash, timeout) also fails
     * the overall result. Errors are strictly worse than failures.
     */
    it("fails when a required check errors", async () => {
      const executor = createFakeCheckExecutor({
        test: errorResult(),
        lint: passingResult(),
        build: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.overallStatus).toBe("failed");
      expect(result.requiredFailedCount).toBe(1);
    });

    /**
     * Verifies that multiple required check failures are all counted.
     * The runner must not short-circuit counting after the first failure.
     */
    it("counts multiple required failures", async () => {
      const executor = createFakeCheckExecutor({
        test: failingResult(),
        lint: failingResult(),
        build: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.overallStatus).toBe("failed");
      expect(result.requiredFailedCount).toBe(2);
      expect(result.requiredPassedCount).toBe(0);
    });
  });

  // ── Overall Status: Optional Check Failures ──────────────────────────

  describe("overall status — optional check failures", () => {
    /**
     * Verifies that optional check failures do NOT affect overall status.
     * This is a critical semantic distinction: optional checks provide
     * information but never block task progression.
     */
    it("passes when optional checks fail but all required pass", async () => {
      const executor = createFakeCheckExecutor({
        test: passingResult(),
        lint: passingResult(),
        build: failingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.overallStatus).toBe("passed");
      expect(result.optionalFailedCount).toBe(1);
      expect(result.optionalPassedCount).toBe(0);
    });

    /**
     * Verifies optional check errors also don't affect overall status.
     */
    it("passes when optional checks error but all required pass", async () => {
      const executor = createFakeCheckExecutor({
        test: passingResult(),
        lint: passingResult(),
        build: errorResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.overallStatus).toBe("passed");
      expect(result.optionalFailedCount).toBe(1);
    });
  });

  // ── Skipped Check Handling ───────────────────────────────────────────

  describe("skipped check handling", () => {
    /**
     * Verifies that a check with no command mapping in the profile is
     * marked as "skipped" rather than causing an unhandled error.
     * This handles misconfigured profiles gracefully.
     */
    it("marks checks without command mappings as skipped", async () => {
      const executor = createFakeCheckExecutor({
        test: passingResult(),
        lint: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "incomplete",
        validationPolicy: MISSING_COMMAND_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      const skippedCheck = result.checkOutcomes.find((c) => c.checkName === "security-scan");
      expect(skippedCheck).toBeDefined();
      expect(skippedCheck!.status).toBe("skipped");
      expect(skippedCheck!.category).toBe("required");
      expect(result.skippedCount).toBe(1);
    });

    /**
     * Verifies that skipped required checks with fail_on_skipped_required_check=true
     * cause overall failure. This prevents silent bypasses where a required check
     * is misconfigured and the runner falsely reports success.
     */
    it("fails when required check is skipped and fail_on_skipped_required_check is true", async () => {
      const executor = createFakeCheckExecutor({
        test: passingResult(),
        lint: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "incomplete",
        validationPolicy: MISSING_COMMAND_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.overallStatus).toBe("failed");
    });

    /**
     * Verifies that skipped required checks with fail_on_skipped_required_check=false
     * do NOT cause overall failure. Some profiles intentionally allow missing
     * checks (e.g., when a security scanner is not yet configured).
     */
    it("passes when required check is skipped and fail_on_skipped_required_check is false", async () => {
      const executor = createFakeCheckExecutor({
        test: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "tolerant",
        validationPolicy: SKIP_TOLERANT_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.overallStatus).toBe("passed");
      expect(result.skippedCount).toBe(1);
    });

    /**
     * Verifies that skipped checks are NOT sent to the executor.
     * The executor should only receive checks with valid command mappings.
     */
    it("does not invoke executor for skipped checks", async () => {
      const executor = createFakeCheckExecutor({
        test: passingResult(),
        lint: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      await runner.runValidation({
        taskId: TASK_ID,
        profileName: "incomplete",
        validationPolicy: MISSING_COMMAND_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      // Only test and lint should have been called — not security-scan
      expect(executor.calls).toHaveLength(2);
      expect(executor.calls.map((c) => c.checkName)).toEqual(["test", "lint"]);
    });
  });

  // ── Result Aggregation ───────────────────────────────────────────────

  describe("result aggregation", () => {
    /**
     * Verifies that check outcomes include the correct category assignment.
     * Required checks must be categorized as "required" and optional as
     * "optional" so downstream consumers can make policy decisions.
     */
    it("assigns correct categories to check outcomes", async () => {
      const executor = createFakeCheckExecutor({
        test: passingResult(),
        lint: passingResult(),
        build: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      const testOutcome = result.checkOutcomes.find((c) => c.checkName === "test");
      const lintOutcome = result.checkOutcomes.find((c) => c.checkName === "lint");
      const buildOutcome = result.checkOutcomes.find((c) => c.checkName === "build");

      expect(testOutcome!.category).toBe("required");
      expect(lintOutcome!.category).toBe("required");
      expect(buildOutcome!.category).toBe("optional");
    });

    /**
     * Verifies that output and error messages from the executor are
     * preserved in the check outcomes. Operators need this diagnostic
     * information to understand why a check failed.
     */
    it("preserves output and error messages from executor", async () => {
      const executor = createFakeCheckExecutor({
        test: { status: "failed", durationMs: 150, output: "FAIL: 3 tests failed" },
        lint: {
          status: "error",
          durationMs: 50,
          errorMessage: "eslint process exited with signal SIGKILL",
        },
        build: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      const testOutcome = result.checkOutcomes.find((c) => c.checkName === "test");
      const lintOutcome = result.checkOutcomes.find((c) => c.checkName === "lint");

      expect(testOutcome!.output).toBe("FAIL: 3 tests failed");
      expect(lintOutcome!.errorMessage).toBe("eslint process exited with signal SIGKILL");
    });

    /**
     * Verifies that the summary string includes profile name, task ID,
     * and overall status — the minimum information for audit logging.
     */
    it("builds a summary with profile name and status", async () => {
      const executor = createFakeCheckExecutor({
        test: passingResult(),
        lint: passingResult(),
        build: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.summary).toContain("PASSED");
      expect(result.summary).toContain(TASK_ID);
      expect(result.summary).toContain("default-dev");
    });

    /**
     * Verifies that failed validation includes "FAILED" in the summary.
     */
    it("summary indicates FAILED when validation fails", async () => {
      const executor = createFakeCheckExecutor({
        test: failingResult(),
        lint: passingResult(),
        build: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.summary).toContain("FAILED");
    });

    /**
     * Verifies totalDurationMs is tracked (it should be >= 0).
     * The exact value depends on execution speed but must be non-negative.
     */
    it("tracks total duration", async () => {
      const executor = createFakeCheckExecutor({
        test: passingResult(100),
        lint: passingResult(200),
        build: passingResult(300),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: DEFAULT_DEV_POLICY,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Multi-Profile Support ────────────────────────────────────────────

  describe("multi-profile support", () => {
    /**
     * Verifies that different profiles execute their own check sets.
     * The merge-gate profile has "build" as required (not optional like
     * default-dev), so a build failure must fail the merge-gate validation.
     */
    it("executes different profiles with different check sets", async () => {
      const executor = createFakeCheckExecutor({
        test: passingResult(),
        build: failingResult(),
        lint: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      // default-dev: build is optional → should pass
      const devResult = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "default-dev",
        validationPolicy: MULTI_PROFILE_POLICY,
        workspacePath: WORKSPACE_PATH,
      });
      expect(devResult.overallStatus).toBe("passed");

      // merge-gate: build is required → should fail
      const mergeResult = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "merge-gate",
        validationPolicy: MULTI_PROFILE_POLICY,
        workspacePath: WORKSPACE_PATH,
      });
      expect(mergeResult.overallStatus).toBe("failed");
    });

    /**
     * Verifies that the lenient profile (fail_on_skipped=false) behaves
     * differently from strict profiles for skipped checks.
     */
    it("respects profile-specific fail_on_skipped_required_check setting", async () => {
      const policyWithSkip = {
        profiles: {
          ...MULTI_PROFILE_POLICY.profiles,
          lenient: {
            required_checks: ["test", "missing-check"],
            optional_checks: [],
            commands: {
              test: "pnpm test",
              // "missing-check" has no command → will be skipped
            },
            fail_on_skipped_required_check: false,
          },
        },
      };

      const executor = createFakeCheckExecutor({
        test: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "lenient",
        validationPolicy: policyWithSkip,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.overallStatus).toBe("passed");
      expect(result.skippedCount).toBe(1);
    });
  });

  // ── Edge Cases ───────────────────────────────────────────────────────

  describe("edge cases", () => {
    /**
     * Verifies that a profile with no checks passes vacuously.
     * This handles the edge case of an empty profile configuration.
     */
    it("passes with empty check lists", async () => {
      const emptyPolicy = {
        profiles: {
          empty: {
            required_checks: [] as string[],
            optional_checks: [] as string[],
            commands: {},
            fail_on_skipped_required_check: true,
          },
        },
      };

      const executor = createFakeCheckExecutor({});
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "empty",
        validationPolicy: emptyPolicy,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.overallStatus).toBe("passed");
      expect(result.checkOutcomes).toHaveLength(0);
      expect(executor.calls).toHaveLength(0);
    });

    /**
     * Verifies that a profile with only optional checks passes even
     * if they all fail.
     */
    it("passes with only optional checks even if all fail", async () => {
      const optionalOnlyPolicy = {
        profiles: {
          "optional-only": {
            required_checks: [] as string[],
            optional_checks: ["lint", "build"],
            commands: {
              lint: "pnpm lint",
              build: "pnpm build",
            },
            fail_on_skipped_required_check: true,
          },
        },
      };

      const executor = createFakeCheckExecutor({
        lint: failingResult(),
        build: failingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "optional-only",
        validationPolicy: optionalOnlyPolicy,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.overallStatus).toBe("passed");
      expect(result.optionalFailedCount).toBe(2);
    });

    /**
     * Verifies that a profile with only required checks works correctly.
     */
    it("works with only required checks (no optional)", async () => {
      const requiredOnlyPolicy = {
        profiles: {
          strict: {
            required_checks: ["test", "lint", "build"],
            optional_checks: [] as string[],
            commands: {
              test: "pnpm test",
              lint: "pnpm lint",
              build: "pnpm build",
            },
            fail_on_skipped_required_check: true,
          },
        },
      };

      const executor = createFakeCheckExecutor({
        test: passingResult(),
        lint: passingResult(),
        build: passingResult(),
      });
      const runner = createValidationRunnerService(executor);

      const result = await runner.runValidation({
        taskId: TASK_ID,
        profileName: "strict",
        validationPolicy: requiredOnlyPolicy,
        workspacePath: WORKSPACE_PATH,
      });

      expect(result.overallStatus).toBe("passed");
      expect(result.requiredPassedCount).toBe(3);
      expect(result.optionalPassedCount).toBe(0);
    });

    /**
     * Verifies that the runner handles executor rejections gracefully.
     * If the executor throws, the error should propagate to the caller.
     */
    it("propagates executor errors", async () => {
      const executor: CheckExecutorPort = {
        executeCheck: async () => {
          throw new Error("executor crashed");
        },
      };
      const runner = createValidationRunnerService(executor);

      await expect(
        runner.runValidation({
          taskId: TASK_ID,
          profileName: "default-dev",
          validationPolicy: DEFAULT_DEV_POLICY,
          workspacePath: WORKSPACE_PATH,
        }),
      ).rejects.toThrow("executor crashed");
    });
  });
});
