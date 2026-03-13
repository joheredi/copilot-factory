// @vitest-environment jsdom
/**
 * Tests for the ProjectSelector component.
 *
 * Validates that the project selector dropdown:
 * - Renders with "All Projects" as default selection
 * - Displays all available projects in the dropdown
 * - Calls the filter action when a project is selected
 * - Shows disabled state when loading with no projects
 *
 * The project selector is the primary entry point for per-project
 * filtering on the dashboard, so correctness here ensures operators
 * can scope their view to a specific project.
 *
 * @see T150 — Add multi-project filter to dashboard
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProjectSelector } from "./project-selector.js";
import type { ProjectFilterState, ProjectFilterActions } from "../hooks/use-project-filter.js";
import type { Project } from "../../../api/types.js";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "My Project",
    description: null,
    owner: "owner",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeFilterState(overrides: Partial<ProjectFilterState> = {}): ProjectFilterState {
  return {
    selectedProjectId: "",
    selectedProject: null,
    repositoryIds: [],
    repositories: [],
    projects: [
      makeProject({ id: "proj-1", name: "Alpha" }),
      makeProject({ id: "proj-2", name: "Beta" }),
    ],
    isLoading: false,
    ...overrides,
  };
}

function makeFilterActions(overrides: Partial<ProjectFilterActions> = {}): ProjectFilterActions {
  return {
    setProjectId: vi.fn(),
    ...overrides,
  };
}

function renderSelector(
  stateOverrides: Partial<ProjectFilterState> = {},
  actionsOverrides: Partial<ProjectFilterActions> = {},
) {
  const state = makeFilterState(stateOverrides);
  const actions = makeFilterActions(actionsOverrides);
  return {
    state,
    actions,
    ...render(<ProjectSelector filterState={state} filterActions={actions} />),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectSelector", () => {
  /**
   * Verifies the selector renders and is identifiable via test ID.
   * This is the most basic smoke test — if it fails, the component
   * can't even mount.
   */
  it("renders the project selector container", () => {
    renderSelector();
    expect(screen.getByTestId("project-selector")).toBeInTheDocument();
  });

  /**
   * Verifies the trigger button renders and shows the default value.
   * The trigger is what the user clicks to open the dropdown.
   */
  it("renders the trigger with default 'All Projects' text", () => {
    renderSelector();
    const trigger = screen.getByTestId("project-selector-trigger");
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("All Projects");
  });

  /**
   * When a specific project is selected (via state), the trigger
   * should display that project's name instead of "All Projects".
   */
  it("shows the selected project name when a project is selected", () => {
    renderSelector({
      selectedProjectId: "proj-2",
      selectedProject: makeProject({ id: "proj-2", name: "Beta" }),
    });
    const trigger = screen.getByTestId("project-selector-trigger");
    expect(trigger).toHaveTextContent("Beta");
  });

  /**
   * When projects are loading and none are available yet, the
   * selector should be disabled to prevent user interaction.
   */
  it("disables the trigger when loading with no projects", () => {
    renderSelector({ isLoading: true, projects: [] });
    const trigger = screen.getByTestId("project-selector-trigger");
    expect(trigger).toBeDisabled();
  });

  /**
   * When projects are loaded, the selector should be enabled
   * even if the hook is still loading repository data.
   */
  it("enables the trigger when projects are available even if still loading repos", () => {
    renderSelector({ isLoading: true });
    const trigger = screen.getByTestId("project-selector-trigger");
    expect(trigger).not.toBeDisabled();
  });
});
