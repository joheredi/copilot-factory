// @vitest-environment jsdom
/**
 * Tests for the production pipeline visualization component.
 *
 * Validates that all 7 pipeline stages render with correct counts,
 * the off-ramp row displays terminal/exceptional states, loading
 * skeleton appears while data is in-flight, and zero-count stages
 * are still visible.
 *
 * @see docs/prd/002-data-model.md — Task state machine
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PipelineVisualization } from "./pipeline-visualization.js";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a status count map from a partial record. */
function createStatusCounts(overrides: Record<string, number> = {}): ReadonlyMap<string, number> {
  return new Map(Object.entries(overrides));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PipelineVisualization", () => {
  it("renders all 7 pipeline stages", () => {
    render(<PipelineVisualization statusCounts={createStatusCounts()} isLoading={false} />);

    const stageIds = ["intake", "ready", "development", "review", "merge", "validation", "done"];
    for (const id of stageIds) {
      expect(screen.getByTestId(`pipeline-stage-${id}`)).toBeInTheDocument();
    }
  });

  it("displays correct counts per stage", () => {
    const counts = createStatusCounts({
      BACKLOG: 5,
      BLOCKED: 2,
      READY: 8,
      ASSIGNED: 1,
      IN_DEVELOPMENT: 3,
      DEV_COMPLETE: 1,
      IN_REVIEW: 2,
      CHANGES_REQUESTED: 1,
      APPROVED: 0,
      QUEUED_FOR_MERGE: 1,
      MERGING: 1,
      POST_MERGE_VALIDATION: 1,
      DONE: 42,
    });

    render(<PipelineVisualization statusCounts={counts} isLoading={false} />);

    expect(screen.getByTestId("pipeline-count-intake")).toHaveTextContent("7");
    expect(screen.getByTestId("pipeline-count-ready")).toHaveTextContent("8");
    expect(screen.getByTestId("pipeline-count-development")).toHaveTextContent("5");
    expect(screen.getByTestId("pipeline-count-review")).toHaveTextContent("3");
    expect(screen.getByTestId("pipeline-count-merge")).toHaveTextContent("2");
    expect(screen.getByTestId("pipeline-count-validation")).toHaveTextContent("1");
    expect(screen.getByTestId("pipeline-count-done")).toHaveTextContent("42");
  });

  it("shows zero for stages with no tasks", () => {
    render(<PipelineVisualization statusCounts={createStatusCounts()} isLoading={false} />);

    expect(screen.getByTestId("pipeline-count-intake")).toHaveTextContent("0");
    expect(screen.getByTestId("pipeline-count-done")).toHaveTextContent("0");
  });

  it("renders loading skeleton when isLoading is true", () => {
    render(<PipelineVisualization statusCounts={createStatusCounts()} isLoading={true} />);

    expect(screen.getByTestId("pipeline-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-visualization")).not.toBeInTheDocument();
  });

  it("shows off-ramp row when there are failed/escalated/cancelled tasks", () => {
    const counts = createStatusCounts({
      FAILED: 3,
      ESCALATED: 1,
      CANCELLED: 2,
    });

    render(<PipelineVisualization statusCounts={counts} isLoading={false} />);

    const offramp = screen.getByTestId("pipeline-offramp");
    expect(offramp).toBeInTheDocument();
    expect(screen.getByTestId("offramp-failed")).toHaveTextContent("Failed: 3");
    expect(screen.getByTestId("offramp-escalated")).toHaveTextContent("Escalated: 1");
    expect(screen.getByTestId("offramp-cancelled")).toHaveTextContent("Cancelled: 2");
  });

  it("hides off-ramp row when all terminal counts are zero", () => {
    const counts = createStatusCounts({ READY: 5, DONE: 10 });

    render(<PipelineVisualization statusCounts={counts} isLoading={false} />);

    expect(screen.queryByTestId("pipeline-offramp")).not.toBeInTheDocument();
  });

  it("shows per-status breakdown for multi-status stages", () => {
    const counts = createStatusCounts({
      IN_REVIEW: 4,
      CHANGES_REQUESTED: 2,
    });

    render(<PipelineVisualization statusCounts={counts} isLoading={false} />);

    const reviewStage = screen.getByTestId("pipeline-stage-review");
    expect(reviewStage).toHaveTextContent("4 In Review");
    expect(reviewStage).toHaveTextContent("2 Changes Req.");
  });

  it("has accessible aria-labels on stages", () => {
    const counts = createStatusCounts({ READY: 3 });

    render(<PipelineVisualization statusCounts={counts} isLoading={false} />);

    const readyStage = screen.getByTestId("pipeline-stage-ready");
    expect(readyStage).toHaveAttribute("aria-label", "Ready: 3 tasks");
  });
});
