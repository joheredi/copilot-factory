/**
 * Validation policy model and profile selection for the Autonomous Software Factory.
 *
 * Implements the validation governance from PRD §9.5 (Validation Policy).
 * The validation policy defines which checks are required at each stage transition
 * and how missing profiles are handled. Profile selection follows a deterministic
 * 4-level precedence algorithm:
 *
 * 1. Task-level override (from TaskPacket `validation_requirements.profile`)
 * 2. Workflow template (stage-specific profile from the repository's workflow template)
 * 3. Task type default (repository config mapping task_type → profile name)
 * 4. System default (`default-dev` for development stages, `merge-gate` for merge stages)
 *
 * Key design decisions:
 * - Profiles are not inheritable in V1 — each is self-contained
 * - The selection algorithm is purely deterministic (no AI judgment)
 * - Missing profiles produce a typed error for audit event emission
 * - Stage classification determines the system default profile
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5 — Validation Policy
 * @module @factory/domain/policies/validation-policy
 */

// ---------------------------------------------------------------------------
// Validation stage classification
// ---------------------------------------------------------------------------

/**
 * Classification of pipeline stages for determining the system default
 * validation profile.
 *
 * - `development`: Pre-merge stages where `default-dev` applies.
 * - `merge`: Merge and post-merge stages where `merge-gate` applies.
 */
export const ValidationStage = {
  /** Pre-merge development stages (BACKLOG through APPROVED). */
  DEVELOPMENT: "development",
  /** Merge and post-merge stages (QUEUED_FOR_MERGE, MERGING, POST_MERGE_VALIDATION). */
  MERGE: "merge",
} as const;

/** Union of all valid validation stage values. */
export type ValidationStage = (typeof ValidationStage)[keyof typeof ValidationStage];

// ---------------------------------------------------------------------------
// Profile selection source
// ---------------------------------------------------------------------------

/**
 * The precedence layer that supplied the resolved profile name.
 *
 * Recorded in selection results so that downstream consumers (audit events,
 * policy snapshots) can trace how the profile was resolved.
 *
 * Layers are listed from highest to lowest precedence:
 * 1. `task_override` — TaskPacket's `validation_requirements.profile`
 * 2. `workflow_template` — Repository workflow template for the current stage
 * 3. `task_type_default` — Repository config mapping task_type to a profile
 * 4. `system_default` — Built-in default based on stage classification
 */
export const ProfileSelectionSource = {
  /** Profile name came from the TaskPacket's validation_requirements.profile field. */
  TASK_OVERRIDE: "task_override",
  /** Profile name came from the repository's workflow template for the current stage. */
  WORKFLOW_TEMPLATE: "workflow_template",
  /** Profile name came from repository config mapping the task's type to a profile. */
  TASK_TYPE_DEFAULT: "task_type_default",
  /** Profile name is the built-in system default based on stage classification. */
  SYSTEM_DEFAULT: "system_default",
} as const;

/** Union of all valid profile selection source values. */
export type ProfileSelectionSource =
  (typeof ProfileSelectionSource)[keyof typeof ProfileSelectionSource];

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/**
 * A single validation profile defining which checks are required, which are
 * optional, and the commands to execute them.
 *
 * Profiles are self-contained in V1 — they are not inheritable. Each profile
 * must specify its own complete set of checks and commands.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5.1
 */
export interface ValidationProfile {
  /**
   * Checks that must pass before the orchestrator can advance the task
   * to the next gated phase. These form the quality gate.
   *
   * @example ["test", "lint"]
   */
  readonly required_checks: readonly string[];

  /**
   * Checks that are run but whose failure does not block the transition.
   * Failures are recorded for visibility but do not prevent advancement.
   *
   * @example ["build"]
   */
  readonly optional_checks: readonly string[];

  /**
   * Mapping from check name to the shell command that executes it.
   * Must include entries for every check in both required_checks and
   * optional_checks.
   *
   * @example { test: "pnpm test", lint: "pnpm lint", build: "pnpm build" }
   */
  readonly commands: Readonly<Record<string, string>>;

  /**
   * Whether to fail the validation if a required check was skipped
   * (i.e., not executed at all). Defaults to true for strictness.
   */
  readonly fail_on_skipped_required_check: boolean;
}

/**
 * Complete validation policy definition per PRD §9.5.
 *
 * Contains a map of named validation profiles. Profile selection is performed
 * by {@link selectProfile} using a deterministic 4-level precedence algorithm.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5
 */
export interface ValidationPolicy {
  /**
   * Named validation profiles available for selection.
   * At minimum, should contain `default-dev` and `merge-gate`.
   */
  readonly profiles: Readonly<Record<string, ValidationProfile>>;
}

// ---------------------------------------------------------------------------
// Profile selection context
// ---------------------------------------------------------------------------

/**
 * Input context for the profile selection algorithm.
 *
 * Each field corresponds to one layer of the 4-level precedence hierarchy.
 * All override fields are optional — when absent, the algorithm falls through
 * to the next precedence level.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5.3
 */
