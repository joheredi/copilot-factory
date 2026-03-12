// @vitest-environment jsdom
/**
 * Tests for the Task Detail page (T095).
 *
 * These tests validate the task detail page's core behaviour:
 * - Renders loading skeleton while data is being fetched
 * - Renders error state when API request fails or task not found
 * - Renders task header with title, ID, status, and priority badges
 * - Renders back-to-tasks navigation link
 * - Renders all five tab triggers (Overview, Timeline, Packets, Artifacts, Dependencies)
 * - Overview tab displays task metadata fields
 * - Overview tab shows acceptance criteria and definition of done
 * - Overview tab shows current lease information when present
 * - Overview tab shows current review cycle when present
 * - Overview tab shows description when present
 * - Timeline tab renders with loading then content
 * - Packets tab renders empty state when no review cycles
 * - Artifacts tab renders empty state when no artifacts
 * - Dependencies tab renders forward and reverse dependencies
 * - Dependencies tab renders empty state when no dependencies
 *
 * The task detail page is the primary view for operators to inspect
 * and understand task history, so regressions here impact operational
 * workflows and debugging capability.
 *
 * @see T095 — Build task detail timeline view
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { WebSocketProvider } from "../../lib/websocket/index.js";
import TaskDetailPage from "./TaskDetailPage.js";
import type {
  TaskDetail,
  AuditEvent,
  PaginatedResponse,
  ReviewHistoryResponse,
  ArtifactTree,
} from "../../api/types.js";

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

/** Creates a full TaskDetail response for testing. */
function makeTaskDetail(overrides?: Partial<TaskDetail>): TaskDetail {
  return {
    task: {
      id: "task-abc-123",
      repositoryId: "repo-1",
      title: "Implement authentication module",
      description: "Build JWT-based auth with login and logout endpoints.",
      taskType: "feature",
      priority: "high",
      status: "IN_DEVELOPMENT",
      source: "manual",
      externalRef: "PROJ-42",
      severity: null,
      acceptanceCriteria: ["Login endpoint returns JWT", "Logout invalidates token"],
      definitionOfDone: ["Unit tests pass", "Code reviewed"],
      estimatedSize: "m",
      riskLevel: "medium",
      requiredCapabilities: ["nodejs", "auth"],
      suggestedFileScope: ["src/auth/"],
      version: 3,
      createdAt: "2026-03-01T10:00:00Z",
      updatedAt: "2026-03-10T15:30:00Z",
    },
    currentLease: {
      leaseId: "lease-001",
      taskId: "task-abc-123",
      workerId: "worker-42",
      poolId: "pool-dev-1",
      leasedAt: "2026-03-10T14:00:00Z",
      expiresAt: "2026-03-10T16:00:00Z",
      status: "ACTIVE",
      lastHeartbeatAt: "2026-03-10T15:25:00Z",
    },
    currentReviewCycle: {
      cycleId: "cycle-001",
      taskId: "task-abc-123",
      status: "IN_PROGRESS",
      specialistCount: 2,
      leadDecision: null,
      createdAt: "2026-03-10T15:00:00Z",
      updatedAt: "2026-03-10T15:20:00Z",
    },
    dependencies: [
      {
        taskDependencyId: "dep-1",
        taskId: "task-abc-123",
        dependsOnTaskId: "task-dep-001",
        dependencyType: "blocks",
        isHardBlock: true,
        createdAt: "2026-03-01T10:00:00Z",
      },
    ],
    dependents: [
      {
        taskDependencyId: "dep-2",
        taskId: "task-dep-002",
        dependsOnTaskId: "task-abc-123",
        dependencyType: "blocks",
        isHardBlock: false,
        createdAt: "2026-03-01T10:00:00Z",
      },
    ],
    ...overrides,
  };
}

/** Creates a timeline response. */
function makeTimelineResponse(events: AuditEvent[] = []): PaginatedResponse<AuditEvent> {
  return { data: events, meta: { page: 1, limit: 50, total: events.length, totalPages: 1 } };
}

