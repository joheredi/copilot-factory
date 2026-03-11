/**
 * Policy-aware command wrapper for the Autonomous Software Factory.
 *
 * All command execution on behalf of workers must pass through this wrapper.
 * It enforces the command policy (allowlist, denied patterns, forbidden args,
 * shell operator blocking) before executing any shell command, as required by
 * PRD §9.3.3 and §7.15.
 *
 * The wrapper delegates policy evaluation to the domain layer's
 * {@link evaluateCommandPolicy} function, then executes allowed commands via
 * `child_process.execFile` (structured arguments, not raw shell strings).
 * Denied commands produce a {@link PolicyViolationArtifact} for audit logging
 * and throw a {@link PolicyViolationError}.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.3 — Command Policy
 * @see {@link file://docs/prd/007-technical-architecture.md} §7.15 — Security / Policy Enforcement
 * @module @factory/infrastructure/policy/command-wrapper
 */

import { execFile } from "node:child_process";

import type {
  CommandPolicy,
  CommandPolicyEvaluation,
  CommandViolationAction,
  CommandViolationReason,
} from "@factory/domain";
import { evaluateCommandPolicy } from "@factory/domain";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Error thrown when a command is denied by the command policy.
 *
 * Contains the full evaluation result and the generated violation artifact
 * so that callers can persist the artifact for audit trails without
 * re-computing the evaluation.
 */
export class PolicyViolationError extends Error {
  /** The structured policy evaluation that caused this denial. */
  readonly evaluation: CommandPolicyEvaluation;

  /** The structured artifact data for audit persistence. */
  readonly artifact: PolicyViolationArtifact;

  constructor(evaluation: CommandPolicyEvaluation, artifact: PolicyViolationArtifact) {
    super(
      `Command denied by policy: ${evaluation.explanation} ` +
        `[reason=${evaluation.reason ?? "unknown"}, action=${evaluation.action ?? "unknown"}]`,
    );
    this.name = "PolicyViolationError";
    this.evaluation = evaluation;
    this.artifact = artifact;
  }
}

/**
 * Error thrown when a command execution fails (non-zero exit code).
 *
 * Captures stdout, stderr, and exit code from the failed process so
 * callers can inspect the failure without re-executing the command.
 */
export class CommandExecutionError extends Error {
  /** The command that was executed. */
  readonly command: string;

  /** The arguments passed to the command. */
  readonly args: readonly string[];

  /** Process exit code, or null if the process was killed by a signal. */
  readonly exitCode: number | null;

  /** Process stdout output at time of failure. */
  readonly stdout: string;

  /** Process stderr output at time of failure. */
  readonly stderr: string;

