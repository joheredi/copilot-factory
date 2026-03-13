/**
 * Hook that manages the selected project filter state via URL search params.
 *
 * Stores the selected `projectId` in the URL so the filter is bookmarkable
 * and shareable. When no project is selected, all projects are shown
 * (aggregate view).
 *
 * Also resolves the selected project's repositories so callers can
 * filter tasks by `repositoryId`.
 *
 * @module
 * @see T150 — Add multi-project filter to dashboard
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useProjects } from "../../../api/hooks/use-projects.js";
import { useRepositories } from "../../../api/hooks/use-repositories.js";
import type { Project, Repository } from "../../../api/types.js";

/** State exposed by the project filter hook. */
export interface ProjectFilterState {
  /** Currently selected project ID, or empty string for "All Projects". */
  readonly selectedProjectId: string;
  /** The selected project entity, or null if "All Projects". */
  readonly selectedProject: Project | null;
  /** Repository IDs belonging to the selected project (empty if all projects). */
  readonly repositoryIds: readonly string[];
  /** All repositories for the selected project. */
  readonly repositories: readonly Repository[];
  /** All available projects. */
  readonly projects: readonly Project[];
  /** Whether project or repository data is still loading. */
  readonly isLoading: boolean;
}

/** Actions to update the project filter. */
export interface ProjectFilterActions {
  /** Select a project by ID, or empty string for "All Projects". */
  readonly setProjectId: (projectId: string) => void;
}

/**
 * Manages project filter state synced to URL search params.
 *
 * Reads `projectId` from the URL query string. When a project is selected,
 * fetches its repositories to provide `repositoryIds` for downstream
 * task filtering.
 *
 * @returns Tuple of [state, actions] for reading and modifying the project filter.
 */
export function useProjectFilter(): [ProjectFilterState, ProjectFilterActions] {
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedProjectId = searchParams.get("projectId") ?? "";

  const projectsQuery = useProjects({ limit: 100 });
  const projects = projectsQuery.data?.data ?? [];

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const repositoriesQuery = useRepositories(selectedProjectId || undefined, { limit: 100 });
  const repositories = repositoriesQuery.data?.data ?? [];

  const repositoryIds = useMemo(() => repositories.map((r) => r.id), [repositories]);

  const isLoading = projectsQuery.isLoading || (!!selectedProjectId && repositoriesQuery.isLoading);

  const state = useMemo<ProjectFilterState>(
    () => ({
      selectedProjectId,
      selectedProject,
      repositoryIds,
      repositories,
      projects,
      isLoading,
    }),
    [selectedProjectId, selectedProject, repositoryIds, repositories, projects, isLoading],
  );

  const setProjectId = useCallback(
    (projectId: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (projectId) {
            next.set("projectId", projectId);
          } else {
            next.delete("projectId");
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const actions = useMemo<ProjectFilterActions>(() => ({ setProjectId }), [setProjectId]);

  return [state, actions];
}
