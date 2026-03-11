/**
 * Policy enforcement adapters for the infrastructure layer.
 *
 * This module provides the command execution wrapper that enforces
 * the domain-layer command policy before running any shell command
 * on behalf of a worker.
 *
 * @module @factory/infrastructure/policy
 */

export {
  PolicyViolationError,
  CommandExecutionError,
  createPolicyViolationArtifact,
  validateCommand,
  executeCommand,
  setProcessRunner,
  restoreDefaultProcessRunner,
} from "./command-wrapper.js";

export type {
  PolicyViolationArtifact,
  CommandExecutionOptions,
  CommandExecutionResult,
} from "./command-wrapper.js";
