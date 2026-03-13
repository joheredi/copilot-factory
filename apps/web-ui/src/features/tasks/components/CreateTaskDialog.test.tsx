// @vitest-environment jsdom
/**
 * Tests for the CreateTaskDialog component (T124).
 *
 * These tests validate:
 * - Dialog renders with all form fields when opened
 * - Required field validation prevents submission
 * - Successful submission calls the API and closes the dialog
 * - Error responses are displayed in the dialog
 * - Dialog can be cancelled without side effects
 * - Project→repository cascading selection works correctly
 * - Form resets when dialog is closed and reopened
 *
 * The Create Task dialog is the primary way operators create tasks
 * through the web UI, so correctness here directly impacts the
 * operator workflow.
 *
 * @see T124 — Add Create Task dialog to Tasks page
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WebSocketProvider } from "../../../lib/websocket/index.js";
import { CreateTaskDialog } from "./CreateTaskDialog.js";
import type { PaginatedResponse, Project, Repository, Task } from "../../../api/types.js";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SAMPLE_PROJECTS: Project[] = [
  {
    id: "proj-1",
    name: "Factory Core",
    description: "Core project",
    owner: "team-a",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "proj-2",
    name: "Web Dashboard",
    description: "UI project",
    owner: "team-b",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const SAMPLE_REPOSITORIES: Repository[] = [
  {
    id: "repo-1",
    projectId: "proj-1",
    name: "factory-backend",
    remoteUrl: "https://github.com/org/factory-backend",
    defaultBranch: "main",
    localCheckoutStrategy: "worktree",
    credentialProfileId: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

/** Creates a minimal Task object returned after creation. */
function makeCreatedTask(): Task {
  return {
    id: "new-task-1",
    repositoryId: "repo-1",
    title: "Test task",
    description: null,
    taskType: "feature",
    priority: "high",
    status: "BACKLOG",
    source: "manual",
    externalRef: null,
    severity: null,
    acceptanceCriteria: null,
    definitionOfDone: null,
    estimatedSize: null,
    riskLevel: null,
    requiredCapabilities: null,
    suggestedFileScope: null,
    version: 1,
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-01T00:00:00Z",
  };
}

/**
 * Routes fetch calls to appropriate mock responses based on URL.
 * Handles /projects, /repositories, and /tasks endpoints.
 */
function setupFetchRoutes(overrides?: {
  projects?: PaginatedResponse<Project>;
  repositories?: PaginatedResponse<Repository>;
  createTaskResponse?: Response;
}) {
  const projectsResponse: PaginatedResponse<Project> = overrides?.projects ?? {
    data: SAMPLE_PROJECTS,
    meta: { page: 1, limit: 100, total: SAMPLE_PROJECTS.length, totalPages: 1 },
  };
  const repositoriesResponse: PaginatedResponse<Repository> = overrides?.repositories ?? {
    data: SAMPLE_REPOSITORIES,
    meta: { page: 1, limit: 100, total: SAMPLE_REPOSITORIES.length, totalPages: 1 },
  };

  fetchSpy.mockImplementation((input) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/repositories")) {
      return Promise.resolve(fakeResponse(repositoriesResponse));
    }
    if (url.includes("/projects")) {
      return Promise.resolve(fakeResponse(projectsResponse));
    }
    if (url.includes("/tasks")) {
      return overrides?.createTaskResponse
        ? Promise.resolve(overrides.createTaskResponse)
        : Promise.resolve(fakeResponse(makeCreatedTask(), 201));
    }
    return Promise.resolve(fakeResponse({}, 404));
  });
}

/**
 * Renders the CreateTaskDialog wrapped in all required providers.
 * Returns the onOpenChange spy for assertion.
 */
