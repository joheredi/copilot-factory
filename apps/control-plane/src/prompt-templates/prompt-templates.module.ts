/**
 * NestJS module for prompt template management.
 *
 * Registers the controller and service for prompt template CRUD.
 * Templates define versioned prompts, input/output schemas, and stop
 * conditions for each agent role.
 *
 * @module @factory/control-plane
 */
import { Module } from "@nestjs/common";

import { PromptTemplatesController } from "./prompt-templates.controller.js";
import { PromptTemplatesService } from "./prompt-templates.service.js";

/** Feature module for prompt template endpoints. */
@Module({
  controllers: [PromptTemplatesController],
  providers: [PromptTemplatesService],
})
export class PromptTemplatesModule {}
