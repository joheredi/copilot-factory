/** @module @factory/control-plane — Backend orchestration service for state transitions, scheduling, leases, policies, API, and live events. */

export {
  createDatabaseConnection,
  runMigrations,
} from "./infrastructure/database/index.js";

export type {
  DatabaseConfig,
  DatabaseConnection,
  HealthCheckResult,
  MigrateConfig,
} from "./infrastructure/database/index.js";
