/**
 * Global NestJS module providing the SQLite database connection.
 *
 * Registers the {@link DatabaseConnection} as an injectable provider using
 * the {@link DATABASE_CONNECTION} string token. Marked `@Global()` so all
 * feature modules can inject the connection without explicit imports.
 *
 * The database file path is read from the `DATABASE_PATH` environment
 * variable, falling back to `./data/factory.db` for local development.
 *
 * @module @factory/control-plane
 */
import { Global, Module } from "@nestjs/common";

import { createDatabaseConnection } from "./connection.js";
import type { DatabaseConnection } from "./connection.js";

/** Injection token for the {@link DatabaseConnection} provider. */
export const DATABASE_CONNECTION = "DATABASE_CONNECTION";

/**
 * Provides a singleton {@link DatabaseConnection} to the entire application.
 *
 * The connection is created once at application startup and shared across
 * all modules. WAL mode, busy timeout, and foreign keys are configured
 * by the underlying {@link createDatabaseConnection} factory.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      useFactory: (): DatabaseConnection => {
        const dbPath = process.env["DATABASE_PATH"] ?? "./data/factory.db";
        return createDatabaseConnection({ filePath: dbPath });
      },
    },
  ],
  exports: [DATABASE_CONNECTION],
})
export class DatabaseModule {}
