/**
 * NestJS module for task import functionality.
 *
 * Provides the import discovery endpoint (`POST /import/discover`) that
 * scans local directories for task files and returns a preview. The module
 * is self-contained — it does not depend on the database module since
 * discovery is read-only.
 *
 * @module @factory/control-plane
 * @see T115 — Create POST /import/discover endpoint
 */
import { Module } from "@nestjs/common";

import { ImportController } from "./import.controller.js";
import { ImportService } from "./import.service.js";

/**
 * Module that owns task import operations.
 *
 * Currently provides only the discovery endpoint. The execution endpoint
 * (T116) will be added in a future task and will require DatabaseModule.
 */
@Module({
  controllers: [ImportController],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportModule {}
