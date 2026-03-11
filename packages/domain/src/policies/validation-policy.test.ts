/**
 * Tests for validation policy model and profile selection algorithm.
 *
 * Validates that the profile selection follows the §9.5.3 precedence exactly:
 * 1. Task-level override (highest)
 * 2. Workflow template profile
 * 3. Task type default
 * 4. System default based on stage (lowest)
 *
 * Also tests default profile contents, missing profile error handling,
 * and profile introspection helpers.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5
 * @module @factory/domain/policies/validation-policy.test
 */

import { describe, it, expect } from "vitest";
import {
  ValidationStage,
  ProfileSelectionSource,
  type ValidationProfile,
  type ValidationPolicy,
  type ProfileSelectionContext,
  MissingValidationProfileError,
  DEFAULT_DEV_PROFILE_NAME,
  MERGE_GATE_PROFILE_NAME,
  DEFAULT_DEV_PROFILE,
  MERGE_GATE_PROFILE,
  createDefaultValidationPolicy,
  getSystemDefaultProfileName,
  selectProfile,
  getAllChecks,
  getMissingCommands,
} from "./validation-policy.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Custom profile for testing task-level and other overrides. */
const CUSTOM_PROFILE: ValidationProfile = {
  required_checks: ["test", "lint", "build"],
  optional_checks: ["security-scan"],
  commands: {
    test: "pnpm test",
    lint: "pnpm lint",
    build: "pnpm build",
    "security-scan": "pnpm audit",
  },
  fail_on_skipped_required_check: true,
};

/** Strict profile requiring everything for testing. */
const STRICT_PROFILE: ValidationProfile = {
  required_checks: ["test", "lint", "build", "typecheck"],
  optional_checks: [],
  commands: {
    test: "pnpm test",
    lint: "pnpm lint",
    build: "pnpm build",
    typecheck: "pnpm typecheck",
  },
  fail_on_skipped_required_check: true,
};

/** Lenient profile for testing with skipped-check tolerance. */
const LENIENT_PROFILE: ValidationProfile = {
  required_checks: ["test"],
  optional_checks: ["lint", "build"],
  commands: {
    test: "pnpm test",
    lint: "pnpm lint",
    build: "pnpm build",
  },
  fail_on_skipped_required_check: false,
};

/** Policy with default + custom profiles for most tests. */
function createTestPolicy(): ValidationPolicy {
  return {
    profiles: {
      [DEFAULT_DEV_PROFILE_NAME]: DEFAULT_DEV_PROFILE,
      [MERGE_GATE_PROFILE_NAME]: MERGE_GATE_PROFILE,
      custom: CUSTOM_PROFILE,
      strict: STRICT_PROFILE,
      lenient: LENIENT_PROFILE,
    },
  };
}

/** Minimal development stage context with no overrides. */
function devContext(overrides?: Partial<ProfileSelectionContext>): ProfileSelectionContext {
  return {
    stage: ValidationStage.DEVELOPMENT,
    ...overrides,
  };
}

/** Minimal merge stage context with no overrides. */
function mergeContext(overrides?: Partial<ProfileSelectionContext>): ProfileSelectionContext {
  return {
    stage: ValidationStage.MERGE,
    ...overrides,
  };
}

// ===========================================================================
// ValidationStage enum
// ===========================================================================

describe("ValidationStage", () => {
  /**
   * Validates that the ValidationStage enum contains the two required values.
   * These values drive the system default profile selection logic.
   */
  it("should define DEVELOPMENT and MERGE values", () => {
    expect(ValidationStage.DEVELOPMENT).toBe("development");
    expect(ValidationStage.MERGE).toBe("merge");
  });
});

// ===========================================================================
// ProfileSelectionSource enum
// ===========================================================================

describe("ProfileSelectionSource", () => {
  /**
   * Validates that the ProfileSelectionSource enum contains all four precedence layers.
   * These values are recorded in selection results for auditability.
   */
  it("should define all four precedence source values", () => {
    expect(ProfileSelectionSource.TASK_OVERRIDE).toBe("task_override");
    expect(ProfileSelectionSource.WORKFLOW_TEMPLATE).toBe("workflow_template");
    expect(ProfileSelectionSource.TASK_TYPE_DEFAULT).toBe("task_type_default");
    expect(ProfileSelectionSource.SYSTEM_DEFAULT).toBe("system_default");
  });
});

// ===========================================================================
// Default profiles
// ===========================================================================

