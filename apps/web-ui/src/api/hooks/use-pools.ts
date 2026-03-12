/**
 * TanStack Query hooks for Worker Pool and Agent Profile operations.
 *
 * @module
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPut } from "../client";
import { queryKeys } from "../query-keys";
import type {
  AgentProfile,
  CreateAgentProfileInput,
  CreatePoolInput,
  PaginatedResponse,
  PoolListParams,
  UpdateAgentProfileInput,
  UpdatePoolInput,
  WorkerPool,
} from "../types";

// ---------------------------------------------------------------------------
// Pool Queries
// ---------------------------------------------------------------------------

/**
 * Fetches a paginated list of worker pools with optional filters.
 *
 * @param params - Filter by poolType, enabled status, and pagination.
 */
export function usePools(params?: PoolListParams) {
  return useQuery({
    queryKey: queryKeys.pools.lists(params),
    queryFn: () =>
      apiGet<PaginatedResponse<WorkerPool>>("/pools", params as Record<string, unknown>),
  });
}

/**
 * Fetches a single pool by ID (enriched with worker count, etc.).
 *
 * Disabled when `id` is falsy for conditional usage.
 */
export function usePool(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.pools.detail(id ?? ""),
    queryFn: () => apiGet<WorkerPool>(`/pools/${id}`),
    enabled: !!id,
  });
}

/**
 * Fetches the list of active workers in a specific pool.
 */
export function usePoolWorkers(poolId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.pools.workers(poolId ?? ""),
    queryFn: () => apiGet<unknown[]>(`/pools/${poolId}/workers`),
    enabled: !!poolId,
  });
}

// ---------------------------------------------------------------------------
// Pool Mutations
// ---------------------------------------------------------------------------

/** Creates a new worker pool. */
export function useCreatePool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePoolInput) => apiPost<WorkerPool>("/pools", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pools.all });
    },
  });
}

/** Updates an existing worker pool. */
export function useUpdatePool(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePoolInput) => apiPut<WorkerPool>(`/pools/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pools.all });
    },
  });
}

/** Deletes a worker pool. */
export function useDeletePool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/pools/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pools.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Agent Profile Queries
// ---------------------------------------------------------------------------

/**
 * Fetches all agent profiles attached to a pool.
 */
export function useAgentProfiles(poolId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.profiles.lists(poolId ?? ""),
    queryFn: () => apiGet<AgentProfile[]>(`/pools/${poolId}/profiles`),
    enabled: !!poolId,
  });
}

/**
 * Fetches a single agent profile by pool and profile IDs.
 */
export function useAgentProfile(poolId: string | undefined, profileId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.profiles.detail(poolId ?? "", profileId ?? ""),
    queryFn: () => apiGet<AgentProfile>(`/pools/${poolId}/profiles/${profileId}`),
    enabled: !!poolId && !!profileId,
  });
}

// ---------------------------------------------------------------------------
// Agent Profile Mutations
// ---------------------------------------------------------------------------

/** Creates an agent profile within a pool. */
export function useCreateAgentProfile(poolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentProfileInput) =>
      apiPost<AgentProfile>(`/pools/${poolId}/profiles`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles.lists(poolId) });
    },
  });
}

/** Updates an agent profile. */
export function useUpdateAgentProfile(poolId: string, profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAgentProfileInput) =>
      apiPut<AgentProfile>(`/pools/${poolId}/profiles/${profileId}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
  });
}

/** Deletes an agent profile. */
export function useDeleteAgentProfile(poolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) => apiDelete(`/pools/${poolId}/profiles/${profileId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles.lists(poolId) });
    },
  });
}
