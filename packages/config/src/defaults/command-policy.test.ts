/**
 * Tests for default V1 command policy and policy merging.
 *
 * Validates that:
 * 1. The default policy provides a usable set of allowed commands for workers
 * 2. The default policy blocks known dangerous operations
 * 3. Policy merging correctly applies overrides per configuration precedence
 * 4. Merging follows last-writer-wins semantics for each field
 *
 * These tests ensure the default policy is neither too permissive (security risk)
 * nor too restrictive (blocks legitimate worker operations). The merge tests
 * validate hierarchical configuration resolution from PRD §9.12.
 *
 * @module @factory/config/defaults/command-policy.test
 */

import { describe, it, expect } from "vitest";

import { CommandPolicyMode, CommandViolationAction, evaluateCommandPolicy } from "@factory/domain";

import { DEFAULT_COMMAND_POLICY, mergeCommandPolicies } from "./command-policy.js";

import type { CommandPolicyOverride } from "./command-policy.js";

// ---------------------------------------------------------------------------
// DEFAULT_COMMAND_POLICY structure
// ---------------------------------------------------------------------------

describe("DEFAULT_COMMAND_POLICY", () => {
  /**
   * The default policy must use allowlist mode (deny-by-default).
   * This is the most secure default — workers can only run explicitly
   * permitted commands.
   */
  it("uses allowlist mode", () => {
    expect(DEFAULT_COMMAND_POLICY.mode).toBe(CommandPolicyMode.ALLOWLIST);
  });

  /**
   * Shell operators must be disabled by default. Allowing them would
   * let workers chain arbitrary commands, bypassing per-command checks.
   */
  it("disables shell operators", () => {
    expect(DEFAULT_COMMAND_POLICY.allow_shell_operators).toBe(false);
  });

  /**
   * Violations should fail the entire run by default. This is the
   * strictest response and appropriate for production safety.
   */
  it("uses fail_run as violation action", () => {
    expect(DEFAULT_COMMAND_POLICY.on_violation).toBe(CommandViolationAction.FAIL_RUN);
  });

  /**
   * The default policy must have non-empty lists for all three
   * defense layers: allowed commands, denied patterns, and forbidden args.
   */
  it("has non-empty allowed commands, denied patterns, and forbidden arg patterns", () => {
    expect(DEFAULT_COMMAND_POLICY.allowed_commands.length).toBeGreaterThan(0);
    expect(DEFAULT_COMMAND_POLICY.denied_patterns.length).toBeGreaterThan(0);
    expect(DEFAULT_COMMAND_POLICY.forbidden_arg_patterns.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_COMMAND_POLICY — allowed development commands
// ---------------------------------------------------------------------------

describe("DEFAULT_COMMAND_POLICY — allows development commands", () => {
  /**
   * Workers must be able to run pnpm package management operations
   * like install, test, build, and lint. These are the primary
   * development workflow commands.
   */
  it("allows pnpm install", () => {
    const result = evaluateCommandPolicy("pnpm install", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(true);
  });

  it("allows pnpm test", () => {
    const result = evaluateCommandPolicy("pnpm test", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(true);
  });

  it("allows pnpm build", () => {
    const result = evaluateCommandPolicy("pnpm build", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(true);
  });

  it("allows pnpm lint", () => {
    const result = evaluateCommandPolicy("pnpm lint", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(true);
  });

  /**
   * Workers must be able to use safe git operations for version control.
   * These include reading state and making commits but NOT pushing.
   */
  it("allows git status", () => {
    const result = evaluateCommandPolicy("git status", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(true);
  });

  it("allows git diff", () => {
    const result = evaluateCommandPolicy("git diff --cached", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(true);
  });

  it("allows git add", () => {
    const result = evaluateCommandPolicy("git add .", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(true);
  });

  it("allows git commit", () => {
    const result = evaluateCommandPolicy("git commit -m fix: typo", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(true);
  });

  /**
   * TypeScript compiler should be allowed for type checking.
   */
  it("allows tsc", () => {
    const result = evaluateCommandPolicy("tsc --noEmit", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(true);
  });

  /**
   * Node.js should be allowed for running scripts.
   */
  it("allows node", () => {
    const result = evaluateCommandPolicy("node dist/index.js", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_COMMAND_POLICY — blocks dangerous commands
// ---------------------------------------------------------------------------

describe("DEFAULT_COMMAND_POLICY — blocks dangerous commands", () => {
  /**
   * Git push is NOT in the allowed arg prefixes for git.
   * Workers should not be able to push directly — the merge queue
   * handles all pushes through the control plane.
   */
  it("blocks git push", () => {
    const result = evaluateCommandPolicy("git push origin main", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(false);
  });

  /**
   * git reset --hard can destroy work and should not be allowed.
   */
  it("blocks git reset", () => {
    const result = evaluateCommandPolicy("git reset --hard HEAD~1", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(false);
  });

  /**
   * curl is not in the allowlist — workers should not make HTTP requests.
   */
  it("blocks curl", () => {
    const result = evaluateCommandPolicy("curl https://example.com", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(false);
  });

  /**
   * wget is not in the allowlist.
   */
  it("blocks wget", () => {
    const result = evaluateCommandPolicy("wget https://example.com", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(false);
  });

  /**
   * sudo must be caught by denied patterns.
   */
  it("blocks sudo", () => {
    const result = evaluateCommandPolicy("sudo apt install", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(false);
  });

  /**
   * ssh must be caught by denied patterns.
   */
  it("blocks ssh", () => {
    const result = evaluateCommandPolicy("ssh user@host", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(false);
  });

  /**
   * Recursive root deletion must be blocked by denied patterns.
   */
  it("blocks rm -rf /", () => {
    const result = evaluateCommandPolicy("rm -rf /", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(false);
  });

  /**
   * Shell compound operators should be blocked.
   */
  it("blocks shell operators", () => {
    const result = evaluateCommandPolicy("pnpm test && curl evil.com", DEFAULT_COMMAND_POLICY);
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mergeCommandPolicies
// ---------------------------------------------------------------------------

describe("mergeCommandPolicies", () => {
  /**
   * An empty override should return the base policy unchanged.
   * This is the identity case for merging.
   */
  it("returns base policy when override is empty", () => {
    const result = mergeCommandPolicies(DEFAULT_COMMAND_POLICY, {});
    expect(result).toEqual(DEFAULT_COMMAND_POLICY);
  });

  /**
   * Scalar fields (mode, allow_shell_operators, on_violation) should
   * be replaced by the override value.
   */
  it("overrides scalar fields", () => {
    const override: CommandPolicyOverride = {
      mode: CommandPolicyMode.DENYLIST,
      allow_shell_operators: true,
      on_violation: CommandViolationAction.AUDIT_ONLY,
    };
    const result = mergeCommandPolicies(DEFAULT_COMMAND_POLICY, override);
    expect(result.mode).toBe(CommandPolicyMode.DENYLIST);
    expect(result.allow_shell_operators).toBe(true);
    expect(result.on_violation).toBe(CommandViolationAction.AUDIT_ONLY);
  });

  /**
   * Array fields (allowed_commands, denied_patterns, forbidden_arg_patterns)
   * should be replaced wholesale, not merged. This follows last-writer-wins
   * semantics from §9.12.
   */
  it("replaces array fields wholesale", () => {
    const customCommands = [{ command: "python", arg_prefixes: [] }];
    const override: CommandPolicyOverride = {
      allowed_commands: customCommands,
    };
    const result = mergeCommandPolicies(DEFAULT_COMMAND_POLICY, override);
    expect(result.allowed_commands).toEqual(customCommands);
    // Other arrays should remain from base
    expect(result.denied_patterns).toEqual(DEFAULT_COMMAND_POLICY.denied_patterns);
  });

  /**
   * Fields not in the override should be preserved from the base.
   * This ensures partial overrides don't wipe out the entire policy.
   */
  it("preserves base fields not in override", () => {
    const override: CommandPolicyOverride = {
      on_violation: CommandViolationAction.DENY_COMMAND,
    };
    const result = mergeCommandPolicies(DEFAULT_COMMAND_POLICY, override);
    expect(result.mode).toBe(DEFAULT_COMMAND_POLICY.mode);
    expect(result.allowed_commands).toBe(DEFAULT_COMMAND_POLICY.allowed_commands);
    expect(result.denied_patterns).toBe(DEFAULT_COMMAND_POLICY.denied_patterns);
    expect(result.forbidden_arg_patterns).toBe(DEFAULT_COMMAND_POLICY.forbidden_arg_patterns);
    expect(result.allow_shell_operators).toBe(DEFAULT_COMMAND_POLICY.allow_shell_operators);
  });

  /**
   * A merged policy should be fully functional — evaluateCommandPolicy
   * should work with it. This validates that merging produces valid policies.
   */
  it("produces a functional policy after merge", () => {
    const override: CommandPolicyOverride = {
      allowed_commands: [
        ...DEFAULT_COMMAND_POLICY.allowed_commands,
        { command: "python", arg_prefixes: [] },
      ],
    };
    const merged = mergeCommandPolicies(DEFAULT_COMMAND_POLICY, override);

    // Original commands still work
    const gitResult = evaluateCommandPolicy("git status", merged);
    expect(gitResult.allowed).toBe(true);

    // New command works
    const pythonResult = evaluateCommandPolicy("python script.py", merged);
    expect(pythonResult.allowed).toBe(true);

    // Unlisted commands still blocked
    const curlResult = evaluateCommandPolicy("curl evil.com", merged);
    expect(curlResult.allowed).toBe(false);
  });

  /**
   * Overriding denied_patterns should replace the entire list.
   * A project that needs sudo for specific tasks can remove the sudo pattern.
   */
  it("replaces denied_patterns entirely", () => {
    const override: CommandPolicyOverride = {
      denied_patterns: [{ pattern: "rm -rf /", reason: "Still dangerous" }],
    };
    const merged = mergeCommandPolicies(DEFAULT_COMMAND_POLICY, override);
    expect(merged.denied_patterns).toHaveLength(1);
    expect(merged.denied_patterns[0].pattern).toBe("rm -rf /");
  });
});
