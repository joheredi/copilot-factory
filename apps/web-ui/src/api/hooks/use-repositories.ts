/**
 * TanStack Query hooks for Repository CRUD operations.
 *
 * Repositories are scoped under projects for creation and listing.
 *
 * @module
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPut } from "../client";
import { queryKeys } from "../query-keys";
import type {
  CreateRepositoryInput,
  PaginatedResponse,
  PaginationParams,
  Repository,
  UpdateRepositoryInput,
} from "../types";

/**
 * Fetches a paginated list of repositories for a project.
 *
 * @param projectId - Parent project UUID.
 * @param params    - Pagination parameters.
 */
export function useRepositories(projectId: string | undefined, params?: PaginationParams) {
  return useQuery({
    queryKey: queryKeys.repositories.lists(projectId ?? "", params),
    queryFn: () =>
      apiGet<PaginatedResponse<Repository>>(
        `/projects/${projectId}/repositories`,
        params as Record<string, unknown>,
      ),
    enabled: !!projectId,
  });
}

/**
 * Fetches a single repository by ID.
 *
 * Disabled when `id` is falsy.
 */
export function useRepository(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.repositories.detail(id ?? ""),
    queryFn: () => apiGet<Repository>(`/repositories/${id}`),
    enabled: !!id,
  });
}

/**
 * Creates a repository within a project.
 *
 * Invalidates repository list queries on success.
 */
export function useCreateRepository(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRepositoryInput) =>
      apiPost<Repository>(`/projects/${projectId}/repositories`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repositories.all });
    },
  });
}

/**
 * Updates a repository.
 *
 * Invalidates all repository queries on success.
 */
export function useUpdateRepository(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRepositoryInput) => apiPut<Repository>(`/repositories/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repositories.all });
    },
  });
}

/**
 * Deletes a repository.
 *
 * Invalidates all repository queries on success.
 */
export function useDeleteRepository() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/repositories/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repositories.all });
    },
  });
}
