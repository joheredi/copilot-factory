/**
 * Default V1 command policy and policy merging utilities.
 *
 * Provides the baseline command policy for the Autonomous Software Factory.
 * The default policy uses allowlist mode with a curated set of commands
 * that development workers commonly need, along with denied patterns
 * that catch dangerous operations.
 *
 * The merge function enables hierarchical configuration resolution —
 * base defaults can be overridden at the organization, project, repository,
 * or task level per PRD §9.12 (Configuration Precedence).
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.3 — Command Policy
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12 — Configuration Precedence
 * @module @factory/config/defaults/command-policy
 */

import type {
  AllowedCommand,
  CommandPolicy,
  CommandViolationAction,
  DeniedPattern,
  ForbiddenArgPattern,
} from "@factory/domain";

import { CommandPolicyMode, CommandViolationAction as CVA } from "@factory/domain";

// ---------------------------------------------------------------------------
// Default allowed commands
// ---------------------------------------------------------------------------

/**
 * Default allowed commands for V1 development workers.
 *
 * This allowlist balances security with practical developer needs.
 * Workers need package management, version control, testing, and
 * basic file inspection capabilities.
 */
const DEFAULT_ALLOWED_COMMANDS: readonly AllowedCommand[] = [
  // Package management — install, test, lint, build, format, run
  {
    command: "pnpm",
    arg_prefixes: ["install", "test", "lint", "build", "format", "run", "exec", "--filter"],
  },
  {
    command: "npm",
    arg_prefixes: ["install", "test", "run", "exec", "ci"],
  },
  {
    command: "npx",
    arg_prefixes: [],
  },

  // Version control — read operations and safe write operations
  {
    command: "git",
    arg_prefixes: [
      "status",
      "diff",
      "show",
      "add",
      "commit",
      "checkout",
      "branch",
      "log",
      "rev-parse",
      "ls-files",
      "stash",
      "worktree",
    ],
  },

  // TypeScript compiler — type checking and building
  {
    command: "tsc",
    arg_prefixes: [],
  },

  // Node.js — running scripts directly
  {
    command: "node",
    arg_prefixes: [],
  },

  // Basic file inspection — safe read-only commands
  {
    command: "cat",
    arg_prefixes: [],
  },
  {
    command: "ls",
    arg_prefixes: [],
  },
  {
    command: "find",
    arg_prefixes: [],
  },
  {
    command: "grep",
    arg_prefixes: [],
  },
  {
    command: "head",
    arg_prefixes: [],
  },
  {
    command: "tail",
    arg_prefixes: [],
  },
  {
    command: "wc",
    arg_prefixes: [],
  },

  // Directory navigation
  {
    command: "mkdir",
    arg_prefixes: [],
  },

  // Diff/patch tooling
  {
    command: "diff",
    arg_prefixes: [],
  },
];

// ---------------------------------------------------------------------------
// Default denied patterns
// ---------------------------------------------------------------------------

/**
 * Default denied patterns that catch dangerous operations.
 *
 * These patterns are evaluated against the full command string and
 * take precedence in both allowlist and denylist modes.
 */
const DEFAULT_DENIED_PATTERNS: readonly DeniedPattern[] = [
  {
    pattern: "rm -rf /",
    reason: "Recursive deletion of filesystem root is catastrophically dangerous.",
  },
  {
    pattern: "rm -rf /*",
    reason: "Recursive deletion of all root-level directories is catastrophically dangerous.",
  },
  {
    pattern: "rm -rf ~",
    reason: "Recursive deletion of home directory is catastrophically dangerous.",
  },
  {
    pattern: "rm -rf ~/*",
    reason: "Recursive deletion of all home directory contents is catastrophically dangerous.",
  },
  {
    pattern: "curl * | sh",
    reason: "Piping remote content to a shell is a remote code execution vector.",
  },
  {
    pattern: "curl * | bash",
    reason: "Piping remote content to bash is a remote code execution vector.",
  },
  {
    pattern: "wget * | sh",
    reason: "Piping remote content to a shell is a remote code execution vector.",
  },
  {
    pattern: "wget * | bash",
    reason: "Piping remote content to bash is a remote code execution vector.",
  },
  {
    pattern: "sudo *",
    reason: "Elevated privilege execution is not permitted for workers.",
  },
  {
    pattern: "ssh *",
    reason: "SSH connections are not permitted for workers.",
  },
  {
    pattern: "scp *",
    reason: "SCP file transfers are not permitted for workers.",
  },
  {
    pattern: "chmod 777 *",
    reason: "World-writable permissions are a security risk.",
  },
  {
    pattern: "eval *",
    reason: "Dynamic code evaluation is not permitted for workers.",
  },
];

