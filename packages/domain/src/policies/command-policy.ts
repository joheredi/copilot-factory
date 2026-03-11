/**
 * Command policy model and enforcement for the Autonomous Software Factory.
 *
 * Implements the command execution governance from PRD §9.3 (Command Policy).
 * The command policy defines what a worker is allowed to execute and how
 * violations are handled. It operates in allowlist mode by default (deny-by-default),
 * meaning only explicitly permitted commands may run.
 *
 * Key design decisions:
 * - Allowlist-first: commands must be explicitly allowed, not just not-denied
 * - Argument prefix matching: allowed commands specify permitted argument prefixes
 * - Denied patterns catch dangerous commands that slip through the allowlist
 * - Forbidden argument patterns provide a second line of defense on arguments
 * - Shell compound operators (&&, ||, |, ;) are denied by default
 * - Policy violations produce structured results for audit logging
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.3 — Command Policy
 * @module @factory/domain/policies/command-policy
 */

// ---------------------------------------------------------------------------
// Policy mode
// ---------------------------------------------------------------------------

/**
 * Command policy enforcement mode.
 *
 * - `allowlist`: Only commands explicitly listed in `allowed_commands` may run.
 *   This is the default and recommended mode for production (deny-by-default).
 * - `denylist`: All commands may run unless they match a `denied_patterns` entry.
 *   Useful for development/experimentation but less secure.
 */
export const CommandPolicyMode = {
  ALLOWLIST: "allowlist",
  DENYLIST: "denylist",
} as const;

/** Union of all valid command policy mode values. */
export type CommandPolicyMode = (typeof CommandPolicyMode)[keyof typeof CommandPolicyMode];

// ---------------------------------------------------------------------------
// Violation action
// ---------------------------------------------------------------------------

/**
 * Action taken when a command violates policy.
 *
 * - `fail_run`: Immediately fail the entire worker run (default, strictest).
 * - `deny_command`: Reject this command but allow the run to continue.
 * - `audit_only`: Log the violation but allow the command to execute.
 */
export const CommandViolationAction = {
  FAIL_RUN: "fail_run",
  DENY_COMMAND: "deny_command",
  AUDIT_ONLY: "audit_only",
} as const;

/** Union of all valid command violation action values. */
export type CommandViolationAction =
  (typeof CommandViolationAction)[keyof typeof CommandViolationAction];

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/**
 * An allowed command rule defining a base command and its permitted argument prefixes.
 *
 * When mode is `allowlist`, only commands matching an AllowedCommand entry
 * are permitted. The `arg_prefixes` field restricts which argument patterns
 * are valid — if empty, any arguments are allowed for this command.
 *
 * @example
 * ```ts
 * const gitRule: AllowedCommand = {
 *   command: "git",
 *   arg_prefixes: ["status", "diff", "show", "add", "commit", "checkout", "branch"],
 * };
 * // Allows: git status, git diff --cached, git add .
 * // Denies: git push, git remote add, git reset --hard
 * ```
 */
export interface AllowedCommand {
  /** The base command name (e.g., "git", "pnpm", "node"). */
  readonly command: string;
  /**
   * Permitted argument prefixes. Each prefix is matched against the first
   * argument token. If empty, any arguments are allowed for this command.
   *
   * @example ["install", "test", "lint", "build"] for pnpm
   */
  readonly arg_prefixes: readonly string[];
}

/**
 * A pattern that matches denied commands. Matched against the full
 * command string (command + arguments joined by spaces).
 *
 * Patterns support simple glob-style wildcards:
 * - `*` matches any sequence of characters within the string
 * - Matching is case-sensitive
 *
 * @example "rm -rf /" — blocks recursive root deletion
 * @example "curl * | sh" — blocks piped remote execution
 */
export interface DeniedPattern {
  /** The pattern string to match against the full command line. */
  readonly pattern: string;
  /** Human-readable reason why this pattern is denied. */
  readonly reason: string;
}

/**
 * A pattern matched against individual arguments across all commands.
 * Provides a second layer of defense beyond command-level allowlisting.
 *
 * @example Pattern "../../" blocks path traversal attempts in any argument
 */
export interface ForbiddenArgPattern {
  /** Regex pattern string matched against each argument token. */
  readonly pattern: string;
  /** Human-readable reason why this argument pattern is forbidden. */
  readonly reason: string;
}

/**
 * Complete command policy definition per PRD §9.3.
 *
 * The command policy controls what a worker is allowed to execute.
 * It is resolved by the configuration layer and included in the
 * effective policy snapshot for each run.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.3
 */
export interface CommandPolicy {
  /** Enforcement mode: allowlist (deny-by-default) or denylist (allow-by-default). */
  readonly mode: CommandPolicyMode;

