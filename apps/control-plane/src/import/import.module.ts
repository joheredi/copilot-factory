/**
 * NestJS module for task import functionality.
 *
 * Provides the import discovery endpoint (`POST /import/discover`) and
 * the import execution endpoint (`POST /import/execute`). The execution
 * endpoint requires the database connection, which is provided by the
 * global {@link DatabaseModule}.
 *
 * @module @factory/control-plane
 * @see T115 — Create POST /import/discover endpoint
 * @see T116 — Create POST /import/execute endpoint
 */
import { Module } from "@nestjs/common";

import { ImportController } from "./import.controller.js";
import { ImportService } from "./import.service.js";

/**
 * Module that owns task import operations.
 *
 * Provides both discovery (read-only preview) and execution (database write)
 * endpoints. The database connection is injected from the global
 * {@link DatabaseModule} — no explicit import is needed.
 */
@Module({
  controllers: [ImportController],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportModule {}
