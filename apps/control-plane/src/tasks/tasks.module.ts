/**
 * NestJS module for task lifecycle management.
 *
 * Owns the controller and service for task CRUD, filtering, and
 * detail retrieval. State transitions go through the centralized
 * Transition Service (not part of this module).
 *
 * @module @factory/control-plane
 */
import { Module } from "@nestjs/common";

import { TasksController } from "./tasks.controller.js";
import { TasksService } from "./tasks.service.js";

/** Feature module for task management endpoints. */
@Module({
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
