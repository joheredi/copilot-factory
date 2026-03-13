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
import { FactoryStateModule } from "./factory-state/factory-state.module.js";
import { HealthModule } from "./health/health.module.js";
import { ImportModule } from "./import/import.module.js";
import { DatabaseModule } from "./infrastructure/database/database.module.js";
import { MergeModule } from "./merge/merge.module.js";
import { MetricsModule } from "./metrics/metrics.module.js";
import { OperatorActionsModule } from "./operator-actions/operator-actions.module.js";
import { PolicyModule } from "./policy/policy.module.js";
import { PromptTemplatesModule } from "./prompt-templates/prompt-templates.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { ReviewModule } from "./review/review.module.js";
import { StartupDiagnosticsModule } from "./startup-diagnostics/startup-diagnostics.module.js";
import { StaticServeModule } from "./static-serve/static-serve.module.js";
import { TasksModule } from "./tasks/tasks.module.js";
import { ValidationModule } from "./validation/validation.module.js";
import { WorkersModule } from "./workers/workers.module.js";
import { WorkspaceCleanupModule } from "./workspace-cleanup/workspace-cleanup.module.js";

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
 * - ImportModule: task import discovery and execution (T115)
 * - EventsModule: WebSocket gateway for real-time event delivery (§7.7)
 * - OperatorActionsModule: operator action endpoints (§6.2)
 * - StartupDiagnosticsModule: recovery status logging on startup (T148)
 * - WorkspaceCleanupModule: orphaned worktree cleanup on startup (T149)
 * - StaticServeModule: optional web-ui static file serving (T120)
 */
@Module({
  imports: [
    DatabaseModule,
    EventsModule,
    AutomationModule,
    FactoryStateModule,
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
    PromptTemplatesModule,
    ImportModule,
    OperatorActionsModule,
    StartupDiagnosticsModule,
    WorkspaceCleanupModule,
    StaticServeModule,
  ],
})
export class AppModule {}
