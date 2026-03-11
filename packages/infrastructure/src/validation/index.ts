/**
 * Validation infrastructure adapters.
 *
 * This module provides the concrete implementation of the validation
 * check execution port, executing commands through the policy-aware
 * command wrapper.
 *
 * @module @factory/infrastructure/validation
 */

export { createCheckExecutor } from "./check-executor.js";

export type {
  CheckExecutorConfig,
  CheckExecutorPort,
  CheckExecutionResult,
  ExecuteCheckParams,
} from "./check-executor.js";
