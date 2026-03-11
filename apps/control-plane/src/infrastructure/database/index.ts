/**
 * Database module — SQLite connection management and Drizzle ORM integration.
 *
 * @module
 */

export { createDatabaseConnection } from "./connection.js";
export type { DatabaseConfig, DatabaseConnection, HealthCheckResult } from "./connection.js";

export { runMigrations } from "./migrate.js";
export type { MigrateConfig } from "./migrate.js";
