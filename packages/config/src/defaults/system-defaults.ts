/**
 * System-level defaults for all 8 sub-policies.
 *
 * This is the lowest precedence layer (layer 1 of 8) in the hierarchical
 * configuration resolution. Every field has a defined value, providing
 * a complete baseline that higher-precedence layers can selectively override.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12 — Configuration Precedence
 * @module @factory/config/defaults/system-defaults
 */

import type { FactoryConfig } from "../types.js";
import { DEFAULT_COMMAND_POLICY } from "./command-policy.js";
import { DEFAULT_ESCALATION_POLICY } from "./escalation-policy.js";
import { DEFAULT_FILE_SCOPE_POLICY } from "./file-scope-policy.js";
import { DEFAULT_LEASE_POLICY } from "./lease-policy.js";
import { DEFAULT_RETENTION_POLICY } from "./retention-policy.js";
import { DEFAULT_RETRY_POLICY } from "./retry-policy.js";
import { DEFAULT_REVIEW_POLICY } from "./review-policy.js";
import { DEFAULT_VALIDATION_POLICY } from "./validation-policy.js";

/**
 * Complete system-level defaults for the factory configuration.
 *
 * This represents the V1 baseline configuration with sensible defaults
 * drawn from the PRD specifications. Every sub-policy has a complete
 * set of values so the system can operate even with no configuration
 * overrides at any level.
 */
export const SYSTEM_DEFAULTS: FactoryConfig = {
  command_policy: DEFAULT_COMMAND_POLICY,
  file_scope_policy: DEFAULT_FILE_SCOPE_POLICY,
  validation_policy: DEFAULT_VALIDATION_POLICY,
  retry_policy: DEFAULT_RETRY_POLICY,
  escalation_policy: DEFAULT_ESCALATION_POLICY,
  lease_policy: DEFAULT_LEASE_POLICY,
  retention_policy: DEFAULT_RETENTION_POLICY,
  review_policy: DEFAULT_REVIEW_POLICY,
};
