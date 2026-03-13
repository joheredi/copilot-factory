/**
 * Project selector dropdown for the dashboard header.
 *
 * Displays a Select dropdown populated with all registered projects.
 * "All Projects" is the default and shows aggregate data. Selecting a
 * specific project filters dashboard task counts and activity to that
 * project's repositories.
 *
 * @see T150 — Add multi-project filter to dashboard
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import type { ProjectFilterActions, ProjectFilterState } from "../hooks/use-project-filter.js";

/** Value used in the Select for the "All Projects" option. */
const ALL_PROJECTS_VALUE = "__all__";

export interface ProjectSelectorProps {
  /** Current project filter state. */
  readonly filterState: ProjectFilterState;
  /** Actions to update the project filter. */
  readonly filterActions: ProjectFilterActions;
}

/**
 * Renders a project selector dropdown.
 *
 * Shows "All Projects" as the default option followed by each registered
 * project. When the selection changes, updates the URL search params
 * via the filter actions so the filter is bookmarkable.
 */
export function ProjectSelector({ filterState, filterActions }: ProjectSelectorProps) {
  const { selectedProjectId, projects, isLoading } = filterState;

  const handleValueChange = (value: string) => {
    filterActions.setProjectId(value === ALL_PROJECTS_VALUE ? "" : value);
  };

  return (
    <div className="w-[220px]" data-testid="project-selector">
      <Select
        value={selectedProjectId || ALL_PROJECTS_VALUE}
        onValueChange={handleValueChange}
        disabled={isLoading && projects.length === 0}
      >
        <SelectTrigger data-testid="project-selector-trigger">
          <SelectValue placeholder="Select project…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_PROJECTS_VALUE} data-testid="project-option-all">
            All Projects
          </SelectItem>
          {projects.map((project) => (
            <SelectItem
              key={project.id}
              value={project.id}
              data-testid={`project-option-${project.id}`}
            >
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
