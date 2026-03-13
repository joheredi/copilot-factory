/**
 * Handles HTTP requests for prompt template management.
 *
 * Provides CRUD endpoints for versioned prompt templates used by agent
 * profiles. Templates define prompt text, input/output schemas, and stop
 * conditions for each agent role.
 *
 * All write operations return the created/updated entity. Not-found
 * conditions throw {@link NotFoundException} which the global exception
 * filter maps to 404.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/prd/004-agent-contracts.md} §4 Agent contracts
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";

import { CreatePromptTemplateDto } from "./dtos/create-prompt-template.dto.js";
import { UpdatePromptTemplateDto } from "./dtos/update-prompt-template.dto.js";
import { PromptTemplatesService } from "./prompt-templates.service.js";
import type { PromptTemplate } from "../infrastructure/repositories/prompt-template.repository.js";

/**
 * REST controller for prompt template CRUD.
 *
 * Endpoints:
 * - `POST /prompt-templates` — Create a template
 * - `GET /prompt-templates` — List templates with optional role filter
 * - `GET /prompt-templates/:id` — Get template by ID
 * - `PUT /prompt-templates/:id` — Update template
 * - `DELETE /prompt-templates/:id` — Delete template
 */
@ApiTags("prompt-templates")
@Controller("prompt-templates")
export class PromptTemplatesController {
  /** @param promptTemplatesService Injected prompt templates service. */
  constructor(
    @Inject(PromptTemplatesService)
    private readonly promptTemplatesService: PromptTemplatesService,
  ) {}

  /**
   * Create a new prompt template.
   *
   * The template is assigned a UUID automatically. Required fields: name,
   * version, role, templateText.
   *
   * @param dto Validated creation payload.
   * @returns The newly created prompt template.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a prompt template" })
  @ApiResponse({ status: 201, description: "Prompt template created." })
  @ApiResponse({ status: 400, description: "Validation failed." })
  create(@Body() dto: CreatePromptTemplateDto): PromptTemplate {
    return this.promptTemplatesService.create(dto);
  }

  /**
   * List prompt templates with optional role filter.
   *
   * @param role Optional agent role to filter by (e.g. "developer").
   * @returns Array of matching prompt templates.
   */
  @Get()
  @ApiOperation({ summary: "List prompt templates with optional role filter" })
  @ApiQuery({ name: "role", required: false, description: "Filter by agent role" })
  @ApiResponse({ status: 200, description: "Prompt template list." })
  findAll(@Query("role") role?: string): PromptTemplate[] {
    return this.promptTemplatesService.findAll(role);
  }

  /**
   * Get a single prompt template by ID.
   *
   * @param id Prompt template UUID.
   * @returns The prompt template.
   * @throws NotFoundException if the template does not exist.
   */
  @Get(":id")
  @ApiOperation({ summary: "Get prompt template by ID" })
  @ApiParam({ name: "id", description: "Prompt template UUID" })
  @ApiResponse({ status: 200, description: "Prompt template detail." })
  @ApiResponse({ status: 404, description: "Prompt template not found." })
  findById(@Param("id") id: string): PromptTemplate {
    const template = this.promptTemplatesService.findById(id);
    if (!template) {
      throw new NotFoundException(`Prompt template with ID "${id}" not found`);
    }
    return template;
  }

  /**
   * Update a prompt template by ID.
   *
   * Only provided fields are updated. Optional fields can be set to `null`
   * to clear their value.
   *
   * @param id Prompt template UUID.
   * @param dto Validated update payload.
   * @returns The updated prompt template.
   * @throws NotFoundException if the template does not exist.
   */
  @Put(":id")
  @ApiOperation({ summary: "Update a prompt template" })
  @ApiParam({ name: "id", description: "Prompt template UUID" })
  @ApiResponse({ status: 200, description: "Prompt template updated." })
  @ApiResponse({ status: 400, description: "Validation failed." })
  @ApiResponse({ status: 404, description: "Prompt template not found." })
  update(@Param("id") id: string, @Body() dto: UpdatePromptTemplateDto): PromptTemplate {
    const template = this.promptTemplatesService.update(id, dto);
    if (!template) {
      throw new NotFoundException(`Prompt template with ID "${id}" not found`);
    }
    return template;
  }

  /**
   * Delete a prompt template by ID.
   *
   * @param id Prompt template UUID.
   * @throws NotFoundException if the template does not exist.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a prompt template" })
  @ApiParam({ name: "id", description: "Prompt template UUID" })
  @ApiResponse({ status: 204, description: "Prompt template deleted." })
  @ApiResponse({ status: 404, description: "Prompt template not found." })
  delete(@Param("id") id: string): void {
    const deleted = this.promptTemplatesService.delete(id);
    if (!deleted) {
      throw new NotFoundException(`Prompt template with ID "${id}" not found`);
    }
  }
}
