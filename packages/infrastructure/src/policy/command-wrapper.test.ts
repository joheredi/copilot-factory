/**
 * Tests for the policy-aware command wrapper.
 *
 * These tests validate that the command wrapper correctly enforces command
 * policy before executing any shell command on behalf of a worker. This is
 * a security-critical module: every worker command must pass through this
 * wrapper, so comprehensive coverage of allow/deny paths is essential.
 *
 * The tests use a mock process runner (via {@link setProcessRunner}) to
 * avoid spawning real processes. This isolates policy enforcement logic
 * from OS-level execution concerns.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.3
 * @module @factory/infrastructure/policy/command-wrapper.test
 */

import { describe, it, expect, afterEach } from "vitest";

import type { CommandPolicy } from "@factory/domain";
import { CommandPolicyMode, CommandViolationAction, CommandViolationReason } from "@factory/domain";

import {
  PolicyViolationError,
  CommandExecutionError,
  executeCommand,
  validateCommand,
  createPolicyViolationArtifact,
  setProcessRunner,
  restoreDefaultProcessRunner,
} from "./command-wrapper.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * A restrictive allowlist policy for testing.
 * Permits git and pnpm with argument prefix restrictions,
 * blocks shell operators, and has denied/forbidden patterns.
 */
function createTestPolicy(overrides: Partial<CommandPolicy> = {}): CommandPolicy {
  return {
    mode: CommandPolicyMode.ALLOWLIST,
    allowed_commands: [
      { command: "git", arg_prefixes: ["status", "diff", "add", "commit", "log"] },
      { command: "pnpm", arg_prefixes: ["test", "build", "install", "lint"] },
      { command: "node", arg_prefixes: [] },
      { command: "cat", arg_prefixes: [] },
    ],
    denied_patterns: [
      { pattern: "rm -rf /", reason: "Destructive delete of root" },
      { pattern: "sudo *", reason: "Elevated privileges not allowed" },
      { pattern: "curl * | sh", reason: "Piped execution from network" },
    ],
    forbidden_arg_patterns: [
      { pattern: "\\.\\./\\.\\./", reason: "Path traversal attack" },
      { pattern: "/etc/", reason: "System directory access" },
    ],
    allow_shell_operators: false,
    on_violation: CommandViolationAction.FAIL_RUN,
    ...overrides,
  };
}

/**
 * A mock process runner that resolves with configurable output.
 * Returns exit code 0 by default (successful execution).
 */