/** Creates a sample audit event. */
function makeAuditEvent(overrides?: Partial<AuditEvent>): AuditEvent {
  return {
    id: "audit-001",
    entityType: "task",
    entityId: "task-abc-123",
    eventType: "state_transition",
    actorType: "system",
    actorId: "scheduler",
    metadata: { oldState: "READY", newState: "ASSIGNED" },
    timestamp: "2026-03-10T14:00:00Z",
    ...overrides,
  };
}

/** Creates an empty review history response. */
function makeEmptyReviewHistory(): ReviewHistoryResponse {
  return { taskId: "task-abc-123", cycles: [] };
}

/** Creates an empty artifact tree response. */
function makeEmptyArtifactTree(): ArtifactTree {
  return { taskId: "task-abc-123", artifacts: [] };
}

/**
 * Renders the task detail page with all required providers.
 * Uses MemoryRouter with `/tasks/:id` route to inject the task ID param.
 */
function renderTaskDetail(taskId = "task-abc-123") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider autoConnect={false}>
        <MemoryRouter initialEntries={[`/tasks/${taskId}`]}>
          <Routes>
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
          </Routes>
        </MemoryRouter>
      </WebSocketProvider>
    </QueryClientProvider>,
  );
}

/**
 * Sets up fetch to respond based on URL pattern.
 * Handles task detail, timeline, reviews, and artifacts endpoints.
 */
function setupResponses(detail: TaskDetail | null = makeTaskDetail()) {
  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/timeline")) {
      return Promise.resolve(
        fakeResponse(
          makeTimelineResponse([
            makeAuditEvent(),
            makeAuditEvent({
              id: "audit-002",
              eventType: "created",
              actorType: "operator",
              actorId: "user-1",
              metadata: {},
              timestamp: "2026-03-01T10:00:00Z",
            }),
          ]),
        ),
      );
    }

    if (url.includes("/reviews")) {
      return Promise.resolve(fakeResponse(makeEmptyReviewHistory()));
    }

    if (url.includes("/artifacts")) {
      return Promise.resolve(fakeResponse(makeEmptyArtifactTree()));
    }

    if (url.includes("/tasks/")) {
      if (detail === null) {
        return Promise.resolve(new Response("Not Found", { status: 404 }));
      }
      return Promise.resolve(fakeResponse(detail));
    }

    return Promise.resolve(fakeResponse({}));
  });
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