export interface ProfileSelectionContext {
  /**
   * Profile name from TaskPacket's `validation_requirements.profile` field.
   * Highest precedence (level 1). When present, this profile is used
   * regardless of other settings.
   */
  readonly taskProfileOverride?: string | undefined;

  /**
   * Profile name from the repository's workflow template for the current stage.
   * Second precedence (level 2).
   */
  readonly workflowTemplateProfile?: string | undefined;

  /**
   * Profile name from repository config mapping the task's `task_type` to a profile.
   * Third precedence (level 3).
   */
  readonly taskTypeProfile?: string | undefined;

  /**
   * The current pipeline stage, used to determine the system default profile
   * when no higher-precedence override is present.
   * Lowest precedence (level 4).
   *
   * - `development` → system default is `default-dev`
   * - `merge` → system default is `merge-gate`
   */
  readonly stage: ValidationStage;
}

// ---------------------------------------------------------------------------
// Profile selection result
// ---------------------------------------------------------------------------

/**
 * Result of the profile selection algorithm.
 *
 * Contains the resolved profile, the name it was resolved under, and
 * the precedence source that supplied the name. This information is
 * included in the effective policy snapshot for auditability.
 */
export interface ProfileSelectionResult {
  /** The resolved validation profile. */
  readonly profile: ValidationProfile;
  /** The name of the resolved profile (key in the profiles map). */
  readonly profileName: string;
  /** Which precedence layer supplied the profile name. */
  readonly source: ProfileSelectionSource;
}

// ---------------------------------------------------------------------------
// Missing profile error
// ---------------------------------------------------------------------------

/**
 * Error thrown when the resolved profile name does not exist in the
 * validation policy's profiles map.
 *
 * Per PRD §9.5.3, this should cause the orchestrator to fail the transition
 * and emit a `missing_validation_profile` audit event.
 *
 * @example
 * ```ts
 * try {
 *   selectProfile(policy, context);
 * } catch (err) {
 *   if (err instanceof MissingValidationProfileError) {
 *     emitAuditEvent("missing_validation_profile", {
 *       profileName: err.profileName,
 *       source: err.source,
 *       availableProfiles: err.availableProfiles,
 *     });
 *   }
 * }
 * ```
 */
export class MissingValidationProfileError extends Error {
  /** The profile name that was resolved but not found. */
  readonly profileName: string;
  /** Which precedence layer resolved the missing profile name. */
  readonly source: ProfileSelectionSource;
  /** Profile names that are available in the policy. */
  readonly availableProfiles: readonly string[];

  constructor(profileName: string, source: ProfileSelectionSource, availableProfiles: string[]) {
    super(
      `Validation profile "${profileName}" (resolved from ${source}) not found in policy. ` +
        `Available profiles: ${availableProfiles.length > 0 ? availableProfiles.join(", ") : "(none)"}`,
    );
    this.name = "MissingValidationProfileError";
    this.profileName = profileName;
    this.source = source;
    this.availableProfiles = availableProfiles;
  }
}

// ---------------------------------------------------------------------------
// Default profiles
// ---------------------------------------------------------------------------

/**
 * System default profile name for development stages.
 *
 * Used when no task-level, workflow template, or task type override is present
 * and the current stage is classified as `development`.
 */
export const DEFAULT_DEV_PROFILE_NAME = "default-dev";

/**
 * System default profile name for merge and post-merge stages.
 *
 * Used when no task-level, workflow template, or task type override is present
 * and the current stage is classified as `merge`.
 */
export const MERGE_GATE_PROFILE_NAME = "merge-gate";

/**
 * Default `default-dev` profile per PRD §9.5.1.
 *
 * Requires test and lint to pass; build is optional.
 * Suitable for development-phase validation gates.
 */
export const DEFAULT_DEV_PROFILE: ValidationProfile = {
  required_checks: ["test", "lint"],
  optional_checks: ["build"],
  commands: {
    test: "pnpm test",
    lint: "pnpm lint",
    build: "pnpm build",
  },
  fail_on_skipped_required_check: true,
};

/**
 * Default `merge-gate` profile per PRD §9.5.1.
 *
 * Requires test and build to pass; lint is optional.
 * Suitable for merge and post-merge validation gates where
 * build correctness is more critical than style.
 */
export const MERGE_GATE_PROFILE: ValidationProfile = {
  required_checks: ["test", "build"],
  optional_checks: ["lint"],
  commands: {
    test: "pnpm test",
    build: "pnpm build",
    lint: "pnpm lint",
  },
  fail_on_skipped_required_check: true,
};

/**
 * Create a validation policy pre-populated with the two system default profiles.
 *
 * This is the baseline policy that should be used when no custom profiles are
 * configured. Additional profiles can be merged in by the configuration layer.
 *
 * @returns A ValidationPolicy containing `default-dev` and `merge-gate` profiles.
 */
export function createDefaultValidationPolicy(): ValidationPolicy {
  return {
    profiles: {
      [DEFAULT_DEV_PROFILE_NAME]: DEFAULT_DEV_PROFILE,
      [MERGE_GATE_PROFILE_NAME]: MERGE_GATE_PROFILE,
    },
  };
}

