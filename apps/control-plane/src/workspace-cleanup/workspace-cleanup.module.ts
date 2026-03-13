/**
 * NestJS module for startup workspace cleanup.
 *
 * Registers the {@link WorkspaceCleanupService} which runs once during
 * application bootstrap to scan for and clean up orphaned worktrees.
 * The service depends on the global {@link DatabaseModule} for database
 * access — no explicit import is needed since DatabaseModule is `@Global()`.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T149-workspace-cleanup.md}
 */
import { Module } from "@nestjs/common";

import { WorkspaceCleanupService } from "./workspace-cleanup.service.js";

@Module({
  providers: [WorkspaceCleanupService],
})
export class WorkspaceCleanupModule {}
