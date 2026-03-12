/**
 * REST controller for audit event queries.
 *
 * Exposes endpoints for searching the append-only audit log with
 * flexible multi-criteria filters and pagination. The audit trail
 * records all significant system events (state transitions, lease
 * operations, policy applications, operator overrides, etc.).
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T085-api-audit-policy-config.md}
 */
import { Controller, Get, Query, Inject } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";

import { AuditService } from "./audit.service.js";
import { AuditQueryDto } from "./dtos/audit-query.dto.js";
import {
  mapAuditEvent,
  mapPaginated,
  type AuditEventResponse,
  type MappedPaginatedResponse,
} from "../common/response-mappers.js";

/**
 * Handles HTTP requests for audit event queries.
 *
 * Provides a search endpoint supporting all filter combinations:
 * entity type/ID, event type, actor type/ID, and time range.
 * Results are paginated and ordered by time descending.
 */
@ApiTags("audit")
@Controller("audit")
export class AuditController {
  /** @param auditService Injected audit service. */
  constructor(@Inject(AuditService) private readonly auditService: AuditService) {}

  /**
   * Search audit events with optional filters and pagination.
   *
   * All filter parameters are optional and combined with AND semantics.
   * When no filters are provided, returns all events paginated.
   * Results are ordered by time descending (most recent first).
   *
   * @param query Validated filter and pagination parameters.
   * @returns Paginated list of audit events.
   */
  @Get()
  @ApiOperation({ summary: "Search audit events with filters" })
  @ApiQuery({ name: "page", required: false, description: "Page number (1-based, default: 1)" })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Items per page (1-100, default: 20)",
  })
  @ApiQuery({
    name: "entityType",
    required: false,
    description: 'Filter by entity type (e.g. "task", "lease")',
  })
  @ApiQuery({ name: "entityId", required: false, description: "Filter by entity ID" })
  @ApiQuery({
    name: "eventType",
    required: false,
    description: 'Filter by event type (e.g. "state_transition")',
  })
  @ApiQuery({
    name: "actorType",
    required: false,
    description: 'Filter by actor type (e.g. "system", "worker")',
  })
  @ApiQuery({ name: "actorId", required: false, description: "Filter by actor ID" })
  @ApiQuery({
    name: "start",
    required: false,
    description: "Filter for events on or after this ISO 8601 timestamp",
  })
  @ApiQuery({
    name: "end",
    required: false,
    description: "Filter for events on or before this ISO 8601 timestamp",
  })
  @ApiResponse({ status: 200, description: "Paginated audit event list." })
  search(@Query() query: AuditQueryDto): MappedPaginatedResponse<AuditEventResponse> {
    return mapPaginated(
      this.auditService.search(query.page, query.limit, {
        entityType: query.entityType,
        entityId: query.entityId,
        eventType: query.eventType,
        actorType: query.actorType,
        actorId: query.actorId,
        startTime: query.start,
        endTime: query.end,
      }),
      mapAuditEvent,
    );
  }
}