  /**
   * Allowed commands with their argument prefix restrictions.
   * Only used in allowlist mode. Commands not in this list are denied.
   */
  readonly allowed_commands: readonly AllowedCommand[];

  /**
   * Patterns that are always denied, regardless of mode.
   * Matched against the full command string (command + args).
   * Evaluated AFTER allowlist matching — catches dangerous combinations
   * that might slip through individual command rules.
   */
  readonly denied_patterns: readonly DeniedPattern[];

  /**
   * Patterns matched against individual argument tokens across all commands.
   * Evaluated after allowlist and denied_patterns checks.
   */
  readonly forbidden_arg_patterns: readonly ForbiddenArgPattern[];

  /**
   * Whether shell compound operators (&&, ||, |, ;, $(), ``) are allowed.
   * Default: false (disabled for security).
   */
  readonly allow_shell_operators: boolean;

  /** Action to take when a policy violation occurs. */
  readonly on_violation: CommandViolationAction;
}

// ---------------------------------------------------------------------------
// Parsed command
// ---------------------------------------------------------------------------

/**
 * A parsed representation of a raw command string, separated into
 * the base command and its argument tokens.
 */
export interface ParsedCommand {
  /** The base command (first token, e.g., "git", "pnpm"). */
  readonly command: string;
  /** The remaining argument tokens after the base command. */
  readonly args: readonly string[];
  /** The original raw command string before parsing. */
  readonly raw: string;
}

// ---------------------------------------------------------------------------
// Evaluation result
// ---------------------------------------------------------------------------

/**
 * Reason categories for command policy violations.
 */
export const CommandViolationReason = {
  /** Command not found in allowlist. */
  NOT_IN_ALLOWLIST: "not_in_allowlist",
  /** Argument prefix not permitted for this command. */
  ARG_PREFIX_NOT_ALLOWED: "arg_prefix_not_allowed",
  /** Full command matches a denied pattern. */
  MATCHES_DENIED_PATTERN: "matches_denied_pattern",
  /** An argument matches a forbidden argument pattern. */
  FORBIDDEN_ARG_PATTERN: "forbidden_arg_pattern",
  /** Command contains shell compound operators that are not allowed. */
  SHELL_OPERATORS_DENIED: "shell_operators_denied",
  /** Command string is empty or could not be parsed. */
  INVALID_COMMAND: "invalid_command",
} as const;

/** Union of all valid command violation reason values. */
export type CommandViolationReason =
  (typeof CommandViolationReason)[keyof typeof CommandViolationReason];

/**
 * Result of evaluating a command against a command policy.
 *
 * Contains the allow/deny decision, the violation reason (if denied),
 * a human-readable explanation, and the prescribed action.
 */
export interface CommandPolicyEvaluation {
  /** Whether the command is allowed to execute. */
  readonly allowed: boolean;
  /** The violation reason, if the command is denied. */
  readonly reason?: CommandViolationReason;
  /** Human-readable explanation of the decision. */
  readonly explanation: string;
  /** The action to take (from the policy's on_violation setting). Only set when denied. */
  readonly action?: CommandViolationAction;
  /** The parsed command that was evaluated. */
  readonly parsed: ParsedCommand;
}

// ---------------------------------------------------------------------------
// Shell operator detection
// ---------------------------------------------------------------------------

/**
 * Shell compound operators and dangerous constructs that are blocked
 * when `allow_shell_operators` is false.
 *
 * These are matched as substrings in the raw command string.
 * Order matters: longer patterns are checked first to avoid
 * false positives (e.g., "&&" before "&").
 */
const SHELL_OPERATORS: readonly string[] = [
  "&&",
  "||",
  "$(", // command substitution
  "`", // backtick command substitution
  " | ", // pipe (with spaces to avoid matching in file paths)
  ";", // command separator
];

/**
 * Check whether a raw command string contains shell compound operators.
 *
 * @param raw - The raw command string to check.
 * @returns true if shell operators are detected.
 */
function containsShellOperators(raw: string): boolean {
  return SHELL_OPERATORS.some((op) => raw.includes(op));
}

// ---------------------------------------------------------------------------
// Command parsing
// ---------------------------------------------------------------------------

/**
 * Parse a raw command string into its base command and argument tokens.
 *
 * Handles simple whitespace-delimited tokenization. Does not handle
 * quoted strings or escape sequences — commands passed to workers
 * should be simple, single commands without shell quoting.
 *
 * @param raw - The raw command string (e.g., "git status --porcelain").
 * @returns The parsed command with base command and argument tokens.
 */
export function parseCommandString(raw: string): ParsedCommand {
  const trimmed = raw.trim();
  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);

  if (tokens.length === 0) {
    return { command: "", args: [], raw: trimmed };
  }

  return {
    command: tokens[0]!,
    args: tokens.slice(1),
    raw: trimmed,
  };
}

