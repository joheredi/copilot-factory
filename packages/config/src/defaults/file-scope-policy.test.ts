/**
 * Tests for the default V1 file scope policy and merge function.
 *
 * Validates that the default policy provides a secure-by-default posture:
 * reads are broadly allowed, writes are restricted to code directories,
 * and sensitive infrastructure paths are always denied. Also validates
 * the hierarchical merge function used for configuration resolution.
 *
 * @module @factory/config/defaults/file-scope-policy.test
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.4
 */

import { describe, it, expect } from "vitest";

import {
  checkReadAccess,
  checkWriteAccess,
  FileScopeViolationAction,
  FileScopeViolationReason,
} from "@factory/domain";

import { DEFAULT_FILE_SCOPE_POLICY, mergeFileScopePolicies } from "./file-scope-policy.js";

// ─── Default Policy Structure ───────────────────────────────────────────────

describe("DEFAULT_FILE_SCOPE_POLICY structure", () => {
  /**
   * The default policy must use fail_run for violations because
   * file scope enforcement is a critical security boundary.
   * Writing to unauthorized paths should immediately stop the run.
   */
  it("uses fail_run violation action", () => {
    expect(DEFAULT_FILE_SCOPE_POLICY.on_violation).toBe(FileScopeViolationAction.FAIL_RUN);
  });

  /**
   * Reads must be broadly allowed for V1 because workers need
   * context from across the repository to understand codebases.
   */
  it("allows reads outside scope by default", () => {
    expect(DEFAULT_FILE_SCOPE_POLICY.allow_read_outside_scope).toBe(true);
  });

  /**
   * Writes must be restricted by default. Workers should only modify
   * files within explicitly configured roots.
   */
  it("denies writes outside scope by default", () => {
    expect(DEFAULT_FILE_SCOPE_POLICY.allow_write_outside_scope).toBe(false);
  });

  /**
   * All root arrays must be non-empty to provide meaningful
   * default coverage.
   */
  it("has non-empty root arrays", () => {
    expect(DEFAULT_FILE_SCOPE_POLICY.read_roots.length).toBeGreaterThan(0);
    expect(DEFAULT_FILE_SCOPE_POLICY.write_roots.length).toBeGreaterThan(0);
    expect(DEFAULT_FILE_SCOPE_POLICY.deny_roots.length).toBeGreaterThan(0);
  });
});

// ─── Default Read Access ────────────────────────────────────────────────────

describe("default policy read access", () => {
  /**
   * Application code should be readable by default so workers
   * can understand the codebase they are modifying.
   */
  it("allows reading from apps/", () => {
    const result = checkReadAccess("apps/control-plane/src/main.ts", DEFAULT_FILE_SCOPE_POLICY);
    expect(result.allowed).toBe(true);
  });

  /**
   * Package code should be readable by default.
   */
  it("allows reading from packages/", () => {
    const result = checkReadAccess("packages/domain/src/index.ts", DEFAULT_FILE_SCOPE_POLICY);
    expect(result.allowed).toBe(true);
  });

  /**
   * Documentation should be readable so workers can reference
   * specs and requirements.
   */
  it("allows reading from docs/", () => {
    const result = checkReadAccess("docs/prd/001-overview.md", DEFAULT_FILE_SCOPE_POLICY);
    expect(result.allowed).toBe(true);
  });

  /**
   * Files outside all roots should be readable because
   * allow_read_outside_scope is true by default.
   */
  it("allows reading files outside all roots", () => {
    const result = checkReadAccess("random/config.json", DEFAULT_FILE_SCOPE_POLICY);
    expect(result.allowed).toBe(true);
  });

  /**
   * Deny roots must block reads even though allow_read_outside_scope
   * is true. Deny roots have the highest precedence.
   */
  it("blocks reading from deny roots", () => {
    const result = checkReadAccess(".github/workflows/ci.yml", DEFAULT_FILE_SCOPE_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.DENIED_BY_DENY_ROOT);
  });
});

// ─── Default Write Access ───────────────────────────────────────────────────

