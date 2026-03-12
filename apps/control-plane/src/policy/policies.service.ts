/**
 * Service layer for policy set CRUD operations with pagination.
 *
 * Bridges NestJS dependency injection with the functional policy set
 * repository from the infrastructure layer. Provides list, get, and
 * update capabilities for the policy REST endpoints.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T085-api-audit-policy-config.md}
 */
import { Inject, Injectable } from "@nestjs/common";
import { count } from "drizzle-orm";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import { policySets } from "../infrastructure/database/schema.js";
import {
  createPolicySetRepository,
  type PolicySet,
} from "../infrastructure/repositories/policy-set.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import type { UpdatePolicySetDto } from "./dtos/update-policy-set.dto.js";

/** Shape of a paginated policy set response. */
export interface PaginatedPolicySetResponse {
  /** Policy set items for the current page. */
  data: PolicySet[];
  /** Pagination metadata. */
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Manages policy set CRUD operations.
 *
 * Policy sets are versioned bundles of configuration governing
 * scheduling, review, merge, security, validation, and budget
 * behaviors. This service provides paginated listing, single-record
 * retrieval, and partial updates.
 */
@Injectable()
export class PoliciesService {
  /** @param conn Injected database connection. */
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection) {}

  /**
   * List all policy sets with pagination.
   *
   * @param page 1-based page number.
   * @param limit Items per page.
   * @returns Paginated policy set response.
   */
  findAll(page: number, limit: number): PaginatedPolicySetResponse {
    const offset = (page - 1) * limit;

    const countResult = this.conn.db.select({ count: count() }).from(policySets).get();
    const total = countResult?.count ?? 0;

    const repo = createPolicySetRepository(this.conn.db);
    const data = repo.findAll({ limit, offset });

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find a single policy set by ID.
   *
   * @param id Policy set UUID.
   * @returns The policy set or `undefined` if not found.
   */
  findById(id: string): PolicySet | undefined {
    const repo = createPolicySetRepository(this.conn.db);
    return repo.findById(id);
  }

  /**
   * Update a policy set by ID with partial data.
   *
   * Only provided fields are updated; omitted fields remain unchanged.
   * The update is performed within a write transaction for consistency.
   *
   * @param id Policy set UUID.
   * @param dto Validated update payload.
   * @returns The updated policy set or `undefined` if not found.
   */
  update(id: string, dto: UpdatePolicySetDto): PolicySet | undefined {
    return this.conn.writeTransaction((db) => {
      const repo = createPolicySetRepository(db);
      const existing = repo.findById(id);
      if (!existing) {
        return undefined;
      }

      const updateData: Partial<Record<string, unknown>> = {};
      if (dto.name !== undefined) updateData["name"] = dto.name;
      if (dto.version !== undefined) updateData["version"] = dto.version;
      if (dto.schedulingPolicyJson !== undefined)
        updateData["schedulingPolicyJson"] = dto.schedulingPolicyJson;
      if (dto.reviewPolicyJson !== undefined) updateData["reviewPolicyJson"] = dto.reviewPolicyJson;
      if (dto.mergePolicyJson !== undefined) updateData["mergePolicyJson"] = dto.mergePolicyJson;
      if (dto.securityPolicyJson !== undefined)
        updateData["securityPolicyJson"] = dto.securityPolicyJson;
      if (dto.validationPolicyJson !== undefined)
        updateData["validationPolicyJson"] = dto.validationPolicyJson;
      if (dto.budgetPolicyJson !== undefined) updateData["budgetPolicyJson"] = dto.budgetPolicyJson;

      return repo.update(id, updateData);
    });
  }
}
