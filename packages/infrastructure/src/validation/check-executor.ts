/**
 * Concrete implementation of {@link CheckExecutorPort} that executes
 * validation check commands via the policy-aware command wrapper.
 *
 * This adapter bridges the application layer's validation runner abstraction
 * (T054) with the infrastructure layer's command execution (T047). Every
 * command goes through policy evaluation before execution, ensuring that
 * validation commands are subject to the same allowlist/denylist rules as
 * worker commands.
 *
 * **Execution flow:**
 * 1. Receive check params (name, command, workspace path).
 * 2. Execute via {@link executeCommand} with the workspace as cwd.
 * 3. Map outcomes:
 *    - Exit code 0 → `"passed"`
 *    - Non-zero exit → `"failed"` (test/lint failure, not an infrastructure error)
 *    - Policy violation → `"error"` (infrastructure-level denial)
 *    - Unexpected exception → `"error"`
 * 4. Capture timing, stdout, and stderr in all cases.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.3 Command Policy
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5 Validation Policy
 * @see {@link file://docs/backlog/tasks/T055-validation-command-exec.md}
 * @module @factory/infrastructure/validation/check-executor
 */

import type { CommandPolicy } from "@factory/domain";

import {
  executeCommand,
  CommandExecutionError,
  PolicyViolationError,
} from "../policy/command-wrapper.js";
import type { CommandExecutionOptions } from "../policy/command-wrapper.js";

// ─── Port-compatible types ──────────────────────────────────────────────────
// These mirror the application layer's CheckExecutorPort contract.
// Infrastructure must not depend on the application layer (layered architecture),
// so we define structurally compatible types here. TypeScript's structural typing
// ensures that createCheckExecutor's return type satisfies CheckExecutorPort.

/**
 * Parameters for executing a single validation check.
 * Structurally compatible with {@link @factory/application CheckExecutorPort}.
 */
export interface ExecuteCheckParams {
  readonly checkName: string;
  readonly command: string;
  readonly workspacePath: string;
}

/**
 * Result of executing a single validation check.
 * Structurally compatible with {@link @factory/application CheckExecutionResult}.
 */
export interface CheckExecutionResult {
  readonly checkName: string;
  readonly command: string;
  readonly status: "passed" | "failed" | "skipped" | "error";
  readonly durationMs: number;
  readonly output?: string;
  readonly errorMessage?: string;
}

/**
 * Port interface for executing a single validation check command.
 * Structurally compatible with {@link @factory/application CheckExecutorPort}.
 */
export interface CheckExecutorPort {
  executeCheck(params: ExecuteCheckParams): Promise<CheckExecutionResult>;
}

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Configuration options for the check executor.
 */
export interface CheckExecutorConfig {
  /**
   * Maximum execution time per check in milliseconds.
   * The process is killed with SIGTERM if it exceeds this timeout.
   * Default: 300_000 (5 minutes).
   */
  readonly timeoutMs?: number;

  /**
   * Maximum bytes allowed on stdout + stderr combined per check.
   * Prevents runaway output from consuming memory.
   * Default: 10_485_760 (10 MiB).
   */
  readonly maxOutputBytes?: number;

  /**
   * Maximum characters of combined output to include in the
   * {@link CheckExecutionResult.output} field.
   * Keeps result objects manageable when commands produce large output.
   * Default: 50_000 (50K chars).
   */
  readonly maxOutputChars?: number;
}

/** Default maximum characters of output to include in results. */
const DEFAULT_MAX_OUTPUT_CHARS = 50_000;

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Creates a {@link CheckExecutorPort} implementation that executes commands
 * through the policy-aware command wrapper.
 *
 * @param commandPolicy - The effective command policy for this validation run.
 *   All commands are validated against this policy before execution.
 * @param config - Optional configuration for timeouts and output limits.
 * @returns A {@link CheckExecutorPort} that can execute validation checks.
 *
 * @example
 * ```ts
 * const executor = createCheckExecutor(policySnapshot.command_policy);
 * const result = await executor.executeCheck({
 *   checkName: "test",
 *   command: "pnpm test",
 *   workspacePath: "/workspaces/task-123",
 * });
 * ```
 */
