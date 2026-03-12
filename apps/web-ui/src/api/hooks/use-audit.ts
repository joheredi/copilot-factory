/**
 * TanStack Query hooks for the audit log endpoint.
 *
 * @module
 */

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { queryKeys } from "../query-keys";
import type { AuditEvent, AuditListParams, PaginatedResponse } from "../types";

/**
 * Fetches a paginated audit log with optional filters.
 *
 * Supports filtering by entity, event type, actor, and time range.
 * Results are ordered by timestamp descending (newest first).
 *
 * @param params - Filter and pagination parameters.
 */
export function useAuditLog(params?: AuditListParams) {
  return useQuery({
    queryKey: queryKeys.audit.lists(params),
    queryFn: () =>
      apiGet<PaginatedResponse<AuditEvent>>("/audit", params as Record<string, unknown>),
  });
}