describe("default policy write access", () => {
  /**
   * Workers should be able to write to application code by default.
   * This is the primary work area for development tasks.
   */
  it("allows writing to apps/", () => {
    const result = checkWriteAccess("apps/control-plane/src/main.ts", DEFAULT_FILE_SCOPE_POLICY);
    expect(result.allowed).toBe(true);
  });

  /**
   * Workers should be able to write to shared packages.
   */
  it("allows writing to packages/", () => {
    const result = checkWriteAccess(
      "packages/domain/src/policies/file-scope-policy.ts",
      DEFAULT_FILE_SCOPE_POLICY,
    );
    expect(result.allowed).toBe(true);
  });

  /**
   * Documentation should be read-only by default. Workers can read
   * docs for context but should not modify them without explicit
   * policy override.
   */
  it("blocks writing to docs/", () => {
    const result = checkWriteAccess("docs/prd/001-overview.md", DEFAULT_FILE_SCOPE_POLICY);
    expect(result.allowed).toBe(false);
  });

  /**
   * CI/CD workflows are protected by deny roots and must never
   * be writable by workers.
   */
  it("blocks writing to .github/workflows/", () => {
    const result = checkWriteAccess(".github/workflows/ci.yml", DEFAULT_FILE_SCOPE_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.DENIED_BY_DENY_ROOT);
  });

  /**
   * Secrets directory is protected by deny roots.
   */
  it("blocks writing to secrets/", () => {
    const result = checkWriteAccess("secrets/api-key.txt", DEFAULT_FILE_SCOPE_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.DENIED_BY_DENY_ROOT);
  });

  /**
   * Production infrastructure is protected by deny roots.
   */
  it("blocks writing to infra/production/", () => {
    const result = checkWriteAccess("infra/production/terraform.tf", DEFAULT_FILE_SCOPE_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.DENIED_BY_DENY_ROOT);
  });

  /**
   * .git/ internals are protected by deny roots.
   */
  it("blocks writing to .git/", () => {
    const result = checkWriteAccess(".git/config", DEFAULT_FILE_SCOPE_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.DENIED_BY_DENY_ROOT);
  });

  /**
   * Files outside all configured roots should be blocked for writes
   * by default (allow_write_outside_scope is false).
   */
  it("blocks writing to files outside all roots", () => {
    const result = checkWriteAccess("random/file.txt", DEFAULT_FILE_SCOPE_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(FileScopeViolationReason.WRITE_OUTSIDE_SCOPE);
  });
});

// ─── mergeFileScopePolicies ─────────────────────────────────────────────────

describe("mergeFileScopePolicies", () => {
  /**
   * An empty override should return a policy functionally identical
   * to the base. This ensures no accidental mutations from empty overrides.
   */
  it("returns base unchanged with empty override", () => {
    const merged = mergeFileScopePolicies(DEFAULT_FILE_SCOPE_POLICY, {});
    expect(merged).toEqual(DEFAULT_FILE_SCOPE_POLICY);
  });

  /**
   * Scalar boolean fields should be overridden by the lower layer.
   */
  it("overrides scalar boolean fields", () => {
    const merged = mergeFileScopePolicies(DEFAULT_FILE_SCOPE_POLICY, {
      allow_write_outside_scope: true,
    });
    expect(merged.allow_write_outside_scope).toBe(true);
    // Non-overridden fields preserved
    expect(merged.allow_read_outside_scope).toBe(true);
    expect(merged.on_violation).toBe(FileScopeViolationAction.FAIL_RUN);
  });

  /**
   * Array fields use wholesale replacement semantics — the override
   * replaces the entire array, not merging individual entries.
   * This is critical for correctness: a project-level override should
   * be able to completely redefine write_roots without inheriting
   * entries from the system default.
   */
  it("replaces array fields wholesale", () => {
    const merged = mergeFileScopePolicies(DEFAULT_FILE_SCOPE_POLICY, {
      write_roots: ["apps/web-ui/"],
    });
    expect(merged.write_roots).toEqual(["apps/web-ui/"]);
    // Other array fields preserved
    expect(merged.read_roots).toEqual(DEFAULT_FILE_SCOPE_POLICY.read_roots);
    expect(merged.deny_roots).toEqual(DEFAULT_FILE_SCOPE_POLICY.deny_roots);
  });

  /**
   * Non-overridden fields must be preserved from the base policy.
   * This ensures that partial overrides don't accidentally reset
   * other fields to undefined.
   */
  it("preserves non-overridden fields from base", () => {
    const merged = mergeFileScopePolicies(DEFAULT_FILE_SCOPE_POLICY, {
      on_violation: FileScopeViolationAction.AUDIT_ONLY,
    });
    expect(merged.on_violation).toBe(FileScopeViolationAction.AUDIT_ONLY);
    expect(merged.read_roots).toEqual(DEFAULT_FILE_SCOPE_POLICY.read_roots);
    expect(merged.write_roots).toEqual(DEFAULT_FILE_SCOPE_POLICY.write_roots);
    expect(merged.deny_roots).toEqual(DEFAULT_FILE_SCOPE_POLICY.deny_roots);
    expect(merged.allow_read_outside_scope).toBe(true);
    expect(merged.allow_write_outside_scope).toBe(false);
  });

  /**
   * A merged policy should be fully functional — it should work correctly
   * when passed to checkReadAccess and checkWriteAccess.
   */
  it("produces a functional merged policy", () => {
    const merged = mergeFileScopePolicies(DEFAULT_FILE_SCOPE_POLICY, {
      write_roots: ["apps/web-ui/"],
      deny_roots: ["secrets/"],
    });

    // New write root works
    const writeAllowed = checkWriteAccess("apps/web-ui/src/App.tsx", merged);
    expect(writeAllowed.allowed).toBe(true);

    // Old write root no longer works (wholesale replacement)
    const writeBlocked = checkWriteAccess("packages/domain/src/index.ts", merged);
    expect(writeBlocked.allowed).toBe(false);

    // Deny root still works
    const denied = checkWriteAccess("secrets/key.txt", merged);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe(FileScopeViolationReason.DENIED_BY_DENY_ROOT);
  });
});
