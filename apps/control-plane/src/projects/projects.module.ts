/**
 * NestJS module for project and repository management.
 *
 * Registers controllers and services for CRUD operations on projects
 * and their associated Git repositories.
 *
 * @module @factory/control-plane
 */
import { Module } from "@nestjs/common";

import { ProjectsController } from "./projects.controller.js";
import { ProjectsService } from "./projects.service.js";
import { RepositoriesController } from "./repositories.controller.js";
import { RepositoriesService } from "./repositories.service.js";

/** Feature module for project/repository endpoints. */
@Module({
  controllers: [ProjectsController, RepositoriesController],
  providers: [ProjectsService, RepositoriesService],
})
export class ProjectsModule {}
