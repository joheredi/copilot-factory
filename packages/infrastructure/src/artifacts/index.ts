/**
 * @module artifacts
 * Filesystem-based artifact storage module.
 *
 * Provides the {@link ArtifactStore} for persisting task artifacts
 * (packets, logs, validation results, reviews, merges, summaries)
 * in the structured directory layout defined by §7.11.
 *
 * @see docs/prd/007-technical-architecture.md §7.11 — Artifact Storage Layout
 */

// ─── Store ─────────────────────────────────────────────────────────────────────

export { ArtifactStore, ArtifactStorageError, ArtifactNotFoundError } from "./artifact-store.js";

export type { ArtifactStoreConfig } from "./artifact-store.js";

// ─── Path Builders ─────────────────────────────────────────────────────────────

export {
  taskBasePath,
  packetPath,
  runLogPath,
  runOutputPath,
  runValidationPath,
  reviewArtifactPath,
  mergeArtifactPath,
  summaryPath,
} from "./artifact-store.js";
