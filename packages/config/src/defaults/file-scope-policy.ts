/**
 * Default file scope policy and hierarchical merge support.
 *
 * Provides the V1 default file scope policy that balances security with
 * developer productivity: read access is broadly permitted for context
 * gathering, writes are restricted to application and package directories,
 * and sensitive infrastructure paths are always denied.
 *
 * Also provides a merge function for hierarchical configuration resolution
 * where policies at lower layers (repository, task) can override higher
 * layers (organization, system defaults).
 *
 * @module @factory/config/defaults/file-scope-policy
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.4
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12 Configuration Precedence
 */

import type { FileScopePolicy } from "@factory/domain";
import { FileScopeViolationAction } from "@factory/domain";

// ─── Default Roots ──────────────────────────────────────────────────────────

/**
 * Default read roots for V1.
 *
 * Workers can read from application code, packages, documentation, and
 * configuration directories. The default policy also sets
 * allow_read_outside_scope to true, so these roots are more of an
 * explicit signal than a hard boundary for reads.
 */
const DEFAULT_READ_ROOTS: readonly string[] = ["apps/", "packages/", "docs/", "eng/"] as const;

/**
 * Default write roots for V1.
 *
 * Workers can write within application and package directories.
 * This covers the primary source code areas while excluding
 * infrastructure, CI, and documentation from write access.
 */
const DEFAULT_WRITE_ROOTS: readonly string[] = ["apps/", "packages/"] as const;

/**
 * Default deny roots for V1.
 *
 * These paths are always denied for both read and write access.
 * They protect CI/CD pipelines, secrets, production infrastructure,
 * and version control internals from worker modification.
 */
const DEFAULT_DENY_ROOTS: readonly string[] = [
  ".github/workflows/",
  ".github/actions/",
  "secrets/",
  "infra/production/",
  ".git/",
] as const;

// ─── Default Policy ─────────────────────────────────────────────────────────

/**
 * Default V1 file scope policy.
 *
 * Security posture:
 * - **Reads:** Broadly permitted. `allow_read_outside_scope` is true so workers
 *   can gather context from anywhere in the repository. Read roots are
 *   informational signals for the worker, not hard boundaries.
 * - **Writes:** Restricted to `apps/` and `packages/` directories only.
 *   Workers cannot modify documentation, infrastructure, or CI configuration.
 * - **Deny roots:** CI workflows, secrets, production infrastructure, and
 *   `.git/` internals are always denied regardless of other settings.
 * - **Violation action:** `fail_run` — any write outside scope immediately
 *   fails the worker run.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.4
 */
export const DEFAULT_FILE_SCOPE_POLICY: FileScopePolicy = {
  read_roots: DEFAULT_READ_ROOTS,
  write_roots: DEFAULT_WRITE_ROOTS,
  deny_roots: DEFAULT_DENY_ROOTS,
  allow_read_outside_scope: true,
  allow_write_outside_scope: false,
  on_violation: FileScopeViolationAction.FAIL_RUN,
};

// ─── Policy Override & Merge ────────────────────────────────────────────────

/**
 * Partial override for a file scope policy.
 *
 * Used in hierarchical configuration resolution where lower layers
 * (repository → task) can selectively override fields from higher layers.
 * Only the fields present in the override are applied; absent fields
 * retain their value from the base policy.
 *
 * Array fields (roots) use last-writer-wins replacement semantics — they
 * are replaced wholesale, not merged. This matches the command policy
 * merge behavior established in T048.
 */
export interface FileScopePolicyOverride {
  readonly read_roots?: FileScopePolicy["read_roots"];
  readonly write_roots?: FileScopePolicy["write_roots"];
  readonly deny_roots?: FileScopePolicy["deny_roots"];
  readonly allow_read_outside_scope?: FileScopePolicy["allow_read_outside_scope"];
  readonly allow_write_outside_scope?: FileScopePolicy["allow_write_outside_scope"];
  readonly on_violation?: FileScopePolicy["on_violation"];
}

/**
 * Merge a base file scope policy with an override, producing a new policy.
 *
 * Follows last-writer-wins semantics for all fields. Array fields (roots)
 * are replaced wholesale — they are NOT merged or concatenated. This is
 * intentional: it allows a lower-layer override to completely redefine the
 * allowed paths without inheriting entries from higher layers that may not
 * apply.
 *
 * @param base - The base policy (typically from a higher config layer).
 * @param override - Partial override from a lower config layer.
 * @returns A new policy with override values applied.
 *
 * @example
 * ```ts
 * const projectPolicy = mergeFileScopePolicies(DEFAULT_FILE_SCOPE_POLICY, {
 *   write_roots: ["apps/web-ui/", "packages/shared/"],
 *   deny_roots: [".github/", "secrets/", "apps/api/migrations/"],
 * });
 * ```
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12 Configuration Precedence
 */
export function mergeFileScopePolicies(
  base: FileScopePolicy,
  override: FileScopePolicyOverride,
): FileScopePolicy {
  return {
    read_roots: override.read_roots ?? base.read_roots,
    write_roots: override.write_roots ?? base.write_roots,
    deny_roots: override.deny_roots ?? base.deny_roots,
    allow_read_outside_scope: override.allow_read_outside_scope ?? base.allow_read_outside_scope,
    allow_write_outside_scope: override.allow_write_outside_scope ?? base.allow_write_outside_scope,
    on_violation: override.on_violation ?? base.on_violation,
  };
}
