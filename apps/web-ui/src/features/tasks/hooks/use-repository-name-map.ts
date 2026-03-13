/**
 * Hook that builds a lookup map from repositoryId → display label.
 *
 * Fetches all projects and their repositories, then builds a Map
 * keyed by repository ID with values like "ProjectName / RepoName".
 * This enables the task table to show which project each task belongs
 * to without requiring a backend join.
 *
 * @module
 * @see T150 — Add project name badges to task rows
 */

import { useMemo } from "react";
import { useProjects } from "../../../api/hooks/use-projects.js";
import { useQueries } from "@tanstack/react-query";
import { apiGet } from "../../../api/client.js";
import { queryKeys } from "../../../api/query-keys.js";
import type { PaginatedResponse, Repository } from "../../../api/types.js";
import type { RepositoryNameMap } from "../components/task-table.js";

/**
 * Builds a Map from repositoryId to "ProjectName / RepoName" for badge display.
 *
 * Fetches all projects and, for each project, fetches its repositories.
 * The resulting Map is memoized and only recomputed when project or
 * repository data changes.
 *
 * @returns A Map<string, string> from repositoryId to display label, or an empty map while loading.
 */
export function useRepositoryNameMap(): RepositoryNameMap {
  const projectsQuery = useProjects({ limit: 100 });
  const projects = projectsQuery.data?.data ?? [];

  const repoQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: queryKeys.repositories.lists(project.id, { limit: 100 }),
      queryFn: () =>
        apiGet<PaginatedResponse<Repository>>(`/projects/${project.id}/repositories`, {
          limit: 100,
        } as Record<string, unknown>),
      staleTime: 60_000,
      enabled: projects.length > 0,
    })),
  });

  return useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((project, idx) => {
      const query = repoQueries[idx];
      if (query?.isSuccess) {
        for (const repo of query.data.data) {
          map.set(repo.id, `${project.name} / ${repo.name}`);
        }
      }
    });
    return map;
  }, [projects, repoQueries]);
}
