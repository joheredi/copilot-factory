/**
 * TanStack Query mutation hooks for the task import pipeline.
 *
 * The import flow is a two-step process:
 * 1. **Discover** — scan a filesystem path and return parsed tasks (preview).
 * 2. **Execute** — commit the discovered tasks into the Factory database.
 *
 * Both operations are mutations (POST requests that change server state
 * or perform expensive scanning). The execute mutation invalidates task
 * and project caches so that list views reflect the newly imported data.
 *
 * @module
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../client";
import { queryKeys } from "../query-keys";
import type {
  DiscoverRequest,
  DiscoverResponse,
  ExecuteImportRequest,
  ExecuteImportResponse,
} from "../types";

/**
 * Mutation hook for the import discovery step.
 *
 * Calls `POST /import/discover` with a filesystem path and optional
 * glob pattern. Returns parsed tasks, warnings, and suggested names
 * for the project and repository.
 *
 * @returns TanStack Query mutation result with `isPending`, `error`, and `data`.
 *
 * @example
 * ```tsx
 * const discover = useDiscoverTasks();
 * discover.mutate({ path: "/home/user/project", pattern: "*.md" });
 * ```
 */
export function useDiscoverTasks() {
  return useMutation({
    mutationFn: (input: DiscoverRequest) => apiPost<DiscoverResponse>("/import/discover", input),
  });
}

/**
 * Mutation hook for the import execution step.
 *
 * Calls `POST /import/execute` to atomically create tasks from the
 * previously discovered set. On success, invalidates both task and
 * project query caches since importing may create a new project and
 * repository alongside the tasks.
 *
 * @returns TanStack Query mutation result with `isPending`, `error`, and `data`.
 *
 * @example
 * ```tsx
 * const execute = useExecuteImport();
 * execute.mutate({
 *   path: "/home/user/project",
 *   tasks: discoveredTasks,
 *   projectName: "My Project",
 * });
 * ```
 */
export function useExecuteImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ExecuteImportRequest) =>
      apiPost<ExecuteImportResponse>("/import/execute", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}