describe("TaskDetailPage", () => {
  /**
   * Validates that the loading skeleton is shown while the task detail
   * is being fetched. Prevents layout shift and provides visual feedback.
   */
  it("renders loading skeleton while data is loading", () => {
    fetchSpy.mockImplementation(() => new Promise(() => {}));
    renderTaskDetail();
    expect(screen.getByTestId("task-detail-loading")).toBeInTheDocument();
  });

  /**
   * Validates that the error state is shown when the API returns 404.
   * Operators need clear feedback when a task cannot be found.
   */
  it("renders error state when task is not found", async () => {
    setupResponses(null);
    renderTaskDetail();
    const errorEl = await screen.findByTestId("task-detail-error");
    expect(errorEl).toBeInTheDocument();
    expect(errorEl).toHaveTextContent("Unable to load task");
  });

  /**
   * Validates that the task title renders in the page header.
   * This is the primary identifier for the operator.
   */
  it("renders task title in header", async () => {
    setupResponses();
    renderTaskDetail();
    const title = await screen.findByTestId("task-title");
    expect(title).toHaveTextContent("Implement authentication module");
  });

  /**
   * Validates that the task ID is displayed for copy/reference.
   */
  it("renders task ID in header", async () => {
    setupResponses();
    renderTaskDetail();
    const taskId = await screen.findByTestId("task-id");
    expect(taskId).toHaveTextContent("task-abc-123");
  });

  /**
   * Validates that the status badge appears in the header.
   */
  it("renders status badge in header", async () => {
    setupResponses();
    renderTaskDetail();
    const header = await screen.findByTestId("task-detail-page");
    const badges = within(header).getAllByTestId("status-badge-IN_DEVELOPMENT");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Validates that the priority badge appears in the header.
   */
  it("renders priority badge in header", async () => {
    setupResponses();
    renderTaskDetail();
    const header = await screen.findByTestId("task-detail-page");
    const badges = within(header).getAllByTestId("priority-badge-high");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Validates back-to-tasks navigation link is present.
   * Operators need a way to return to the task board.
   */
  it("renders back to tasks link", async () => {
    setupResponses();
    renderTaskDetail();
    const backLink = await screen.findByTestId("back-to-tasks");
    expect(backLink).toHaveTextContent("Back to Task Board");
  });

  /**
   * Validates that all five tab triggers are rendered.
   * This is the core navigation mechanism for the detail page.
   */
  it("renders all tab triggers", async () => {
    setupResponses();
    renderTaskDetail();
    await screen.findByTestId("task-detail-tabs");

    expect(screen.getByTestId("tab-overview")).toHaveTextContent("Overview");
    expect(screen.getByTestId("tab-timeline")).toHaveTextContent("Timeline");
    expect(screen.getByTestId("tab-packets")).toHaveTextContent("Packets");
    expect(screen.getByTestId("tab-artifacts")).toHaveTextContent("Artifacts");
    expect(screen.getByTestId("tab-dependencies")).toHaveTextContent("Dependencies");
  });

  /**
   * Validates the Overview tab shows task metadata fields.
   * Operators need to see all task classification data.
   */
  it("overview tab displays task metadata", async () => {
    setupResponses();
    renderTaskDetail();
    const overview = await screen.findByTestId("task-overview-tab");

    expect(overview).toHaveTextContent("Feature");
    expect(overview).toHaveTextContent("Manual");
    expect(overview).toHaveTextContent("repo-1");
    expect(overview).toHaveTextContent("M");
  });

  /**
   * Validates the Overview tab shows task description.
   */
  it("overview tab displays description", async () => {
    setupResponses();
    renderTaskDetail();
    const description = await screen.findByTestId("task-description");
    expect(description).toHaveTextContent("Build JWT-based auth");
  });

  /**
   * Validates the Overview tab shows acceptance criteria list.
   */
  it("overview tab displays acceptance criteria", async () => {
    setupResponses();
    renderTaskDetail();
    const criteria = await screen.findByTestId("acceptance-criteria");
    expect(criteria).toHaveTextContent("Login endpoint returns JWT");
    expect(criteria).toHaveTextContent("Logout invalidates token");
  });

  /**
   * Validates the Overview tab shows definition of done list.
   */
  it("overview tab displays definition of done", async () => {
    setupResponses();
    renderTaskDetail();
    const dod = await screen.findByTestId("definition-of-done");
    expect(dod).toHaveTextContent("Unit tests pass");
    expect(dod).toHaveTextContent("Code reviewed");
  });

  /**
   * Validates the Overview tab shows current lease information.
   * Active leases indicate a worker is currently processing the task.
   */
  it("overview tab displays current lease", async () => {
    setupResponses();
    renderTaskDetail();
    const lease = await screen.findByTestId("current-lease");
    expect(lease).toHaveTextContent("lease-001");
    expect(lease).toHaveTextContent("worker-42");
    expect(lease).toHaveTextContent("ACTIVE");
  });

  /**
   * Validates the Overview tab shows current review cycle.
   */
  it("overview tab displays current review cycle", async () => {
    setupResponses();
    renderTaskDetail();
    const cycle = await screen.findByTestId("current-review-cycle");
    expect(cycle).toHaveTextContent("cycle-001");
    expect(cycle).toHaveTextContent("IN_PROGRESS");
    expect(cycle).toHaveTextContent("2");
  });

  /**
   * Validates the Overview tab hides lease section when no active lease.
   */
  it("overview tab hides lease when not present", async () => {
    const detail = makeTaskDetail({ currentLease: null });
    setupResponses(detail);
    renderTaskDetail();
    await screen.findByTestId("task-overview-tab");
    expect(screen.queryByTestId("current-lease")).not.toBeInTheDocument();
  });

  /**
   * Validates the Timeline tab loads and displays audit events.
   * The timeline is the primary tool for reconstructing what happened.
   */
  it("timeline tab shows audit events", async () => {
    setupResponses();
    renderTaskDetail();
    await screen.findByTestId("task-detail-tabs");

    await userEvent.click(screen.getByTestId("tab-timeline"));

    const timeline = await screen.findByTestId("task-timeline-tab");
    expect(timeline).toBeInTheDocument();
    expect(screen.getByTestId("timeline-event-audit-001")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-event-audit-002")).toBeInTheDocument();
  });

  /**
   * Validates that the timeline shows event metadata with state transitions.
   */
  it("timeline shows state transition metadata", async () => {
    setupResponses();
    renderTaskDetail();
    await screen.findByTestId("task-detail-tabs");

    await userEvent.click(screen.getByTestId("tab-timeline"));

    const event = await screen.findByTestId("timeline-event-audit-001");
    const metadata = within(event).getByTestId("event-metadata");
    expect(metadata).toHaveTextContent("READY");
    expect(metadata).toHaveTextContent("ASSIGNED");
  });

  /**
   * Validates the Packets tab shows empty state when no review cycles exist.
   */
  it("packets tab shows empty state", async () => {
    setupResponses();
    renderTaskDetail();
    await screen.findByTestId("task-detail-tabs");

    await userEvent.click(screen.getByTestId("tab-packets"));

    const empty = await screen.findByTestId("packets-empty");
    expect(empty).toHaveTextContent("No packets yet");
  });

  /**
   * Validates the Artifacts tab shows empty state when no artifacts exist.
   */
  it("artifacts tab shows empty state", async () => {
    setupResponses();
    renderTaskDetail();
    await screen.findByTestId("task-detail-tabs");

    await userEvent.click(screen.getByTestId("tab-artifacts"));

    const empty = await screen.findByTestId("artifacts-empty");
    expect(empty).toHaveTextContent("No artifacts yet");
  });

  /**
   * Validates the Dependencies tab shows forward and reverse dependencies.
   * Operators need to trace task relationships for scheduling decisions.
   */
  it("dependencies tab shows forward and reverse dependencies", async () => {
    setupResponses();
    renderTaskDetail();
    await screen.findByTestId("task-detail-tabs");

    await userEvent.click(screen.getByTestId("tab-dependencies"));

    const depsTab = await screen.findByTestId("task-dependencies-tab");
    expect(depsTab).toBeInTheDocument();

    expect(screen.getByTestId("forward-dependencies")).toBeInTheDocument();
    expect(screen.getByTestId("reverse-dependencies")).toBeInTheDocument();

    expect(screen.getByTestId("dependency-dep-1")).toHaveTextContent("task-dep-001");
    expect(screen.getByTestId("dependency-dep-2")).toHaveTextContent("task-dep-002");
  });

  /**
   * Validates the Dependencies tab shows empty state when no dependencies exist.
   */
  it("dependencies tab shows empty state when no dependencies", async () => {
    const detail = makeTaskDetail({ dependencies: [], dependents: [] });
    setupResponses(detail);
    renderTaskDetail();
    await screen.findByTestId("task-detail-tabs");

    await userEvent.click(screen.getByTestId("tab-dependencies"));

    const empty = await screen.findByTestId("dependencies-empty");
    expect(empty).toHaveTextContent("No dependencies");
  });

  /**
   * Validates that required capabilities are displayed as badges.
   */
  it("overview tab displays required capabilities", async () => {
    setupResponses();
    renderTaskDetail();
    const overview = await screen.findByTestId("task-overview-tab");
    expect(overview).toHaveTextContent("nodejs");
    expect(overview).toHaveTextContent("auth");
  });

  /**
   * Validates that suggested file scope is displayed.
   */
  it("overview tab displays suggested file scope", async () => {
    setupResponses();
    renderTaskDetail();
    const overview = await screen.findByTestId("task-overview-tab");
    expect(overview).toHaveTextContent("src/auth/");
  });
});