export function createCheckExecutor(
  commandPolicy: CommandPolicy,
  config: CheckExecutorConfig = {},
): CheckExecutorPort {
  const maxOutputChars = config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const executionOptions: CommandExecutionOptions = {
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.maxOutputBytes !== undefined ? { maxOutputBytes: config.maxOutputBytes } : {}),
  };

  return {
    executeCheck: async (params: ExecuteCheckParams): Promise<CheckExecutionResult> => {
      const { checkName, command, workspacePath } = params;
      const startTime = performance.now();

      try {
        const result = await executeCommand(command, commandPolicy, {
          ...executionOptions,
          cwd: workspacePath,
        });

        const durationMs = Math.round(performance.now() - startTime);
        const output = combineOutput(result.stdout, result.stderr, maxOutputChars);

        return {
          checkName,
          command,
          status: "passed",
          durationMs,
          output: output || undefined,
        };
      } catch (error: unknown) {
        const durationMs = Math.round(performance.now() - startTime);

        if (error instanceof CommandExecutionError) {
          return handleCommandFailure(checkName, command, error, durationMs, maxOutputChars);
        }

        if (error instanceof PolicyViolationError) {
          return handlePolicyViolation(checkName, command, error, durationMs);
        }

        return handleUnexpectedError(checkName, command, error, durationMs);
      }
    },
  };
}

// ─── Internal Handlers ──────────────────────────────────────────────────────

/**
 * Handles a command that executed but exited with a non-zero code.
 *
 * This represents a legitimate check failure (e.g., tests failed, lint errors found)
 * rather than an infrastructure error. The status is "failed" — the check ran but
 * did not pass.
 */
function handleCommandFailure(
  checkName: string,
  command: string,
  error: CommandExecutionError,
  durationMs: number,
  maxOutputChars: number,
): CheckExecutionResult {
  const output = combineOutput(error.stdout, error.stderr, maxOutputChars);
  const exitInfo =
    error.exitCode !== null ? `exit code ${error.exitCode}` : "killed by signal (possible timeout)";

  return {
    checkName,
    command,
    status: "failed",
    durationMs,
    output: output || undefined,
    errorMessage: `Check "${checkName}" failed with ${exitInfo}`,
  };
}

/**
 * Handles a command denied by the command policy.
 *
 * This is an infrastructure-level error — the command was not allowed to run.
 * The status is "error" to distinguish from a check that ran and failed.
 */
function handlePolicyViolation(
  checkName: string,
  command: string,
  error: PolicyViolationError,
  durationMs: number,
): CheckExecutionResult {
  return {
    checkName,
    command,
    status: "error",
    durationMs,
    errorMessage: `Policy violation: ${error.evaluation.explanation}`,
  };
}

/**
 * Handles unexpected errors (e.g., command not found, permissions, OS errors).
 *
 * The status is "error" to indicate an infrastructure-level failure that
 * prevented the check from running.
 */
function handleUnexpectedError(
  checkName: string,
  command: string,
  error: unknown,
  durationMs: number,
): CheckExecutionResult {
  const message = error instanceof Error ? error.message : String(error);

  return {
    checkName,
    command,
    status: "error",
    durationMs,
    errorMessage: `Unexpected error executing check "${checkName}": ${message}`,
  };
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/**
 * Combines stdout and stderr into a single output string, truncated
 * to the configured maximum length.
 *
 * @param stdout - Standard output from the process.
 * @param stderr - Standard error from the process.
 * @param maxChars - Maximum characters to include.
 * @returns Combined output string, or empty string if both are empty.
 */
function combineOutput(stdout: string, stderr: string, maxChars: number): string {
  const parts: string[] = [];

  if (stdout.length > 0) {
    parts.push(stdout);
  }
  if (stderr.length > 0) {
    if (parts.length > 0) {
      parts.push("\n--- stderr ---\n");
    }
    parts.push(stderr);
  }

  const combined = parts.join("");

  if (combined.length <= maxChars) {
    return combined;
  }

  return combined.slice(0, maxChars) + `\n... [truncated at ${maxChars} chars]`;
}