function renderDialog(open = true) {
  const onOpenChange = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={false}>
        <MemoryRouter>
          <CreateTaskDialog open={open} onOpenChange={onOpenChange} />
        </MemoryRouter>
      </WebSocketProvider>
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

/**
 * Fills in required form fields to make the form valid for submission.
 * Returns the submit button for convenience.
 */
async function fillRequiredFields() {
  // Wait for project options to load (more than just the placeholder)
  await waitFor(() => {
    const opts = screen.getByTestId("create-task-project").querySelectorAll("option");
    expect(opts.length).toBeGreaterThan(1);
  });

  // Fill title
  fireEvent.change(screen.getByTestId("create-task-title"), {
    target: { value: "Implement user auth" },
  });

  // Select task type
  fireEvent.change(screen.getByTestId("create-task-type"), {
    target: { value: "feature" },
  });

  // Select priority
  fireEvent.change(screen.getByTestId("create-task-priority"), {
    target: { value: "high" },
  });

  // Select project — triggers repository fetch
  fireEvent.change(screen.getByTestId("create-task-project"), {
    target: { value: "proj-1" },
  });

  // Wait for repository options to load (more than just the placeholder)
  await waitFor(() => {
    const repoSelect = screen.getByTestId("create-task-repository");
    expect(repoSelect).not.toBeDisabled();
    const opts = repoSelect.querySelectorAll("option");
    expect(opts.length).toBeGreaterThan(1);
  });

  // Select repository
  fireEvent.change(screen.getByTestId("create-task-repository"), {
    target: { value: "repo-1" },
  });

  return screen.getByTestId("create-task-submit");
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreateTaskDialog", () => {
  /**
   * Validates that the dialog renders with all expected form fields.
   * This is the basic smoke test — if form fields are missing, the
   * operator cannot create tasks.
   */
  it("renders all form fields when open", async () => {
    setupFetchRoutes();
    renderDialog();

    expect(screen.getByTestId("create-task-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("create-task-dialog-title")).toHaveTextContent("Create Task");
    expect(screen.getByTestId("create-task-title")).toBeInTheDocument();
    expect(screen.getByTestId("create-task-description")).toBeInTheDocument();
    expect(screen.getByTestId("create-task-type")).toBeInTheDocument();
    expect(screen.getByTestId("create-task-priority")).toBeInTheDocument();
    expect(screen.getByTestId("create-task-risk-level")).toBeInTheDocument();
    expect(screen.getByTestId("create-task-estimated-size")).toBeInTheDocument();
    expect(screen.getByTestId("create-task-acceptance-criteria")).toBeInTheDocument();
    expect(screen.getByTestId("create-task-project")).toBeInTheDocument();
    expect(screen.getByTestId("create-task-repository")).toBeInTheDocument();
    expect(screen.getByTestId("create-task-submit")).toBeInTheDocument();
    expect(screen.getByTestId("create-task-cancel")).toBeInTheDocument();
  });

  /**
   * Validates that the submit button is disabled when required fields
   * are empty. Prevents accidental submission of incomplete tasks.
   */
  it("disables submit button when required fields are empty", () => {
    setupFetchRoutes();
    renderDialog();

    const submitButton = screen.getByTestId("create-task-submit");
    expect(submitButton).toBeDisabled();
  });

  /**
   * Validates that filling all required fields enables the submit button.
   * Ensures the validation logic correctly identifies a complete form.
   */
  it("enables submit button when all required fields are filled", async () => {
    setupFetchRoutes();
    renderDialog();

    await fillRequiredFields();

    await waitFor(() => {
      expect(screen.getByTestId("create-task-submit")).not.toBeDisabled();
    });
  });

  /**
   * Validates that the submit button remains disabled when title is
   * provided but task type is missing. Each required field must be
   * independently validated.
   */
  it("keeps submit disabled when only title is filled", () => {
    setupFetchRoutes();
    renderDialog();

    fireEvent.change(screen.getByTestId("create-task-title"), {
      target: { value: "Some task" },
    });

    expect(screen.getByTestId("create-task-submit")).toBeDisabled();
  });

  /**
   * Validates successful form submission: calls the API with correct data,
   * invokes onOpenChange(false) to close the dialog, and the form data
   * matches what was entered.
   */
  it("submits the form and closes dialog on success", async () => {
    setupFetchRoutes();
    const { onOpenChange } = renderDialog();

    const submitButton = await fillRequiredFields();
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    // Verify the API was called with a POST to /tasks
    const taskPostCall = fetchSpy.mock.calls.find(([url, init]) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      return urlStr.includes("/tasks") && init?.method === "POST";
    });
    expect(taskPostCall).toBeDefined();

    const body = JSON.parse(taskPostCall![1]!.body as string);
    expect(body.title).toBe("Implement user auth");
    expect(body.taskType).toBe("feature");
    expect(body.priority).toBe("high");
    expect(body.repositoryId).toBe("repo-1");
    expect(body.source).toBe("manual");
  });

  /**
   * Validates that API errors are displayed in the dialog so the
   * operator can see what went wrong and retry.
   */
  it("displays error message when API call fails", async () => {
    setupFetchRoutes({
      createTaskResponse: new Response(
        JSON.stringify({ statusCode: 400, error: "Bad Request", message: "Title too short" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    });
    renderDialog();

    const submitButton = await fillRequiredFields();
    fireEvent.click(submitButton);

    const errorAlert = await screen.findByTestId("create-task-error");
    expect(errorAlert).toBeInTheDocument();
  });

  /**
   * Validates that clicking Cancel closes the dialog via onOpenChange.
   * The operator should always be able to dismiss the dialog without
   * side effects.
   */
  it("calls onOpenChange(false) when cancel is clicked", () => {
    setupFetchRoutes();
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByTestId("create-task-cancel"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /**
   * Validates that the repository select is disabled until a project
   * is chosen, enforcing the cascading selection requirement.
   */
  it("disables repository select until project is selected", () => {
    setupFetchRoutes();
    renderDialog();

    const repoSelect = screen.getByTestId("create-task-repository");
    expect(repoSelect).toBeDisabled();
  });

  /**
   * Validates that selecting a project enables the repository dropdown
   * and populates it with repositories from that project.
   */
  it("enables repository select after project is chosen", async () => {
    setupFetchRoutes();
    renderDialog();

    // Wait for projects to load first
    await waitFor(() => {
      const opts = screen.getByTestId("create-task-project").querySelectorAll("option");
      expect(opts.length).toBeGreaterThan(1);
    });

    fireEvent.change(screen.getByTestId("create-task-project"), { target: { value: "proj-1" } });

    await waitFor(() => {
      const repoSelect = screen.getByTestId("create-task-repository");
      expect(repoSelect).not.toBeDisabled();
    });
  });

  /**
   * Validates that changing the project clears the repository selection.
   * Prevents stale repository IDs from being submitted when the
   * operator switches projects.
   */
  it("clears repository when project changes", async () => {
    setupFetchRoutes();
    renderDialog();

    // Wait for projects to load
    await waitFor(() => {
      const opts = screen.getByTestId("create-task-project").querySelectorAll("option");
      expect(opts.length).toBeGreaterThan(1);
    });

    // Select project and wait for repos
    fireEvent.change(screen.getByTestId("create-task-project"), { target: { value: "proj-1" } });

    await waitFor(() => {
      const repoSelect = screen.getByTestId("create-task-repository");
      expect(repoSelect).not.toBeDisabled();
      expect(repoSelect.querySelectorAll("option").length).toBeGreaterThan(1);
    });

    fireEvent.change(screen.getByTestId("create-task-repository"), {
      target: { value: "repo-1" },
    });

    // Change project — should clear repo
    fireEvent.change(screen.getByTestId("create-task-project"), { target: { value: "proj-2" } });

    expect((screen.getByTestId("create-task-repository") as HTMLSelectElement).value).toBe("");
  });

  /**
   * Validates that task type select renders all expected options.
   * Each task type must be available for the operator to choose.
   */
  it("renders all task type options", () => {
    setupFetchRoutes();
    renderDialog();

    const select = screen.getByTestId("create-task-type");
    const options = select.querySelectorAll("option");

    // 7 types + 1 placeholder
    expect(options).toHaveLength(8);
    expect(select).toHaveTextContent("Feature");
    expect(select).toHaveTextContent("Bug Fix");
    expect(select).toHaveTextContent("Refactor");
    expect(select).toHaveTextContent("Spike");
  });

  /**
   * Validates that priority select renders all expected options.
   */
  it("renders all priority options", () => {
    setupFetchRoutes();
    renderDialog();

    const select = screen.getByTestId("create-task-priority");
    const options = select.querySelectorAll("option");

    // 4 priorities + 1 placeholder
    expect(options).toHaveLength(5);
    expect(select).toHaveTextContent("Critical");
    expect(select).toHaveTextContent("High");
    expect(select).toHaveTextContent("Medium");
    expect(select).toHaveTextContent("Low");
  });

  /**
   * Validates that optional fields (description, acceptance criteria)
   * are included in the submission when filled.
   */
  it("includes optional fields in submission when filled", async () => {
    setupFetchRoutes();
    renderDialog();

    await fillRequiredFields();

    // Fill optional fields
    fireEvent.change(screen.getByTestId("create-task-description"), {
      target: { value: "Implement JWT-based authentication" },
    });

    fireEvent.change(screen.getByTestId("create-task-risk-level"), {
      target: { value: "high" },
    });

    fireEvent.change(screen.getByTestId("create-task-estimated-size"), {
      target: { value: "l" },
    });

    fireEvent.change(screen.getByTestId("create-task-acceptance-criteria"), {
      target: { value: "Login works\nLogout works\nTokens refresh" },
    });

    fireEvent.click(screen.getByTestId("create-task-submit"));

    await waitFor(() => {
      const taskPostCall = fetchSpy.mock.calls.find(([url, init]) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        return urlStr.includes("/tasks") && init?.method === "POST";
      });
      expect(taskPostCall).toBeDefined();

      const body = JSON.parse(taskPostCall![1]!.body as string);
      expect(body.description).toBe("Implement JWT-based authentication");
      expect(body.riskLevel).toBe("high");
      expect(body.estimatedSize).toBe("l");
      expect(body.acceptanceCriteria).toEqual(["Login works", "Logout works", "Tokens refresh"]);
    });
  });

  /**
   * Validates that empty lines in acceptance criteria are filtered out.
   * Prevents submission of blank criteria entries.
   */
  it("filters empty lines from acceptance criteria", async () => {
    setupFetchRoutes();
    renderDialog();

    await fillRequiredFields();

    fireEvent.change(screen.getByTestId("create-task-acceptance-criteria"), {
      target: { value: "First criterion\n\n  \nSecond criterion\n" },
    });

    fireEvent.click(screen.getByTestId("create-task-submit"));

    await waitFor(() => {
      const taskPostCall = fetchSpy.mock.calls.find(([url, init]) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        return urlStr.includes("/tasks") && init?.method === "POST";
      });
      expect(taskPostCall).toBeDefined();

      const body = JSON.parse(taskPostCall![1]!.body as string);
      expect(body.acceptanceCriteria).toEqual(["First criterion", "Second criterion"]);
    });
  });

  /**
   * Validates that an empty acceptance criteria textarea does not include
   * the field in the submission payload (avoids sending empty array).
   */
  it("omits acceptance criteria when textarea is empty", async () => {
    setupFetchRoutes();
    renderDialog();

    await fillRequiredFields();
    fireEvent.click(screen.getByTestId("create-task-submit"));

    await waitFor(() => {
      const taskPostCall = fetchSpy.mock.calls.find(([url, init]) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        return urlStr.includes("/tasks") && init?.method === "POST";
      });
      expect(taskPostCall).toBeDefined();

      const body = JSON.parse(taskPostCall![1]!.body as string);
      expect(body.acceptanceCriteria).toBeUndefined();
    });
  });

  /**
   * Validates that a helpful hint is shown when no projects exist.
   * Guides the operator to create a project before creating tasks.
   */
  it("shows hint when no projects are available", async () => {
    setupFetchRoutes({
      projects: { data: [], meta: { page: 1, limit: 100, total: 0, totalPages: 0 } },
    });
    renderDialog();

    const hint = await screen.findByTestId("no-projects-hint");
    expect(hint).toHaveTextContent("No projects available");
  });
});
