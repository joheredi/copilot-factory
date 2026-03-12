/**
 * NestJS module for audit event management.
 *
 * Owns controllers and services for querying the append-only
 * audit log with flexible multi-criteria filters, entity-scoped
 * timelines, and paginated results.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T085-api-audit-policy-config.md}
 */
import { Module } from "@nestjs/common";

import { AuditController } from "./audit.controller.js";
import { AuditService } from "./audit.service.js";

/** Feature module for audit trail endpoints. */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