describe("Default profiles", () => {
  /**
   * Validates that the default-dev profile matches the PRD §9.5.1 specification exactly:
   * required=[test, lint], optional=[build], all three commands present.
   */
  describe("DEFAULT_DEV_PROFILE", () => {
    it("should require test and lint, with build optional", () => {
      expect(DEFAULT_DEV_PROFILE.required_checks).toEqual(["test", "lint"]);
      expect(DEFAULT_DEV_PROFILE.optional_checks).toEqual(["build"]);
    });

    it("should have commands for all checks", () => {
      expect(DEFAULT_DEV_PROFILE.commands).toEqual({
        test: "pnpm test",
        lint: "pnpm lint",
        build: "pnpm build",
      });
    });

    it("should fail on skipped required check by default", () => {
      expect(DEFAULT_DEV_PROFILE.fail_on_skipped_required_check).toBe(true);
    });
  });

  /**
   * Validates that the merge-gate profile matches the PRD §9.5.1 specification exactly:
   * required=[test, build], optional=[lint], all three commands present.
   */
  describe("MERGE_GATE_PROFILE", () => {
    it("should require test and build, with lint optional", () => {
      expect(MERGE_GATE_PROFILE.required_checks).toEqual(["test", "build"]);
      expect(MERGE_GATE_PROFILE.optional_checks).toEqual(["lint"]);
    });

    it("should have commands for all checks", () => {
      expect(MERGE_GATE_PROFILE.commands).toEqual({
        test: "pnpm test",
        build: "pnpm build",
        lint: "pnpm lint",
      });
    });

    it("should fail on skipped required check by default", () => {
      expect(MERGE_GATE_PROFILE.fail_on_skipped_required_check).toBe(true);
    });
  });

  /**
   * Validates that profile name constants match the expected values
   * used in the system default selection logic.
   */
  describe("Profile name constants", () => {
    it("should have correct default profile names", () => {
      expect(DEFAULT_DEV_PROFILE_NAME).toBe("default-dev");
      expect(MERGE_GATE_PROFILE_NAME).toBe("merge-gate");
    });
  });
});

// ===========================================================================
// createDefaultValidationPolicy
// ===========================================================================

describe("createDefaultValidationPolicy", () => {
  /**
   * Validates that the factory function produces a policy with both
   * system default profiles and no others.
   */
  it("should return a policy with default-dev and merge-gate profiles", () => {
    const policy = createDefaultValidationPolicy();
    expect(Object.keys(policy.profiles)).toEqual(["default-dev", "merge-gate"]);
    expect(policy.profiles["default-dev"]).toEqual(DEFAULT_DEV_PROFILE);
    expect(policy.profiles["merge-gate"]).toEqual(MERGE_GATE_PROFILE);
  });
});

// ===========================================================================
// getSystemDefaultProfileName
// ===========================================================================

describe("getSystemDefaultProfileName", () => {
  /**
   * Validates the stage-to-profile mapping for the system default level.
   * This is the lowest precedence fallback in the selection algorithm.
   */
  it("should return 'default-dev' for development stage", () => {
    expect(getSystemDefaultProfileName(ValidationStage.DEVELOPMENT)).toBe("default-dev");
  });

  it("should return 'merge-gate' for merge stage", () => {
    expect(getSystemDefaultProfileName(ValidationStage.MERGE)).toBe("merge-gate");
  });
});

// ===========================================================================
// selectProfile — §9.5.3 precedence algorithm
// ===========================================================================

