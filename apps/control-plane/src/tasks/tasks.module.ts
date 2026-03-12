/**
 * NestJS module for task lifecycle management.
 *
 * Owns the controller and service for task CRUD, filtering, detail
 * retrieval, and audit timeline queries. State transitions go through
 * the centralized Transition Service (not part of this module).
 *
 * @module @factory/control-plane
 */
import { Module } from "@nestjs/common";

import { AuditService } from "../audit/audit.service.js";
import { TasksController } from "./tasks.controller.js";
import { TasksService } from "./tasks.service.js";

/** Feature module for task management endpoints. */
@Module({
  controllers: [TasksController],
  providers: [TasksService, AuditService],
})
export class TasksModule {}
