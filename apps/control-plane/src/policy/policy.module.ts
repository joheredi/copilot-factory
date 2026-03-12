/**
 * NestJS module for policy and configuration management.
 *
 * Owns controllers and services for policy set CRUD,
 * hierarchical config resolution, and effective configuration
 * inspection with field-level source tracking.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T085-api-audit-policy-config.md}
 */
import { Module } from "@nestjs/common";

import { ConfigController } from "./config.controller.js";
import { ConfigService } from "./config.service.js";
import { PoliciesController } from "./policies.controller.js";
import { PoliciesService } from "./policies.service.js";

/** Feature module for policy and configuration endpoints. */
@Module({
  controllers: [PoliciesController, ConfigController],
  providers: [PoliciesService, ConfigService],
})
export class PolicyModule {}
