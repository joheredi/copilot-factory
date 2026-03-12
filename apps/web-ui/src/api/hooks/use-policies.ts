/**
 * TanStack Query hooks for policy and configuration endpoints.
 *
 * @module
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "../client";
import { queryKeys } from "../query-keys";
import type {
  EffectiveConfig,
  PaginatedResponse,
  PaginationParams,
  PolicySet,
  UpdatePolicySetInput,
} from "../types";

/**
 * Fetches a paginated list of policy sets.
 *
 * @param params - Pagination parameters.
 */
export function usePolicies(params?: PaginationParams) {
  return useQuery({
    queryKey: queryKeys.policies.lists(params),
    queryFn: () =>
      apiGet<PaginatedResponse<PolicySet>>("/policies", params as Record<string, unknown>),
  });
}

/**
 * Fetches a single policy set by ID.
 *
 * Disabled when `id` is falsy.
 */
export function usePolicy(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.policies.detail(id ?? ""),
    queryFn: () => apiGet<PolicySet>(`/policies/${id}`),
    enabled: !!id,
  });
}

/**
 * Fetches the effective (merged) configuration.
 *
 * Returns the fully resolved config with source tracking for each layer.
 */
export function useEffectiveConfig() {
  return useQuery({
    queryKey: queryKeys.policies.effective(),
    queryFn: () => apiGet<EffectiveConfig>("/config/effective"),
  });
}

/**
 * Updates a policy set.
 *
 * Invalidates all policy queries and the effective config on success.
 */
export function useUpdatePolicy(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePolicySetInput) => apiPut<PolicySet>(`/policies/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.policies.all });
    },
  });
}
