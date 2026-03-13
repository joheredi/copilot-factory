/**
 * TanStack Query hooks for Prompt Template operations.
 *
 * @module
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPut } from "../client";
import { queryKeys } from "../query-keys";
import type {
  CreatePromptTemplateInput,
  PaginatedResponse,
  PromptTemplate,
  UpdatePromptTemplateInput,
} from "../types";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetches a list of prompt templates, optionally filtered by role.
 */
export function usePromptTemplates(role?: string) {
  const params = role ? { role } : undefined;
  return useQuery({
    queryKey: queryKeys.promptTemplates.lists(params),
    queryFn: async () => {
      const res = await apiGet<PaginatedResponse<PromptTemplate> | PromptTemplate[]>(
        "/prompt-templates",
        params as Record<string, unknown> | undefined,
      );
      // Handle both paginated and flat responses
      if (Array.isArray(res)) return res;
      return res.data ?? [];
    },
  });
}

/**
 * Fetches a single prompt template by ID.
 *
 * Disabled when `id` is falsy for conditional usage.
 */
export function usePromptTemplate(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.promptTemplates.detail(id ?? ""),
    queryFn: () => apiGet<PromptTemplate>(`/prompt-templates/${id}`),
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Creates a new prompt template. */
export function useCreatePromptTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePromptTemplateInput) =>
      apiPost<PromptTemplate>("/prompt-templates", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.promptTemplates.all });
    },
  });
}

/** Updates an existing prompt template. */
export function useUpdatePromptTemplate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePromptTemplateInput) =>
      apiPut<PromptTemplate>(`/prompt-templates/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.promptTemplates.all });
    },
  });
}

/** Deletes a prompt template. */
export function useDeletePromptTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/prompt-templates/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.promptTemplates.all });
    },
  });
}
