/**
 * NestJS module for task lifecycle management.
 *
 * Will own controllers and services for task CRUD, state transitions,
 * dependency graph queries, and lease management once T082 is implemented.
 *
 * @module @factory/control-plane
 */
import { Module } from "@nestjs/common";

/** Feature module for task management endpoints. */
@Module({})
export class TasksModule {}
