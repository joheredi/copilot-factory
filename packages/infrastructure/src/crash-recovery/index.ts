/**
 * @module crash-recovery
 * Infrastructure adapters for crash recovery — workspace inspection,
 * artifact capture, and result packet validation.
 *
 * These adapters implement the application-layer ports defined in
 * {@link @factory/application/ports/crash-recovery.ports} using concrete
 * infrastructure: filesystem access, git CLI, artifact store, and Zod schemas.
 *
 * @see docs/backlog/tasks/T072-partial-work-snapshot.md
 */

// ─── Workspace Inspector ───────────────────────────────────────────────────

export { createWorkspaceInspector, createExecGitDiffProvider } from "./workspace-inspector.js";

export type { GitDiffProvider, WorkspaceInspectorDependencies } from "./workspace-inspector.js";

// ─── Crash Recovery Artifact Adapter ────────────────────────────────────────

export { createCrashRecoveryArtifactAdapter } from "./crash-recovery-artifact-adapter.js";

// ─── Result Packet Validator ────────────────────────────────────────────────

export { createResultPacketValidator } from "./result-packet-validator.js";
