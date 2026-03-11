/**
 * Port interfaces for policy snapshot generation.
 *
 * Defines the contracts that infrastructure adapters must implement
 * to support policy snapshot generation in the application layer.
 * The loader port abstracts config layer retrieval from databases or
 * files, and the artifact port abstracts snapshot persistence.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.2 — Effective Policy Snapshot
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12 — Configuration Precedence
 * @module @factory/application/ports/policy-snapshot
 */

import type { ConfigLayerEntry } from "@factory/config";
import type { PolicySnapshot } from "@factory/schemas";

// ---------------------------------------------------------------------------
// Config layer loading
// ---------------------------------------------------------------------------

/**
 * Context identifying what the policy snapshot is being generated for.
 *
 * Used by the {@link ConfigLayerLoaderPort} to determine which
 * configuration layers to load and in what order.
 */
export interface PolicySnapshotContext {
  /** The task identifier — used to load task-level and task-type overrides. */
  readonly taskId: string;
  /** The worker pool identifier — used to load pool-level overrides. */
  readonly poolId: string;
  /** The run identifier — used for audit trail and artifact association. */
  readonly runId: string;
}

/**
 * Port for loading ordered configuration layer entries.
 *
 * Implementations retrieve configuration overrides from the appropriate
 * sources (database, files, environment) and return them in
 * non-decreasing precedence order as required by {@link resolveConfig}.
 *
 * The system defaults layer is applied automatically by the resolver
 * and should NOT be included in the returned entries.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12
 */
export interface ConfigLayerLoaderPort {
  /**
   * Load all applicable configuration layer entries for the given context.
   *
   * @param context - Identifies the task, pool, and run being configured.
   * @returns Ordered config layer entries (lowest precedence first).
   *          The system defaults layer must NOT be included.
   */
  loadLayers(context: PolicySnapshotContext): Promise<readonly ConfigLayerEntry[]>;
}

// ---------------------------------------------------------------------------
// Snapshot artifact persistence
// ---------------------------------------------------------------------------

/**
 * Port for persisting a policy snapshot as an immutable run-level artifact.
 *
 * Once persisted, the snapshot must not be modified for the lifetime
 * of the run. Implementations may store the snapshot as a JSON file
 * in the artifact directory, a database record, or any other durable store.
 */
export interface PolicySnapshotArtifactPort {
  /**
   * Persist the policy snapshot for the given run.
   *
   * @param runId - The run to associate the snapshot with.
   * @param snapshot - The validated, immutable policy snapshot.
   * @returns The storage path or identifier where the snapshot was persisted.
   */
  persist(runId: string, snapshot: PolicySnapshot): Promise<string>;
}