describe("selectProfile", () => {
  const policy = createTestPolicy();

  // ── Level 4: System default (lowest precedence) ───────────────────────

  describe("system default (level 4 — lowest precedence)", () => {
    /**
     * When no overrides are present and stage is development,
     * the system default should resolve to default-dev.
     */
    it("should select default-dev for development stage with no overrides", () => {
      const result = selectProfile(policy, devContext());

      expect(result.profileName).toBe("default-dev");
      expect(result.source).toBe(ProfileSelectionSource.SYSTEM_DEFAULT);
      expect(result.profile).toEqual(DEFAULT_DEV_PROFILE);
    });

    /**
     * When no overrides are present and stage is merge,
     * the system default should resolve to merge-gate.
     */
    it("should select merge-gate for merge stage with no overrides", () => {
      const result = selectProfile(policy, mergeContext());

      expect(result.profileName).toBe("merge-gate");
      expect(result.source).toBe(ProfileSelectionSource.SYSTEM_DEFAULT);
      expect(result.profile).toEqual(MERGE_GATE_PROFILE);
    });

    /**
     * Undefined overrides should be treated the same as absent overrides,
     * falling through to the system default.
     */
    it("should fall through when all overrides are explicitly undefined", () => {
      const result = selectProfile(policy, {
        taskProfileOverride: undefined,
        workflowTemplateProfile: undefined,
        taskTypeProfile: undefined,
        stage: ValidationStage.DEVELOPMENT,
      });

      expect(result.profileName).toBe("default-dev");
      expect(result.source).toBe(ProfileSelectionSource.SYSTEM_DEFAULT);
    });

    /**
     * Empty string overrides should be treated as absent,
     * falling through to the system default.
     */
    it("should fall through when all overrides are empty strings", () => {
      const result = selectProfile(policy, {
        taskProfileOverride: "",
        workflowTemplateProfile: "",
        taskTypeProfile: "",
        stage: ValidationStage.MERGE,
      });

      expect(result.profileName).toBe("merge-gate");
      expect(result.source).toBe(ProfileSelectionSource.SYSTEM_DEFAULT);
    });
  });

  // ── Level 3: Task type default ────────────────────────────────────────

  describe("task type default (level 3)", () => {
    /**
     * Task type default should take precedence over system default
     * when no higher-priority overrides are present.
     */
    it("should select profile from task type when no higher overrides exist", () => {
      const result = selectProfile(policy, devContext({ taskTypeProfile: "custom" }));

      expect(result.profileName).toBe("custom");
      expect(result.source).toBe(ProfileSelectionSource.TASK_TYPE_DEFAULT);
      expect(result.profile).toEqual(CUSTOM_PROFILE);
    });

    /**
     * Task type default should work regardless of stage classification
     * since it overrides the system default.
     */
    it("should override system default regardless of stage", () => {
      const result = selectProfile(policy, mergeContext({ taskTypeProfile: "lenient" }));

      expect(result.profileName).toBe("lenient");
      expect(result.source).toBe(ProfileSelectionSource.TASK_TYPE_DEFAULT);
      expect(result.profile).toEqual(LENIENT_PROFILE);
    });
  });

  // ── Level 2: Workflow template ────────────────────────────────────────

  describe("workflow template (level 2)", () => {
    /**
     * Workflow template should take precedence over task type default
     * and system default.
     */
    it("should select profile from workflow template over task type", () => {
      const result = selectProfile(
        policy,
        devContext({
          workflowTemplateProfile: "strict",
          taskTypeProfile: "lenient",
        }),
      );

      expect(result.profileName).toBe("strict");
      expect(result.source).toBe(ProfileSelectionSource.WORKFLOW_TEMPLATE);
      expect(result.profile).toEqual(STRICT_PROFILE);
    });

    /**
     * Workflow template should take precedence even when task type
     * default is absent (falls through to system default otherwise).
     */
    it("should select workflow template when task type is absent", () => {
      const result = selectProfile(policy, mergeContext({ workflowTemplateProfile: "custom" }));

      expect(result.profileName).toBe("custom");
      expect(result.source).toBe(ProfileSelectionSource.WORKFLOW_TEMPLATE);
    });
  });

  // ── Level 1: Task-level override (highest precedence) ─────────────────

  describe("task-level override (level 1 — highest precedence)", () => {
    /**
     * Task-level override should take precedence over ALL other levels.
     * This is the highest priority in the §9.5.3 precedence chain.
     */
    it("should select task override over all other levels", () => {
      const result = selectProfile(
        policy,
        devContext({
          taskProfileOverride: "custom",
          workflowTemplateProfile: "strict",
          taskTypeProfile: "lenient",
        }),
      );

      expect(result.profileName).toBe("custom");
      expect(result.source).toBe(ProfileSelectionSource.TASK_OVERRIDE);
      expect(result.profile).toEqual(CUSTOM_PROFILE);
    });

    /**
     * Task override should work even when it's the only non-default source.
     */
    it("should select task override when other overrides are absent", () => {
      const result = selectProfile(policy, mergeContext({ taskProfileOverride: "strict" }));

      expect(result.profileName).toBe("strict");
      expect(result.source).toBe(ProfileSelectionSource.TASK_OVERRIDE);
      expect(result.profile).toEqual(STRICT_PROFILE);
    });
  });

  // ── Precedence fallthrough ────────────────────────────────────────────

  describe("precedence fallthrough", () => {
    /**
     * When level 1 is empty string and level 2 has a value,
     * level 2 should win (empty strings treated as absent).
     */
    it("should skip empty task override and use workflow template", () => {
      const result = selectProfile(
        policy,
        devContext({
          taskProfileOverride: "",
          workflowTemplateProfile: "custom",
        }),
      );

      expect(result.profileName).toBe("custom");
      expect(result.source).toBe(ProfileSelectionSource.WORKFLOW_TEMPLATE);
    });

    /**
     * When levels 1 and 2 are undefined and level 3 has a value,
     * level 3 should win.
     */
    it("should skip undefined levels 1-2 and use task type", () => {
      const result = selectProfile(
        policy,
        mergeContext({
          taskProfileOverride: undefined,
          workflowTemplateProfile: undefined,
          taskTypeProfile: "strict",
        }),
      );

      expect(result.profileName).toBe("strict");
      expect(result.source).toBe(ProfileSelectionSource.TASK_TYPE_DEFAULT);
    });

    /**
     * When levels 1-2 are empty strings and level 3 is undefined,
     * the system default should win.
     */
    it("should fall through all empty/undefined overrides to system default", () => {
      const result = selectProfile(policy, {
        taskProfileOverride: "",
        workflowTemplateProfile: "",
        taskTypeProfile: undefined,
        stage: ValidationStage.DEVELOPMENT,
      });

      expect(result.profileName).toBe("default-dev");
      expect(result.source).toBe(ProfileSelectionSource.SYSTEM_DEFAULT);
    });
  });

  // ── Missing profile error handling ────────────────────────────────────

  describe("missing profile error", () => {
    /**
     * When the resolved profile name does not exist in the policy,
     * selectProfile must throw MissingValidationProfileError.
     * Per §9.5.3, this should cause the orchestrator to fail the transition.
     */
    it("should throw MissingValidationProfileError for unknown task override", () => {
      expect(() =>
        selectProfile(policy, devContext({ taskProfileOverride: "nonexistent" })),
      ).toThrow(MissingValidationProfileError);
    });

    it("should throw MissingValidationProfileError for unknown workflow template profile", () => {
      expect(() =>
        selectProfile(policy, devContext({ workflowTemplateProfile: "unknown-profile" })),
      ).toThrow(MissingValidationProfileError);
    });

    it("should throw MissingValidationProfileError for unknown task type profile", () => {
      expect(() =>
        selectProfile(policy, mergeContext({ taskTypeProfile: "does-not-exist" })),
      ).toThrow(MissingValidationProfileError);
    });

    /**
     * The error should contain the missing profile name, the source layer,
     * and the list of available profiles for diagnostic purposes.
     */
    it("should include profileName, source, and availableProfiles in error", () => {
      try {
        selectProfile(policy, devContext({ taskProfileOverride: "missing-one" }));
        expect.fail("Should have thrown MissingValidationProfileError");
      } catch (err) {
        expect(err).toBeInstanceOf(MissingValidationProfileError);
        const error = err as MissingValidationProfileError;
        expect(error.profileName).toBe("missing-one");
        expect(error.source).toBe(ProfileSelectionSource.TASK_OVERRIDE);
        expect(error.availableProfiles).toContain("default-dev");
        expect(error.availableProfiles).toContain("merge-gate");
        expect(error.availableProfiles).toContain("custom");
        expect(error.availableProfiles).toContain("strict");
        expect(error.availableProfiles).toContain("lenient");
      }
    });

    /**
     * The error message should be human-readable and include
     * both the missing name and available profiles for debugging.
     */
    it("should produce a descriptive error message", () => {
      try {
        selectProfile(policy, devContext({ taskProfileOverride: "missing" }));
        expect.fail("Should have thrown");
      } catch (err) {
        const error = err as MissingValidationProfileError;
        expect(error.message).toContain("missing");
        expect(error.message).toContain("task_override");
        expect(error.message).toContain("default-dev");
      }
    });

    /**
     * When the policy has no profiles at all, the system default should
     * still resolve a name but the lookup should fail with the error.
     */
    it("should throw for system default when policy has no profiles", () => {
      const emptyPolicy: ValidationPolicy = { profiles: {} };

      expect(() => selectProfile(emptyPolicy, devContext())).toThrow(MissingValidationProfileError);

      try {
        selectProfile(emptyPolicy, devContext());
      } catch (err) {
        const error = err as MissingValidationProfileError;
        expect(error.profileName).toBe("default-dev");
        expect(error.source).toBe(ProfileSelectionSource.SYSTEM_DEFAULT);
        expect(error.availableProfiles).toEqual([]);
      }
    });

    /**
     * Error should have the correct name property for instanceof checks
     * and serialization.
     */
    it("should have name 'MissingValidationProfileError'", () => {
      const error = new MissingValidationProfileError(
        "test",
        ProfileSelectionSource.TASK_OVERRIDE,
        ["a", "b"],
      );
      expect(error.name).toBe("MissingValidationProfileError");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(MissingValidationProfileError);
    });
  });
});

