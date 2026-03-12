/**
 * Root application module for the control-plane NestJS service.
 *
 * Imports feature modules matching the domain model boundaries.
 * Each feature module will own its own controllers, services, and DTOs
 * once endpoint implementation proceeds (T081–T085).
 *
 * @see docs/prd/007-technical-architecture.md §7.5 for module layout
 * @module @factory/control-plane
 */
import { Module } from "@nestjs/common";

import { AuditModule } from "./audit/audit.module.js";
import { AutomationModule } from "./automation/automation.module.js";
import { EventsModule } from "./events/events.module.js";
import { HealthModule } from "./health/health.module.js";
import { DatabaseModule } from "./infrastructure/database/database.module.js";
import { MergeModule } from "./merge/merge.module.js";
import { MetricsModule } from "./metrics/metrics.module.js";
import { OperatorActionsModule } from "./operator-actions/operator-actions.module.js";
import { PolicyModule } from "./policy/policy.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { ReviewModule } from "./review/review.module.js";
import { TasksModule } from "./tasks/tasks.module.js";
import { ValidationModule } from "./validation/validation.module.js";
import { WorkersModule } from "./workers/workers.module.js";

/**
 * Root module that composes all feature modules.
 *
 * Module structure mirrors the domain model:
 * - HealthModule: liveness/readiness checks
 * - MetricsModule: Prometheus /metrics endpoint (§10.13)
 * - ProjectsModule: projects and repositories
 * - TasksModule: task lifecycle and dependencies
 * - WorkersModule: worker pools, agents, profiles
 * - ReviewModule: review cycles and packets
 * - MergeModule: merge queue management
 * - ValidationModule: validation run tracking
 * - AuditModule: audit event recording
 * - PolicyModule: policy set management
 * - EventsModule: WebSocket gateway for real-time event delivery (§7.7)
 * - OperatorActionsModule: operator action endpoints (§6.2)
 */
@Module({
  imports: [
    DatabaseModule,
    EventsModule,
    AutomationModule,
    HealthModule,
    MetricsModule,
    ProjectsModule,
    TasksModule,
    WorkersModule,
    ReviewModule,
    MergeModule,
    ValidationModule,
    AuditModule,
    PolicyModule,
    OperatorActionsModule,
  ],
})
export class AppModule {}
