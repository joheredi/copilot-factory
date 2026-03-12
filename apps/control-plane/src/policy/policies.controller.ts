/**
 * REST controller for policy set management.
 *
 * Exposes endpoints for listing, retrieving, and updating versioned
 * policy sets that govern scheduling, review, merge, security,
 * validation, and budget behaviors.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T085-api-audit-policy-config.md}
 */
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
  Inject,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";

import { PoliciesService } from "./policies.service.js";
import { PolicyQueryDto } from "./dtos/policy-query.dto.js";
import { UpdatePolicySetDto } from "./dtos/update-policy-set.dto.js";
import {
  mapPolicySet,
  mapPaginated,
  type PolicySetResponse,
  type MappedPaginatedResponse,
} from "../common/response-mappers.js";

/**
 * Handles HTTP requests for policy set management.
 *
 * Policy sets are versioned configuration bundles. Updates persist
 * immediately; the effective configuration seen by workers depends
 * on the hierarchical resolution at runtime.
 */
@ApiTags("policies")
@Controller("policies")
export class PoliciesController {
  /** @param policiesService Injected policies service. */
  constructor(@Inject(PoliciesService) private readonly policiesService: PoliciesService) {}

  /**
   * List all policy sets with pagination.
   *
   * @param query Pagination parameters.
   * @returns Paginated list of policy sets.
   */
  @Get()
  @ApiOperation({ summary: "List policy sets with pagination" })
  @ApiQuery({ name: "page", required: false, description: "Page number (1-based, default: 1)" })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Items per page (1-100, default: 20)",
  })
  @ApiResponse({ status: 200, description: "Paginated policy set list." })
  findAll(@Query() query: PolicyQueryDto): MappedPaginatedResponse<PolicySetResponse> {
    return mapPaginated(this.policiesService.findAll(query.page, query.limit), mapPolicySet);
  }

  /**
   * Get a single policy set by ID.
   *
   * @param id Policy set UUID.
   * @returns The policy set.
   * @throws NotFoundException if the policy set does not exist.
   */
  @Get(":id")
  @ApiOperation({ summary: "Get policy set by ID" })
  @ApiParam({ name: "id", description: "Policy set UUID" })
  @ApiResponse({ status: 200, description: "Policy set detail." })
  @ApiResponse({ status: 404, description: "Policy set not found." })
  findById(@Param("id") id: string): PolicySetResponse {
    const policySet = this.policiesService.findById(id);
    if (!policySet) {
      throw new NotFoundException(`Policy set with ID "${id}" not found`);
    }
    return mapPolicySet(policySet);
  }

  /**
   * Update a policy set by ID.
   *
   * Only provided fields are updated; omitted fields remain unchanged.
   * Policy JSON fields accept arbitrary objects stored as JSON.
   *
   * @param id Policy set UUID.
   * @param dto Validated update payload.
   * @returns The updated policy set.
   * @throws NotFoundException if the policy set does not exist.
   */
  @Put(":id")
  @ApiOperation({ summary: "Update a policy set" })
  @ApiParam({ name: "id", description: "Policy set UUID" })
  @ApiResponse({ status: 200, description: "Policy set updated." })
  @ApiResponse({ status: 400, description: "Validation failed." })
  @ApiResponse({ status: 404, description: "Policy set not found." })
  update(@Param("id") id: string, @Body() dto: UpdatePolicySetDto): PolicySetResponse {
    const policySet = this.policiesService.update(id, dto);
    if (!policySet) {
      throw new NotFoundException(`Policy set with ID "${id}" not found`);
    }
    return mapPolicySet(policySet);
  }
}