// ---------------------------------------------------------------------------
// System default resolution
// ---------------------------------------------------------------------------

/**
 * Determine the system default profile name based on stage classification.
 *
 * @param stage - The current pipeline stage.
 * @returns `default-dev` for development stages, `merge-gate` for merge stages.
 */
export function getSystemDefaultProfileName(stage: ValidationStage): string {
  switch (stage) {
    case ValidationStage.DEVELOPMENT:
      return DEFAULT_DEV_PROFILE_NAME;
    case ValidationStage.MERGE:
      return MERGE_GATE_PROFILE_NAME;
  }
}

// ---------------------------------------------------------------------------
// Profile selection algorithm
// ---------------------------------------------------------------------------

/**
 * Select a validation profile from the policy using the §9.5.3 precedence algorithm.
 *
 * The selection follows this strict precedence order:
 * 1. **Task-level override**: `context.taskProfileOverride` (from TaskPacket)
 * 2. **Workflow template**: `context.workflowTemplateProfile` (stage-specific)
 * 3. **Task type default**: `context.taskTypeProfile` (repo config mapping)
 * 4. **System default**: `default-dev` for development, `merge-gate` for merge
 *
 * The first non-undefined, non-empty-string value wins. The resolved profile
 * name is then looked up in `policy.profiles`. If not found, a
 * {@link MissingValidationProfileError} is thrown.
 *
 * @param policy - The validation policy containing available profiles.
 * @param context - The selection context with override values and stage.
 * @returns The resolved profile, its name, and the source layer.
 * @throws {MissingValidationProfileError} If the resolved profile name is not
 *   in the policy's profiles map.
 *
 * @example
 * ```ts
 * const policy = createDefaultValidationPolicy();
 * const result = selectProfile(policy, {
 *   taskProfileOverride: undefined,
 *   workflowTemplateProfile: undefined,
 *   taskTypeProfile: undefined,
 *   stage: ValidationStage.DEVELOPMENT,
 * });
 * // result.profileName === "default-dev"
 * // result.source === ProfileSelectionSource.SYSTEM_DEFAULT
 * ```
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5.3
 */
export function selectProfile(
  policy: ValidationPolicy,
  context: ProfileSelectionContext,
): ProfileSelectionResult {
  // Resolve the profile name and source using the 4-level precedence.
  const { profileName, source } = resolveProfileName(context);

  // Look up the profile in the policy.
  const profile = policy.profiles[profileName];

  if (profile === undefined) {
    throw new MissingValidationProfileError(profileName, source, Object.keys(policy.profiles));
  }

  return { profile, profileName, source };
}

/**
 * Resolve which profile name and source layer wins the precedence hierarchy.
 *
 * This is an internal helper that implements the pure precedence logic
 * without performing the policy lookup. Useful for testing the precedence
 * chain in isolation.
 *
 * @param context - The selection context.
 * @returns The winning profile name and its source layer.
 */
function resolveProfileName(context: ProfileSelectionContext): {
  profileName: string;
  source: ProfileSelectionSource;
} {
  // Level 1: Task-level override
  if (context.taskProfileOverride !== undefined && context.taskProfileOverride !== "") {
    return {
      profileName: context.taskProfileOverride,
      source: ProfileSelectionSource.TASK_OVERRIDE,
    };
  }

  // Level 2: Workflow template
  if (context.workflowTemplateProfile !== undefined && context.workflowTemplateProfile !== "") {
    return {
      profileName: context.workflowTemplateProfile,
      source: ProfileSelectionSource.WORKFLOW_TEMPLATE,
    };
  }

  // Level 3: Task type default
  if (context.taskTypeProfile !== undefined && context.taskTypeProfile !== "") {
    return {
      profileName: context.taskTypeProfile,
      source: ProfileSelectionSource.TASK_TYPE_DEFAULT,
    };
  }

  // Level 4: System default based on stage
  return {
    profileName: getSystemDefaultProfileName(context.stage),
    source: ProfileSelectionSource.SYSTEM_DEFAULT,
  };
}

// ---------------------------------------------------------------------------
// Profile introspection helpers
// ---------------------------------------------------------------------------

/**
 * Get all check names (both required and optional) from a profile.
 *
 * Useful for determining which commands need to be executed for a
 * given validation profile.
 *
 * @param profile - The validation profile to inspect.
 * @returns Array of all check names (required first, then optional).
 */
export function getAllChecks(profile: ValidationProfile): readonly string[] {
  return [...profile.required_checks, ...profile.optional_checks];
}

/**
 * Verify that a profile's commands map covers all declared checks.
 *
 * Returns the names of any checks (required or optional) that are missing
 * from the commands map. An empty array means the profile is well-formed.
 *
 * @param profile - The validation profile to validate.
 * @returns Array of check names that are declared but have no command.
 */
export function getMissingCommands(profile: ValidationProfile): readonly string[] {
  const allChecks = getAllChecks(profile);
  return allChecks.filter((check) => !(check in profile.commands));
}
