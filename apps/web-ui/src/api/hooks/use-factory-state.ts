/**
 * TanStack Query hooks for the factory start/pause state.
 *
 * @module
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../client";
import { queryKeys } from "../query-keys";

/** Factory state response from the control plane. */
export interface FactoryStateResponse {
  state: "running" | "paused";
}

/**
 * Fetches the current factory state (running or paused).
 *
 * Polls every 10 seconds as a fallback, but primary updates
 * come via WebSocket cache invalidation.
 */
export function useFactoryState() {
  return useQuery({
    queryKey: queryKeys.factoryState.all,
    queryFn: () => apiGet<FactoryStateResponse>("/factory/state"),
    staleTime: 10_000,
  });
}

/**
 * Mutation to start the factory production line.
 * Invalidates the factory state cache on success.
 */
export function useStartFactory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<FactoryStateResponse>("/factory/state/start", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.factoryState.all });
    },
  });
}

/**
 * Mutation to pause the factory production line.
 * Invalidates the factory state cache on success.
 */
export function usePauseFactory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<FactoryStateResponse>("/factory/state/pause", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.factoryState.all });
    },
  });
}