// ===========================================================================
// getAllChecks
// ===========================================================================

describe("getAllChecks", () => {
  /**
   * getAllChecks should return required checks followed by optional checks.
   * This ordering is important for consumers that want to run required checks first.
   */
  it("should return required checks followed by optional checks", () => {
    const checks = getAllChecks(DEFAULT_DEV_PROFILE);
    expect(checks).toEqual(["test", "lint", "build"]);
  });

  it("should return only required checks when no optional checks exist", () => {
    const checks = getAllChecks(STRICT_PROFILE);
    expect(checks).toEqual(["test", "lint", "build", "typecheck"]);
  });

  it("should return empty array for profile with no checks", () => {
    const emptyProfile: ValidationProfile = {
      required_checks: [],
      optional_checks: [],
      commands: {},
      fail_on_skipped_required_check: true,
    };
    expect(getAllChecks(emptyProfile)).toEqual([]);
  });
});

// ===========================================================================
// getMissingCommands
// ===========================================================================

describe("getMissingCommands", () => {
  /**
   * A well-formed profile should have commands for all declared checks.
   * getMissingCommands should return an empty array for valid profiles.
   */
  it("should return empty array when all checks have commands", () => {
    expect(getMissingCommands(DEFAULT_DEV_PROFILE)).toEqual([]);
    expect(getMissingCommands(MERGE_GATE_PROFILE)).toEqual([]);
    expect(getMissingCommands(CUSTOM_PROFILE)).toEqual([]);
    expect(getMissingCommands(STRICT_PROFILE)).toEqual([]);
  });

  /**
   * When a check is declared but has no corresponding command,
   * getMissingCommands should detect and report it. This is a
   * configuration error that should be caught before runtime.
   */
  it("should return check names missing from commands map", () => {
    const brokenProfile: ValidationProfile = {
      required_checks: ["test", "lint", "typecheck"],
      optional_checks: ["security-scan"],
      commands: {
        test: "pnpm test",
        // lint, typecheck, and security-scan are missing
      },
      fail_on_skipped_required_check: true,
    };

    const missing = getMissingCommands(brokenProfile);
    expect(missing).toContain("lint");
    expect(missing).toContain("typecheck");
    expect(missing).toContain("security-scan");
    expect(missing).not.toContain("test");
  });

  it("should return empty array for empty profile", () => {
    const emptyProfile: ValidationProfile = {
      required_checks: [],
      optional_checks: [],
      commands: {},
      fail_on_skipped_required_check: true,
    };
    expect(getMissingCommands(emptyProfile)).toEqual([]);
  });
});