// ---------------------------------------------------------------------------
// Default forbidden argument patterns
// ---------------------------------------------------------------------------

/**
 * Default forbidden argument patterns that catch dangerous argument values
 * across all commands, regardless of whether the command itself is allowed.
 */
const DEFAULT_FORBIDDEN_ARG_PATTERNS: readonly ForbiddenArgPattern[] = [
  {
    pattern: "^\\.\\./\\.\\./\\.\\./",
    reason: "Deep path traversal (3+ levels) may escape workspace boundaries.",
  },
  {
    pattern: "^/etc/",
    reason: "Direct access to system configuration is not permitted.",
  },
  {
    pattern: "^/proc/",
    reason: "Direct access to process filesystem is not permitted.",
  },
  {
    pattern: "^/sys/",
    reason: "Direct access to system filesystem is not permitted.",
  },
];

// ---------------------------------------------------------------------------
// Default command policy
// ---------------------------------------------------------------------------

/**
 * The default V1 command policy.
 *
 * Uses allowlist mode with a curated set of development commands.
 * Shell operators are disabled, and violations fail the run.
 * This provides a secure baseline that can be relaxed per-project
 * through hierarchical configuration overrides.
 */
export const DEFAULT_COMMAND_POLICY: CommandPolicy = {
  mode: CommandPolicyMode.ALLOWLIST,
  allowed_commands: DEFAULT_ALLOWED_COMMANDS,
  denied_patterns: DEFAULT_DENIED_PATTERNS,
  forbidden_arg_patterns: DEFAULT_FORBIDDEN_ARG_PATTERNS,
  allow_shell_operators: false,
  on_violation: CVA.FAIL_RUN,
};

// ---------------------------------------------------------------------------
// Policy override type
// ---------------------------------------------------------------------------

/**
 * A partial command policy override.
 *
 * Used in hierarchical configuration resolution. Each level in the
 * configuration hierarchy (system → org → project → repo → task)
 * can provide a partial override that is merged with the base policy.
 *
 * Arrays are replaced wholesale (not merged element-by-element) to
 * maintain clear semantics — if a level overrides `allowed_commands`,
 * it replaces the entire list, not appends to it.
 */
export interface CommandPolicyOverride {
  readonly mode?: CommandPolicy["mode"];
  readonly allowed_commands?: CommandPolicy["allowed_commands"];
  readonly denied_patterns?: CommandPolicy["denied_patterns"];
  readonly forbidden_arg_patterns?: CommandPolicy["forbidden_arg_patterns"];
  readonly allow_shell_operators?: CommandPolicy["allow_shell_operators"];
  readonly on_violation?: CommandViolationAction;
}

// ---------------------------------------------------------------------------
// Policy merging
// ---------------------------------------------------------------------------

/**
 * Merge a base command policy with an override.
 *
 * Override fields replace base fields when present. Arrays (allowed_commands,
 * denied_patterns, forbidden_arg_patterns) are replaced wholesale, not merged.
 * This follows the "last-writer-wins per field" semantics from §9.12.
 *
 * @param base - The base policy to start from.
 * @param override - Partial override to apply on top of the base.
 * @returns A new CommandPolicy with the override applied.
 *
 * @example
 * ```ts
 * const projectPolicy = mergeCommandPolicies(DEFAULT_COMMAND_POLICY, {
 *   allowed_commands: [...DEFAULT_COMMAND_POLICY.allowed_commands, myExtraCommand],
 *   on_violation: CommandViolationAction.DENY_COMMAND,
 * });
 * ```
 */
export function mergeCommandPolicies(
  base: CommandPolicy,
  override: CommandPolicyOverride,
): CommandPolicy {
  return {
    mode: override.mode ?? base.mode,
    allowed_commands: override.allowed_commands ?? base.allowed_commands,
    denied_patterns: override.denied_patterns ?? base.denied_patterns,
    forbidden_arg_patterns: override.forbidden_arg_patterns ?? base.forbidden_arg_patterns,
    allow_shell_operators: override.allow_shell_operators ?? base.allow_shell_operators,
    on_violation: override.on_violation ?? base.on_violation,
  };
}
