/** @module @factory/config — Hierarchical config resolution, policy loading, and effective snapshot generation. */

export { DEFAULT_COMMAND_POLICY, mergeCommandPolicies } from "./defaults/command-policy.js";

export type { CommandPolicyOverride } from "./defaults/command-policy.js";

export { DEFAULT_FILE_SCOPE_POLICY, mergeFileScopePolicies } from "./defaults/file-scope-policy.js";

export type { FileScopePolicyOverride } from "./defaults/file-scope-policy.js";