// ---------------------------------------------------------------------------
// Glob-style pattern matching
// ---------------------------------------------------------------------------

/**
 * Match a string against a simple glob pattern where `*` matches
 * any sequence of characters.
 *
 * This is intentionally simple — only `*` wildcards are supported.
 * The match is case-sensitive and operates on the full string.
 *
 * @param text - The string to test.
 * @param pattern - The glob pattern (e.g., "curl * | sh").
 * @returns true if the text matches the pattern.
 */
function globMatch(text: string, pattern: string): boolean {
  // Escape regex special characters except *, then replace * with .*
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(text);
}

// ---------------------------------------------------------------------------
// Policy evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a raw command string against a command policy.
 *
 * Evaluation order (short-circuits on first violation):
 * 1. Parse the command string; reject if empty/invalid
 * 2. Check for shell operators (if disallowed)
 * 3. Check denied patterns against the full command string
 * 4. In allowlist mode: check command is in allowlist with valid arg prefix
 *    In denylist mode: command is allowed if it didn't match denied patterns
 * 5. Check forbidden argument patterns against each argument token
 *
 * @param rawCommand - The full command string to evaluate (e.g., "pnpm test").
 * @param policy - The command policy to evaluate against.
 * @returns A structured evaluation result with allow/deny decision and reason.
 *
 * @example
 * ```ts
 * const result = evaluateCommandPolicy("git status", myPolicy);
 * if (!result.allowed) {
 *   console.log(`Denied: ${result.explanation}`);
 * }
 * ```
 */
export function evaluateCommandPolicy(
  rawCommand: string,
  policy: CommandPolicy,
): CommandPolicyEvaluation {
  const parsed = parseCommandString(rawCommand);

  // Step 1: Reject empty/invalid commands
  if (parsed.command === "") {
    return {
      allowed: false,
      reason: CommandViolationReason.INVALID_COMMAND,
      explanation: "Command string is empty or contains only whitespace.",
      action: policy.on_violation,
      parsed,
    };
  }

  // Step 2: Check shell operators
  if (!policy.allow_shell_operators && containsShellOperators(parsed.raw)) {
    return {
      allowed: false,
      reason: CommandViolationReason.SHELL_OPERATORS_DENIED,
      explanation: `Command contains shell compound operators which are not allowed by policy: "${parsed.raw}"`,
      action: policy.on_violation,
      parsed,
    };
  }

  // Step 3: Check denied patterns (always applies, regardless of mode)
  for (const denied of policy.denied_patterns) {
    if (globMatch(parsed.raw, denied.pattern)) {
      return {
        allowed: false,
        reason: CommandViolationReason.MATCHES_DENIED_PATTERN,
        explanation: `Command matches denied pattern "${denied.pattern}": ${denied.reason}`,
        action: policy.on_violation,
        parsed,
      };
    }
  }

  // Step 4: Mode-specific checks
  if (policy.mode === CommandPolicyMode.ALLOWLIST) {
    const matchingRule = policy.allowed_commands.find((rule) => rule.command === parsed.command);

    if (!matchingRule) {
      return {
        allowed: false,
        reason: CommandViolationReason.NOT_IN_ALLOWLIST,
        explanation: `Command "${parsed.command}" is not in the allowlist.`,
        action: policy.on_violation,
        parsed,
      };
    }

    // Check argument prefix if the rule restricts arguments
    if (matchingRule.arg_prefixes.length > 0 && parsed.args.length > 0) {
      const firstArg = parsed.args[0]!;
      const prefixMatch = matchingRule.arg_prefixes.some((prefix) => firstArg.startsWith(prefix));

      if (!prefixMatch) {
        return {
          allowed: false,
          reason: CommandViolationReason.ARG_PREFIX_NOT_ALLOWED,
          explanation: `Argument "${firstArg}" does not match any allowed prefix for command "${parsed.command}". Allowed prefixes: ${matchingRule.arg_prefixes.join(", ")}`,
          action: policy.on_violation,
          parsed,
        };
      }
    }
  }
  // In denylist mode, if we reach here the command passed denied patterns check

  // Step 5: Check forbidden argument patterns
  for (const forbidden of policy.forbidden_arg_patterns) {
    const regex = new RegExp(forbidden.pattern);
    for (const arg of parsed.args) {
      if (regex.test(arg)) {
        return {
          allowed: false,
          reason: CommandViolationReason.FORBIDDEN_ARG_PATTERN,
          explanation: `Argument "${arg}" matches forbidden pattern "${forbidden.pattern}": ${forbidden.reason}`,
          action: policy.on_violation,
          parsed,
        };
      }
    }
  }

  // All checks passed
  return {
    allowed: true,
    explanation: `Command "${parsed.raw}" is allowed by policy.`,
    parsed,
  };
}
