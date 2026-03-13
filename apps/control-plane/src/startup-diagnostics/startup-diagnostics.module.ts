/**
 * NestJS module for startup recovery diagnostics.
 *
 * Registers the {@link StartupDiagnosticsService} which runs once during
 * application bootstrap to log a summary of pending recovery items.
 * The service depends on the global {@link DatabaseModule} for database
 * access — no explicit import is needed since DatabaseModule is `@Global()`.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T148-startup-recovery-log.md}
 */
import { Module } from "@nestjs/common";

import { StartupDiagnosticsService } from "./startup-diagnostics.service.js";

@Module({
  providers: [StartupDiagnosticsService],
})
export class StartupDiagnosticsModule {}
