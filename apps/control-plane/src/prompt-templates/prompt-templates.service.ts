/**
 * Service for prompt template management — creation, listing, retrieval,
 * update, and deletion.
 *
 * Prompt templates define versioned prompts, input/output schemas, and
 * stop conditions for each agent role. Templates are referenced by agent
 * profiles to configure how AI workers behave during task execution.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/prd/004-agent-contracts.md} §4 Agent contracts
 */
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import { createPromptTemplateRepository } from "../infrastructure/repositories/prompt-template.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import type { PromptTemplate } from "../infrastructure/repositories/prompt-template.repository.js";
import type { CreatePromptTemplateDto } from "./dtos/create-prompt-template.dto.js";
import type { UpdatePromptTemplateDto } from "./dtos/update-prompt-template.dto.js";

/**
 * Manages prompt template lifecycle — CRUD operations and role-based queries.
 */
@Injectable()
export class PromptTemplatesService {
  /** @param conn Injected database connection. */
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection) {}

  /**
   * Create a new prompt template.
   *
   * Generates a UUID for the template and persists it with the provided
   * configuration.
   *
   * @param dto Validated creation payload.
   * @returns The newly created prompt template row.
   */
  create(dto: CreatePromptTemplateDto): PromptTemplate {
    return this.conn.writeTransaction((db) => {
      const repo = createPromptTemplateRepository(db);
      return repo.create({
        promptTemplateId: randomUUID(),
        name: dto.name,
        version: dto.version,
        role: dto.role,
        templateText: dto.templateText,
        inputSchema: dto.inputSchema ?? null,
        outputSchema: dto.outputSchema ?? null,
        stopConditions: dto.stopConditions ?? null,
      });
    });
  }

  /**
   * List prompt templates, optionally filtered by role.
   *
   * @param role Optional agent role to filter by.
   * @returns Array of matching prompt templates.
   */
  findAll(role?: string): PromptTemplate[] {
    if (role) {
      const repo = createPromptTemplateRepository(this.conn.db);
      return repo.findByRole(role);
    }
    const repo = createPromptTemplateRepository(this.conn.db);
    return repo.findAll();
  }

  /**
   * Find a single prompt template by ID.
   *
   * @param id Prompt template UUID.
   * @returns The template or `undefined` if not found.
   */
  findById(id: string): PromptTemplate | undefined {
    const repo = createPromptTemplateRepository(this.conn.db);
    return repo.findById(id);
  }

  /**
   * Update a prompt template by ID.
   *
   * Only provided fields are updated. Optional fields can be set to `null`
   * to clear their value.
   *
   * @param id Prompt template UUID.
   * @param dto Validated update payload.
   * @returns The updated template or `undefined` if not found.
   */
  update(id: string, dto: UpdatePromptTemplateDto): PromptTemplate | undefined {
    return this.conn.writeTransaction((db) => {
      const repo = createPromptTemplateRepository(db);
      const existing = repo.findById(id);
      if (!existing) {
        return undefined;
      }

      const data: Record<string, unknown> = {};
      if (dto.name !== undefined) data["name"] = dto.name;
      if (dto.version !== undefined) data["version"] = dto.version;
      if (dto.role !== undefined) data["role"] = dto.role;
      if (dto.templateText !== undefined) data["templateText"] = dto.templateText;
      if (dto.inputSchema !== undefined) data["inputSchema"] = dto.inputSchema;
      if (dto.outputSchema !== undefined) data["outputSchema"] = dto.outputSchema;
      if (dto.stopConditions !== undefined) data["stopConditions"] = dto.stopConditions;

      return repo.update(id, data);
    });
  }

  /**
   * Delete a prompt template by ID.
   *
   * @param id Prompt template UUID.
   * @returns True if deleted, false if not found.
   */
  delete(id: string): boolean {
    return this.conn.writeTransaction((db) => {
      const repo = createPromptTemplateRepository(db);
      return repo.delete(id);
    });
  }
}
