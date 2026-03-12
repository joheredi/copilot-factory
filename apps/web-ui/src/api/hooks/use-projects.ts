/**
 * TanStack Query hooks for Project CRUD operations.
 *
 * @module
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPut } from "../client";
import { queryKeys } from "../query-keys";
import type {
  CreateProjectInput,
  PaginatedResponse,
  PaginationParams,
  Project,
  UpdateProjectInput,
} from "../types";

/**
 * Fetches a paginated list of projects.
 *
 * @param params - Optional pagination parameters (page, limit).
 * @returns TanStack Query result with a paginated project list.
 */
export function useProjects(params?: PaginationParams) {
  return useQuery({
    queryKey: queryKeys.projects.lists(params),
    queryFn: () =>
      apiGet<PaginatedResponse<Project>>("/projects", params as Record<string, unknown>),
  });
}

/**
 * Fetches a single project by ID.
 *
 * The query is disabled when `id` is falsy so it can be used
 * conditionally (e.g. before the ID is known).
 *
 * @param id - Project UUID.
 * @returns TanStack Query result with the project entity.
 */
export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id ?? ""),
    queryFn: () => apiGet<Project>(`/projects/${id}`),
    enabled: !!id,
  });
}

/**
 * Creates a new project.
 *
 * On success, invalidates all project list queries so the new
 * project appears immediately.
 */
export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => apiPost<Project>("/projects", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}

/**
 * Updates an existing project.
 *
 * On success, invalidates the specific project detail query and
 * all project lists.
 */
export function useUpdateProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) => apiPut<Project>(`/projects/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}

/**
 * Deletes a project.
 *
 * On success, invalidates all project queries to remove the
 * deleted entity from the cache.
 */
export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/projects/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}