// ===========================================================================
// Integration: full selection paths
// ===========================================================================

describe("selectProfile integration", () => {
  /**
   * Validates a realistic scenario where a merge-stage task has a task-level
   * override pointing to a development-oriented profile. The override should
   * win even though the stage would normally select merge-gate.
   */
  it("should allow task override to select dev profile for merge stage", () => {
    const policy = createDefaultValidationPolicy();
    const result = selectProfile(policy, {
      taskProfileOverride: "default-dev",
      stage: ValidationStage.MERGE,
    });

    expect(result.profileName).toBe("default-dev");
    expect(result.source).toBe(ProfileSelectionSource.TASK_OVERRIDE);
  });

  /**
   * Validates that the selected profile object is the same reference
   * as in the policy, ensuring no accidental copying or mutation.
   */
  it("should return the exact profile object from the policy", () => {
    const policy = createTestPolicy();
    const result = selectProfile(policy, devContext({ taskProfileOverride: "custom" }));

    expect(result.profile).toBe(policy.profiles["custom"]);
  });

  /**
   * Validates that the selection algorithm works correctly with a policy
   * containing only one custom profile and no defaults.
   */
  it("should work with policy containing only custom profiles", () => {
    const customOnly: ValidationPolicy = {
      profiles: {
        "my-profile": CUSTOM_PROFILE,
      },
    };

    const result = selectProfile(customOnly, devContext({ taskProfileOverride: "my-profile" }));
    expect(result.profileName).toBe("my-profile");
    expect(result.profile).toEqual(CUSTOM_PROFILE);
  });

  /**
   * Validates that system default throws when default profiles are missing
   * from a custom-only policy with no overrides.
   */
  it("should throw when system default is needed but not in policy", () => {
    const customOnly: ValidationPolicy = {
      profiles: {
        "my-profile": CUSTOM_PROFILE,
      },
    };

    expect(() => selectProfile(customOnly, devContext())).toThrow(MissingValidationProfileError);
  });
});