  constructor(
    command: string,
    args: readonly string[],
    exitCode: number | null,
    stdout: string,
    stderr: string,
  ) {
    const exitInfo = exitCode !== null ? `exit code ${exitCode}` : "killed by signal";
    super(`Command "${command} ${args.join(" ")}" failed with ${exitInfo}: ${stderr || stdout}`);
    this.name = "CommandExecutionError";
    this.command = command;
    this.args = args;
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

// ---------------------------------------------------------------------------
// Policy violation artifact
// ---------------------------------------------------------------------------

/**
 * Structured artifact emitted when a command is denied by policy.
 *
 * This artifact is designed for audit persistence. The control plane
 * can store it as a run artifact to maintain a record of all policy
 * violations that occurred during a worker's execution.
 *
 * @see PRD §9.3.3 — "A denied command attempt produces a policy violation artifact"
 */
export interface PolicyViolationArtifact {
  /** Artifact type discriminator for deserialization. */
  readonly type: "policy_violation";

  /** ISO-8601 timestamp of when the violation occurred. */
  readonly timestamp: string;

  /** The raw command string that was evaluated. */
  readonly raw_command: string;

  /** The parsed base command (first token). */
  readonly parsed_command: string;

  /** The parsed argument tokens. */
  readonly parsed_args: readonly string[];

  /** The category of violation that was detected. */
  readonly violation_reason: CommandViolationReason;

  /** Human-readable description of why the command was denied. */
  readonly explanation: string;

  /** The enforcement action prescribed by the policy. */
  readonly action: CommandViolationAction;
}

// ---------------------------------------------------------------------------
// Command execution types
// ---------------------------------------------------------------------------

/**
 * Options controlling how a command is executed after policy validation.
 */
export interface CommandExecutionOptions {
  /** Working directory for the spawned process. */
  readonly cwd?: string;

  /**
   * Environment variables for the spawned process.
   * If omitted, inherits the current process environment.
   */
  readonly env?: Readonly<Record<string, string>>;

  /**
   * Maximum execution time in milliseconds.
   * The process is killed with SIGTERM if it exceeds this timeout.
   * Default: 300_000 (5 minutes).
   */
  readonly timeoutMs?: number;

  /**
   * Maximum bytes allowed on stdout + stderr combined.
   * Prevents runaway output from consuming memory.
   * Default: 10_485_760 (10 MiB).
   */
  readonly maxOutputBytes?: number;
}

/** Default execution timeout: 5 minutes. */
const DEFAULT_TIMEOUT_MS = 300_000;

/** Default max output size: 10 MiB. */
const DEFAULT_MAX_OUTPUT_BYTES = 10_485_760;

/**
 * Result of a successful command execution.
 *
 * Only returned when the command passes policy validation AND
 * completes with exit code 0.
 */
export interface CommandExecutionResult {
  /** The base command that was executed. */
  readonly command: string;

  /** The argument tokens that were passed. */
  readonly args: readonly string[];

  /** Process exit code (always 0 for successful results). */
  readonly exitCode: number;

  /** Captured stdout output. */
  readonly stdout: string;

  /** Captured stderr output. */
  readonly stderr: string;

  /** Wall-clock execution duration in milliseconds. */
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// Artifact factory
// ---------------------------------------------------------------------------

/**
 * Creates a structured policy violation artifact from an evaluation result.
 *
 * This factory is exported so that callers who use {@link validateCommand}
 * directly (without executing) can still produce artifacts for audit logging.
 *
 * @param evaluation - The domain-layer evaluation result that denied the command.
 * @returns A structured artifact suitable for audit persistence.
 */
export function createPolicyViolationArtifact(
  evaluation: CommandPolicyEvaluation,
): PolicyViolationArtifact {
  return {
    type: "policy_violation",
    timestamp: new Date().toISOString(),
    raw_command: evaluation.parsed.raw,
    parsed_command: evaluation.parsed.command,
    parsed_args: evaluation.parsed.args,
    violation_reason: evaluation.reason!,
    explanation: evaluation.explanation,
    action: evaluation.action!,
  };
}

// ---------------------------------------------------------------------------
// Validation-only path
// ---------------------------------------------------------------------------

/**
 * Validates a command against the policy without executing it.
 *
 * Use this when you need to pre-check a command (e.g., to give the
 * worker early feedback) without actually running it. The evaluation
 * result can be inspected for allow/deny decisions and violation details.
 *
 * @param rawCommand - The full command string to validate (e.g., "git status").
 * @param policy - The effective command policy for this run.
 * @returns The domain-layer evaluation result.
 *
 * @example
 * ```ts
 * const eval = validateCommand("rm -rf /", policy);
 * if (!eval.allowed) {
 *   console.log(`Would be denied: ${eval.explanation}`);
 * }
 * ```
 */
export function validateCommand(
  rawCommand: string,
  policy: CommandPolicy,
): CommandPolicyEvaluation {
  return evaluateCommandPolicy(rawCommand, policy);
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

/**
 * Validates a command against the policy and, if allowed, executes it.
 *
 * This is the primary entry point for all worker command execution.
 * The execution flow is:
 *
 * 1. Evaluate the raw command string against the command policy.
 * 2. If denied: create a policy violation artifact and throw {@link PolicyViolationError}.
 * 3. If allowed: execute via `child_process.execFile` with structured arguments.
 * 4. If the process exits with code 0: return {@link CommandExecutionResult}.
 * 5. If the process exits non-zero: throw {@link CommandExecutionError}.
 *
 * Commands are executed with `execFile` (not `exec`) to avoid shell
 * interpretation. The command binary is resolved by the OS, and arguments
 * are passed as an array, preventing shell injection.
 *
 * @param rawCommand - The full command string (e.g., "pnpm test --filter @factory/domain").
 * @param policy - The effective command policy for this run.
 * @param options - Optional execution parameters (cwd, env, timeout).
 * @returns A promise resolving to the execution result on success.
 * @throws {PolicyViolationError} If the command is denied by policy.
 * @throws {CommandExecutionError} If the command exits with a non-zero code.
 *
 * @example
 * ```ts
 * const result = await executeCommand("pnpm test", policy, { cwd: "/workspace" });
 * console.log(result.stdout);
 * ```
 */
export async function executeCommand(
  rawCommand: string,
  policy: CommandPolicy,
  options: CommandExecutionOptions = {},
): Promise<CommandExecutionResult> {
  // Step 1: Evaluate the command against the policy
  const evaluation = evaluateCommandPolicy(rawCommand, policy);

  // Step 2: If denied, emit artifact and throw
  if (!evaluation.allowed) {
    const artifact = createPolicyViolationArtifact(evaluation);
    throw new PolicyViolationError(evaluation, artifact);
  }

  // Step 3: Execute with structured arguments via execFile
  const { command, args } = evaluation.parsed;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  const startTime = performance.now();

  const { exitCode, stdout, stderr } = await runProcess(command, [...args], {
    cwd: options.cwd,
    env: options.env ? { ...options.env } : undefined,
    timeout: timeoutMs,
    maxBuffer: maxOutputBytes,
  });

  const durationMs = Math.round(performance.now() - startTime);

  // Step 4: Non-zero exit code is a command execution failure
  if (exitCode !== 0) {
    throw new CommandExecutionError(command, args, exitCode, stdout, stderr);
  }

  // Step 5: Return successful result
  return {
    command,
    args,
    exitCode: 0,
    stdout,
    stderr,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Process execution (internal, testable seam)
// ---------------------------------------------------------------------------

/** Options passed to the underlying process spawn. */
interface ProcessOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeout: number;
  readonly maxBuffer: number;
}

/** Raw result from the underlying process execution. */
interface ProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Internal process execution function.
 *
 * Wraps `child_process.execFile` in a promise. Separated from
 * {@link executeCommand} to allow test doubles to be injected via
 * the module-level `setProcessRunner` escape hatch.
 */
let processRunner: (
  command: string,
  args: string[],
  options: ProcessOptions,
) => Promise<ProcessResult> = defaultProcessRunner;

/**
 * Replaces the process runner with a test double.
 *
 * @internal — Only for use in tests. Restoring the default runner
 * after each test is the caller's responsibility.
 */
export function setProcessRunner(
  runner: (command: string, args: string[], options: ProcessOptions) => Promise<ProcessResult>,
): void {
  processRunner = runner;
}

/**
 * Restores the default process runner (child_process.execFile).
 *
 * @internal — Only for use in tests.
 */
export function restoreDefaultProcessRunner(): void {
  processRunner = defaultProcessRunner;
}

function runProcess(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  return processRunner(command, args, options);
}

function defaultProcessRunner(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error) {
          // execFile callback errors carry the child's exit code or killed flag.
          const errWithCode = error as NodeJS.ErrnoException & { code?: string | number };
          const exitCode =
            typeof errWithCode.code === "number" ? errWithCode.code : error.killed ? null : 1;
          resolve({ exitCode, stdout: stdout ?? "", stderr: stderr ?? "" });
          return;
        }
        resolve({ exitCode: 0, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}
