/**
 * TanStack Query hooks for the health-check endpoint.
 *
 * @module
 */

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { queryKeys } from "../query-keys";
import type { HealthResponse } from "../types";

/**
 * Fetches the control-plane health status.
 *
 * Polls every 30 seconds (via staleTime default) so the dashboard
 * can display a live connectivity indicator.
 *
 * @returns TanStack Query result containing the health response.
 */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health.all,
    queryFn: () => apiGet<HealthResponse>("/health"),
  });
}