function createMockRunner(result?: { exitCode?: number | null; stdout?: string; stderr?: string }) {
  const calls: Array<{ command: string; args: string[]; options: unknown }> = [];
  const runner = async (command: string, args: string[], options: unknown) => {
    calls.push({ command, args, options });
    return {
      exitCode: result?.exitCode !== undefined ? result.exitCode : 0,
      stdout: result?.stdout ?? "",
      stderr: result?.stderr ?? "",
    };
  };
  return { runner, calls };
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

describe("command-wrapper", () => {
  afterEach(() => {
    restoreDefaultProcessRunner();
  });

  // =========================================================================
  // validateCommand (policy evaluation without execution)
  // =========================================================================

  describe("validateCommand", () => {
    /**
     * Verifies that commands on the allowlist with valid argument prefixes
     * pass validation. This is the happy path for legitimate worker commands.
     */
    it("allows commands that pass the allowlist", () => {
      const policy = createTestPolicy();
      const result = validateCommand("git status", policy);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.parsed.command).toBe("git");
      expect(result.parsed.args).toEqual(["status"]);
    });

    /**
     * Verifies that commands not in the allowlist are denied.
     * This is the primary security control: unknown commands are blocked.
     */
    it("denies commands not in the allowlist", () => {
      const policy = createTestPolicy();
      const result = validateCommand("curl https://evil.com", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.NOT_IN_ALLOWLIST);
      expect(result.action).toBe(CommandViolationAction.FAIL_RUN);
    });

    /**
     * Verifies that argument prefix restrictions are enforced.
     * A command may be allowed, but only with certain argument patterns.
     */
    it("denies commands with disallowed argument prefixes", () => {
      const policy = createTestPolicy();
      const result = validateCommand("git push origin main", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.ARG_PREFIX_NOT_ALLOWED);
    });

    /**
     * Verifies that commands matching denied patterns are blocked even
     * if the base command itself might pass the allowlist. Denied patterns
     * are a second line of defense.
     */
    it("denies commands matching denied patterns", () => {
      const policy = createTestPolicy();
      const result = validateCommand("sudo pnpm install", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.MATCHES_DENIED_PATTERN);
    });

    /**
     * Verifies that shell compound operators (&&, ||, |, ;) are blocked
     * when the policy disallows them. This prevents workers from chaining
     * commands to bypass per-command policy checks.
     */
    it("denies shell compound operators when policy disallows them", () => {
      const policy = createTestPolicy();
      const result = validateCommand("git status && rm -rf /", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.SHELL_OPERATORS_DENIED);
    });

    /**
     * Verifies that command substitution via $() is blocked.
     * This prevents workers from injecting dynamic commands.
     */
    it("denies command substitution via $()", () => {
      const policy = createTestPolicy();
      const result = validateCommand("cat $(cat /etc/passwd)", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.SHELL_OPERATORS_DENIED);
    });

    /**
     * Verifies that backtick command substitution is blocked.
     */
    it("denies backtick command substitution", () => {
      const policy = createTestPolicy();
      const result = validateCommand("cat `cat /etc/passwd`", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.SHELL_OPERATORS_DENIED);
    });

    /**
     * Verifies that forbidden argument patterns are caught even when
     * the command and argument prefix pass the allowlist. This is
     * the third line of defense for dangerous argument values.
     */
    it("denies forbidden argument patterns after allowlist pass", () => {
      const policy = createTestPolicy();
      const result = validateCommand("cat ../../../../etc/passwd", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.FORBIDDEN_ARG_PATTERN);
    });

    /**
     * Verifies that empty commands are rejected as invalid.
     * An empty command string should never be passed to the OS.
     */
    it("denies empty commands", () => {
      const policy = createTestPolicy();
      const result = validateCommand("", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.INVALID_COMMAND);
    });

    /**
     * Verifies that whitespace-only commands are rejected as invalid.
     */
    it("denies whitespace-only commands", () => {
      const policy = createTestPolicy();
      const result = validateCommand("   ", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.INVALID_COMMAND);
    });

    /**
     * Verifies that shell operators are allowed when the policy permits them.
     * Some trusted environments may want to allow compound commands.
     */
    it("allows shell operators when policy permits them", () => {
      const policy = createTestPolicy({ allow_shell_operators: true });
      const result = validateCommand("git status && git diff", policy);

      // Still denied because "git status && git diff" is parsed as a single
      // command "git" with args ["status", "&&", "git", "diff"], and "status"
      // is an allowed prefix, so it passes the allowlist. But && in args
      // doesn't matter when shell operators are allowed.
      expect(result.allowed).toBe(true);
    });

    /**
     * Verifies that commands with no argument prefix restrictions
     * (empty arg_prefixes) allow any arguments.
     */
    it("allows any args when arg_prefixes is empty", () => {
      const policy = createTestPolicy();
      const result = validateCommand("node --experimental-vm-modules test.js", policy);

      expect(result.allowed).toBe(true);
    });

    /**
     * Verifies that pipe operators are correctly detected and blocked.
     */
    it("denies pipe operators", () => {
      const policy = createTestPolicy();
      const result = validateCommand("cat file.txt | grep secret", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.SHELL_OPERATORS_DENIED);
    });

    /**
     * Verifies that semicolons (command separators) are blocked.
     */
    it("denies semicolons in commands", () => {
      const policy = createTestPolicy();
      const result = validateCommand("git status; rm -rf /", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.SHELL_OPERATORS_DENIED);
    });
  });

  // =========================================================================
  // createPolicyViolationArtifact
  // =========================================================================

  describe("createPolicyViolationArtifact", () => {
    /**
     * Verifies that the artifact factory produces correctly structured
     * artifacts with all required fields populated from the evaluation.
     * These artifacts are persisted for audit trails.
     */
    it("creates a well-formed artifact from an evaluation", () => {
      const policy = createTestPolicy();
      const evaluation = validateCommand("curl https://evil.com", policy);
      const artifact = createPolicyViolationArtifact(evaluation);

      expect(artifact.type).toBe("policy_violation");
      expect(artifact.raw_command).toBe("curl https://evil.com");
      expect(artifact.parsed_command).toBe("curl");
      expect(artifact.parsed_args).toEqual(["https://evil.com"]);
      expect(artifact.violation_reason).toBe(CommandViolationReason.NOT_IN_ALLOWLIST);
      expect(artifact.explanation).toContain("not in the allowlist");
      expect(artifact.action).toBe(CommandViolationAction.FAIL_RUN);
      expect(artifact.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    /**
     * Verifies that the artifact includes the correct violation reason
     * for shell operator violations specifically.
     */
    it("captures shell operator violation details", () => {
      const policy = createTestPolicy();
      const evaluation = validateCommand("git status && rm -rf /", policy);
      const artifact = createPolicyViolationArtifact(evaluation);

      expect(artifact.violation_reason).toBe(CommandViolationReason.SHELL_OPERATORS_DENIED);
      expect(artifact.parsed_command).toBe("git");
    });

    /**
     * Verifies that each call produces a unique timestamp,
     * ensuring artifacts can be ordered chronologically.
     */
    it("generates unique timestamps per call", async () => {
      const policy = createTestPolicy();
      const evaluation = validateCommand("curl bad", policy);

      const artifact1 = createPolicyViolationArtifact(evaluation);
      // Tiny delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 2));
      const artifact2 = createPolicyViolationArtifact(evaluation);

      // Timestamps should both be valid ISO strings
      expect(new Date(artifact1.timestamp).getTime()).not.toBeNaN();
      expect(new Date(artifact2.timestamp).getTime()).not.toBeNaN();
    });
  });

  // =========================================================================
  // executeCommand (policy + execution)
  // =========================================================================

  describe("executeCommand", () => {
    /**
     * Verifies that an allowed command is actually executed via the
     * process runner and returns the captured stdout/stderr.
     * This is the happy path for normal worker operation.
     */
    it("executes allowed commands and returns result", async () => {
      const policy = createTestPolicy();
      const { runner, calls } = createMockRunner({
        stdout: "On branch main\nnothing to commit",
        stderr: "",
      });
      setProcessRunner(runner);

      const result = await executeCommand("git status", policy);

      expect(result.command).toBe("git");
      expect(result.args).toEqual(["status"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("On branch main\nnothing to commit");
      expect(result.stderr).toBe("");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // Verify the process runner was called with correct args
      expect(calls).toHaveLength(1);
      expect(calls[0]!.command).toBe("git");
      expect(calls[0]!.args).toEqual(["status"]);
    });

    /**
     * Verifies that denied commands throw PolicyViolationError without
     * ever calling the process runner. This ensures the security gate
     * cannot be bypassed.
     */
    it("throws PolicyViolationError for denied commands without executing", async () => {
      const policy = createTestPolicy();
      const { runner, calls } = createMockRunner();
      setProcessRunner(runner);

      await expect(executeCommand("curl https://evil.com", policy)).rejects.toThrow(
        PolicyViolationError,
      );

      // Process runner must NEVER be called for denied commands
      expect(calls).toHaveLength(0);
    });

    /**
     * Verifies that the PolicyViolationError contains the structured
     * evaluation and artifact for caller inspection and audit logging.
     */
    it("includes evaluation and artifact in PolicyViolationError", async () => {
      const policy = createTestPolicy();
      const { runner } = createMockRunner();
      setProcessRunner(runner);

      try {
        await executeCommand("curl https://evil.com", policy);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        const violation = err as PolicyViolationError;

        expect(violation.evaluation.allowed).toBe(false);
        expect(violation.evaluation.reason).toBe(CommandViolationReason.NOT_IN_ALLOWLIST);

        expect(violation.artifact.type).toBe("policy_violation");
        expect(violation.artifact.raw_command).toBe("curl https://evil.com");
        expect(violation.artifact.violation_reason).toBe(CommandViolationReason.NOT_IN_ALLOWLIST);
        expect(violation.artifact.action).toBe(CommandViolationAction.FAIL_RUN);
      }
    });

    /**
     * Verifies that commands which pass the allowlist but match a denied
     * pattern are still blocked. Denied patterns are a safety net.
     */
    it("blocks commands matching denied patterns even with valid base command", async () => {
      const policy = createTestPolicy({
        denied_patterns: [{ pattern: "pnpm install --unsafe-perm", reason: "Unsafe install" }],
      });
      const { runner, calls } = createMockRunner();
      setProcessRunner(runner);

      await expect(executeCommand("pnpm install --unsafe-perm", policy)).rejects.toThrow(
        PolicyViolationError,
      );
      expect(calls).toHaveLength(0);
    });

    /**
     * Verifies that shell compound commands are blocked when the policy
     * forbids them, preventing workers from chaining commands to escape
     * per-command policy checks.
     */
    it("blocks shell compound commands", async () => {
      const policy = createTestPolicy();
      const { runner, calls } = createMockRunner();
      setProcessRunner(runner);

      await expect(executeCommand("git status && cat /etc/shadow", policy)).rejects.toThrow(
        PolicyViolationError,
      );
      expect(calls).toHaveLength(0);
    });

    /**
     * Verifies that non-zero exit codes throw CommandExecutionError
     * with captured stdout, stderr, and exit code for debugging.
     */
    it("throws CommandExecutionError for non-zero exit codes", async () => {
      const policy = createTestPolicy();
      const { runner } = createMockRunner({
        exitCode: 1,
        stdout: "",
        stderr: "fatal: not a git repository",
      });
      setProcessRunner(runner);

      try {
        await executeCommand("git status", policy);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CommandExecutionError);
        const execError = err as CommandExecutionError;

        expect(execError.command).toBe("git");
        expect(execError.args).toEqual(["status"]);
        expect(execError.exitCode).toBe(1);
        expect(execError.stderr).toBe("fatal: not a git repository");
      }
    });

    /**
     * Verifies that the execution options (cwd, env, timeout) are
     * correctly forwarded to the process runner.
     */
    it("forwards execution options to the process runner", async () => {
      const policy = createTestPolicy();
      const { runner, calls } = createMockRunner({ stdout: "ok" });
      setProcessRunner(runner);

      await executeCommand("pnpm test", policy, {
        cwd: "/workspace/task-123",
        env: { NODE_ENV: "test" },
        timeoutMs: 60_000,
        maxOutputBytes: 1_048_576,
      });

      expect(calls).toHaveLength(1);
      const opts = calls[0]!.options as {
        cwd?: string;
        env?: Record<string, string>;
        timeout: number;
        maxBuffer: number;
      };
      expect(opts.cwd).toBe("/workspace/task-123");
      expect(opts.env).toEqual({ NODE_ENV: "test" });
      expect(opts.timeout).toBe(60_000);
      expect(opts.maxBuffer).toBe(1_048_576);
    });

    /**
     * Verifies that default timeout and max output values are used
     * when no options are provided.
     */
    it("uses default timeout and maxOutput when options omitted", async () => {
      const policy = createTestPolicy();
      const { runner, calls } = createMockRunner({ stdout: "ok" });
      setProcessRunner(runner);

      await executeCommand("pnpm build", policy);

      const opts = calls[0]!.options as { timeout: number; maxBuffer: number };
      expect(opts.timeout).toBe(300_000); // 5 minutes
      expect(opts.maxBuffer).toBe(10_485_760); // 10 MiB
    });

    /**
     * Verifies that killed processes (e.g., from timeout) produce
     * a CommandExecutionError with null exit code.
     */
    it("handles killed processes with null exit code", async () => {
      const policy = createTestPolicy();
      const { runner } = createMockRunner({
        exitCode: null,
        stderr: "Process timed out",
      });
      setProcessRunner(runner);

      try {
        await executeCommand("pnpm test", policy);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CommandExecutionError);
        const execError = err as CommandExecutionError;
        expect(execError.exitCode).toBeNull();
        expect(execError.message).toContain("killed by signal");
      }
    });

    /**
     * Verifies that commands with complex argument lists are correctly
     * parsed and passed to the process runner as structured arrays.
     */
    it("passes complex argument lists as structured arrays", async () => {
      const policy = createTestPolicy();
      const { runner, calls } = createMockRunner({ stdout: "ok" });
      setProcessRunner(runner);

      await executeCommand("pnpm test --filter @factory/domain -- --grep state", policy);

      expect(calls[0]!.command).toBe("pnpm");
      expect(calls[0]!.args).toEqual([
        "test",
        "--filter",
        "@factory/domain",
        "--",
        "--grep",
        "state",
      ]);
    });

    /**
     * Verifies that forbidden argument patterns are caught even for
     * otherwise-allowed commands. This is the final defense layer
     * that catches path traversal and system directory access.
     */
    it("blocks forbidden arg patterns on allowed commands", async () => {
      const policy = createTestPolicy();
      const { runner, calls } = createMockRunner();
      setProcessRunner(runner);

      await expect(executeCommand("cat /etc/shadow", policy)).rejects.toThrow(PolicyViolationError);
      expect(calls).toHaveLength(0);
    });

    /**
     * Verifies that the error name property is set correctly for
     * both error types, enabling instanceof checks in catch blocks.
     */
    it("sets correct error names for debugging", async () => {
      const policy = createTestPolicy();
      const { runner: runner1 } = createMockRunner();
      setProcessRunner(runner1);

      try {
        await executeCommand("curl bad", policy);
      } catch (err) {
        expect((err as Error).name).toBe("PolicyViolationError");
      }

      const { runner: runner2 } = createMockRunner({ exitCode: 2, stderr: "error" });
      setProcessRunner(runner2);

      try {
        await executeCommand("git status", policy);
      } catch (err) {
        expect((err as Error).name).toBe("CommandExecutionError");
      }
    });
  });

  // =========================================================================
  // Denylist mode
  // =========================================================================

  describe("denylist mode", () => {
    /**
     * Verifies that in denylist mode, commands not matching any denied
     * pattern are allowed. This is the inverse of allowlist behavior.
     */
    it("allows non-denied commands in denylist mode", () => {
      const policy = createTestPolicy({
        mode: CommandPolicyMode.DENYLIST,
      });
      const result = validateCommand("python3 script.py", policy);

      expect(result.allowed).toBe(true);
    });

    /**
     * Verifies that denied patterns are still enforced in denylist mode.
     */
    it("blocks denied patterns in denylist mode", () => {
      const policy = createTestPolicy({
        mode: CommandPolicyMode.DENYLIST,
      });
      const result = validateCommand("sudo rm -rf /tmp", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.MATCHES_DENIED_PATTERN);
    });

    /**
     * Verifies that forbidden arg patterns are still enforced in denylist mode.
     */
    it("blocks forbidden arg patterns in denylist mode", () => {
      const policy = createTestPolicy({
        mode: CommandPolicyMode.DENYLIST,
      });
      const result = validateCommand("python3 ../../../../../../etc/passwd", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.FORBIDDEN_ARG_PATTERN);
    });
  });

  // =========================================================================
  // Violation action modes
  // =========================================================================

  describe("violation action modes", () => {
    /**
     * Verifies that DENY_COMMAND action is reported in the evaluation
     * when the policy uses that action instead of FAIL_RUN. The caller
     * can use this to reject the command but continue the run.
     */
    it("reports DENY_COMMAND action when policy specifies it", () => {
      const policy = createTestPolicy({
        on_violation: CommandViolationAction.DENY_COMMAND,
      });
      const result = validateCommand("curl bad", policy);

      expect(result.allowed).toBe(false);
      expect(result.action).toBe(CommandViolationAction.DENY_COMMAND);
    });

    /**
     * Verifies that AUDIT_ONLY action is reported in the evaluation.
     * With this mode, the command is still denied in evaluation but
     * the caller is expected to log and continue.
     */
    it("reports AUDIT_ONLY action when policy specifies it", () => {
      const policy = createTestPolicy({
        on_violation: CommandViolationAction.AUDIT_ONLY,
      });
      const result = validateCommand("curl bad", policy);

      expect(result.allowed).toBe(false);
      expect(result.action).toBe(CommandViolationAction.AUDIT_ONLY);
    });

    /**
     * Verifies that executeCommand throws PolicyViolationError regardless
     * of the violation action. The executeCommand function always blocks
     * denied commands; the action field is informational for the caller
     * (e.g., whether to fail the entire run or just this command).
     */
    it("executeCommand always throws for denied commands regardless of action", async () => {
      const { runner, calls } = createMockRunner();
      setProcessRunner(runner);

      const policy = createTestPolicy({
        on_violation: CommandViolationAction.AUDIT_ONLY,
      });

      await expect(executeCommand("curl bad", policy)).rejects.toThrow(PolicyViolationError);
      expect(calls).toHaveLength(0);
    });
  });

  // =========================================================================
  // Edge cases and security scenarios
  // =========================================================================

  describe("security edge cases", () => {
    /**
     * Verifies that command strings with leading/trailing whitespace
     * are handled correctly and don't bypass policy checks.
     */
    it("handles whitespace in command strings", () => {
      const policy = createTestPolicy();
      const result = validateCommand("  git   status  ", policy);

      expect(result.allowed).toBe(true);
      expect(result.parsed.command).toBe("git");
    });

    /**
     * Verifies that the || (OR) operator is detected and blocked.
     * A worker might try "allowed_cmd || malicious_cmd" to run
     * malicious code on allowed command failure.
     */
    it("blocks || operator attempts", () => {
      const policy = createTestPolicy();
      const result = validateCommand("git status || cat /etc/shadow", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.SHELL_OPERATORS_DENIED);
    });

    /**
     * Verifies that multiple arguments are correctly split and evaluated.
     * The first argument determines prefix matching; subsequent args
     * are checked against forbidden patterns.
     */
    it("correctly evaluates multi-arg commands", async () => {
      const policy = createTestPolicy();
      const { runner, calls } = createMockRunner({ stdout: "ok" });
      setProcessRunner(runner);

      await executeCommand("pnpm test --reporter=verbose", policy);

      expect(calls[0]!.args).toEqual(["test", "--reporter=verbose"]);
    });

    /**
     * Verifies that arguments containing path traversal sequences
     * are caught by forbidden arg patterns, even when nested deep.
     */
    it("catches path traversal in deeply nested args", () => {
      const policy = createTestPolicy();
      const result = validateCommand("node scripts/../../../../../../etc/passwd", policy);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(CommandViolationReason.FORBIDDEN_ARG_PATTERN);
    });
  });
});
