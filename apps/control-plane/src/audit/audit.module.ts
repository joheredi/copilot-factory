/**
 * NestJS module for audit event management.
 *
 * Will own controllers and services for querying the append-only
 * audit log, filtering by entity/actor/event type, and timeline
 * views once T085 is implemented.
 *
 * @module @factory/control-plane
 */
import { Module } from "@nestjs/common";

/** Feature module for audit trail endpoints. */
@Module({})
export class AuditModule {}
