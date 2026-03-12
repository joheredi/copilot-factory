/**
 * Tests for the starter metrics inventory (§10.13.3).
 *
 * Validates that all 12 starter metrics are defined with correct types,
 * names, labels, and behavior. These tests ensure the metrics surface
 * matches the contract from docs/prd/010-integration-contracts.md §10.13.
 *
 * @see docs/prd/010-integration-contracts.md §10.13.3 — Starter metrics
 * @see docs/prd/010-integration-contracts.md §10.13.4 — Label rules
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { initMetrics, resetMetrics } from "./metrics.js";
import { getStarterMetrics, resetStarterMetrics, TERMINAL_TASK_STATES } from "./starter-metrics.js";
import type { StarterMetrics } from "./starter-metrics.js";

// ─── Test Setup ─────────────────────────────────────────────────────────────

/**
 * Shared test lifecycle: initialize a fresh registry before each test
 * and tear down after. This matches the real app lifecycle where
 * initMetrics() is called at startup.
 */
let metrics: StarterMetrics;
let getOutput: () => Promise<string>;

beforeEach(() => {
  resetStarterMetrics();
  resetMetrics();
  const handle = initMetrics({ enableDefaultMetrics: false });
  getOutput = () => handle.getMetricsOutput();
  metrics = getStarterMetrics();
});

afterEach(() => {
  resetStarterMetrics();
  resetMetrics();
});

// ─── Singleton Behavior ─────────────────────────────────────────────────────

describe("getStarterMetrics", () => {
  /**
   * Validates the lazy singleton pattern: calling getStarterMetrics() multiple
   * times returns the same instance, avoiding duplicate metric registration
   * which would cause prom-client errors.
   */
  it("returns the same instance on repeated calls", () => {
    const first = getStarterMetrics();
    const second = getStarterMetrics();
    expect(first).toBe(second);
  });

  /**
   * Validates that resetStarterMetrics() clears the singleton so that
   * a new instance is created on next access. Essential for test isolation.
   */
  it("creates a new instance after resetStarterMetrics()", () => {
    const first = getStarterMetrics();
    resetStarterMetrics();
    resetMetrics();
    initMetrics({ enableDefaultMetrics: false });
    const second = getStarterMetrics();
    expect(first).not.toBe(second);
  });
});

// ─── Metric Definitions ─────────────────────────────────────────────────────

describe("starter metrics definitions", () => {
  /**
   * Validates that all 12 metrics from §10.13.3 are present in the
   * StarterMetrics object, ensuring nothing was accidentally omitted.
   */
  it("includes all 12 starter metrics", () => {
    expect(metrics.taskTransitions).toBeDefined();
    expect(metrics.taskTerminal).toBeDefined();
    expect(metrics.workerRuns).toBeDefined();
    expect(metrics.workerRunDuration).toBeDefined();
    expect(metrics.workerHeartbeatTimeouts).toBeDefined();
    expect(metrics.reviewCycles).toBeDefined();
    expect(metrics.reviewRounds).toBeDefined();
    expect(metrics.mergeAttempts).toBeDefined();
    expect(metrics.mergeFailures).toBeDefined();
    expect(metrics.validationRuns).toBeDefined();
    expect(metrics.validationDuration).toBeDefined();
    expect(metrics.queueDepth).toBeDefined();
  });
});

// ─── Counter Metrics ────────────────────────────────────────────────────────

describe("factory_task_transitions_total", () => {
  /**
   * Validates the counter increments correctly with task_state and result labels.
   * This is the primary throughput metric for the task state machine, used
   * to monitor transition rates and detect failures.
   */
  it("increments with task_state and result labels", async () => {
    metrics.taskTransitions.inc({ task_state: "APPROVED", result: "success" });
    metrics.taskTransitions.inc({ task_state: "FAILED", result: "error" });
    metrics.taskTransitions.inc({ task_state: "APPROVED", result: "success" });

    const output = await getOutput();
    expect(output).toContain("factory_task_transitions_total");
    expect(output).toContain('task_state="APPROVED"');
    expect(output).toContain('result="success"');
    expect(output).toContain('result="error"');
  });

  /**
   * Validates the HELP and TYPE lines in Prometheus output format.
   * Prometheus requires these metadata lines for metric discovery.
   */
  it("has correct HELP and TYPE metadata", async () => {
    metrics.taskTransitions.inc({ task_state: "DONE", result: "success" });
    const output = await getOutput();
    expect(output).toContain("# HELP factory_task_transitions_total");
    expect(output).toContain("# TYPE factory_task_transitions_total counter");
  });
});

describe("factory_task_terminal_total", () => {
  /**
   * Validates that terminal state transitions are tracked with the
   * target terminal state as a label. This metric drives alerts for
   * task failure rates.
   */
  it("increments with task_state label for terminal states", async () => {
    metrics.taskTerminal.inc({ task_state: "DONE" });
    metrics.taskTerminal.inc({ task_state: "FAILED" });
    metrics.taskTerminal.inc({ task_state: "CANCELLED" });

    const output = await getOutput();
    expect(output).toContain("factory_task_terminal_total");
    expect(output).toContain('task_state="DONE"');
    expect(output).toContain('task_state="FAILED"');
    expect(output).toContain('task_state="CANCELLED"');
  });
});

describe("factory_worker_runs_total", () => {
  /**
   * Validates worker run counting with pool_id and result labels.
   * Enables operators to monitor per-pool throughput and success rates.
   */
  it("increments with pool_id and result labels", async () => {
    metrics.workerRuns.inc({ pool_id: "developer", result: "success" });
    metrics.workerRuns.inc({ pool_id: "reviewer", result: "failed" });

    const output = await getOutput();
    expect(output).toContain("factory_worker_runs_total");
    expect(output).toContain('pool_id="developer"');
    expect(output).toContain('result="success"');
    expect(output).toContain('pool_id="reviewer"');
    expect(output).toContain('result="failed"');
  });
});

describe("factory_worker_heartbeat_timeouts_total", () => {
  /**
   * Validates heartbeat timeout counting with pool_id label.
   * High timeout rates by pool indicate infrastructure or worker health issues.
   */
  it("increments with pool_id label", async () => {
    metrics.workerHeartbeatTimeouts.inc({ pool_id: "developer" });
    metrics.workerHeartbeatTimeouts.inc({ pool_id: "developer" });

    const output = await getOutput();
    expect(output).toContain("factory_worker_heartbeat_timeouts_total");
    expect(output).toContain('pool_id="developer"');
  });
});

describe("factory_review_cycles_total", () => {
  /**
   * Validates review cycle counting with result label.
   * Tracks the volume and outcomes of review dispatches.
   */
  it("increments with result label", async () => {
    metrics.reviewCycles.inc({ result: "approved" });
    metrics.reviewCycles.inc({ result: "changes_requested" });

    const output = await getOutput();
    expect(output).toContain("factory_review_cycles_total");
    expect(output).toContain('result="approved"');
  });
});

describe("factory_review_rounds_total", () => {
  /**
   * Validates review round counting. Each round represents a lead
   * review consolidation pass, tracking review iteration volume.
   */
  it("increments without labels", async () => {
    metrics.reviewRounds.inc();
    metrics.reviewRounds.inc();

    const output = await getOutput();
    expect(output).toContain("factory_review_rounds_total");
    expect(output).toContain("factory_review_rounds_total 2");
  });
});

describe("factory_merge_attempts_total", () => {
  /**
   * Validates merge attempt counting with result labels.
   * The result label captures the four possible merge outcomes from §10.10.
   */
  it("increments with result label for different outcomes", async () => {
    metrics.mergeAttempts.inc({ result: "merged" });
    metrics.mergeAttempts.inc({ result: "rebase_conflict" });
    metrics.mergeAttempts.inc({ result: "validation_failed" });
    metrics.mergeAttempts.inc({ result: "push_failed" });

    const output = await getOutput();
    expect(output).toContain("factory_merge_attempts_total");
    expect(output).toContain('result="merged"');
    expect(output).toContain('result="rebase_conflict"');
  });
});

describe("factory_merge_failures_total", () => {
  /**
   * Validates merge failure counting. This is a convenience counter
   * that operators can alert on without filtering by result label.
   */
  it("increments without labels", async () => {
    metrics.mergeFailures.inc();

    const output = await getOutput();
    expect(output).toContain("factory_merge_failures_total");
    expect(output).toContain("factory_merge_failures_total 1");
  });
});

describe("factory_validation_runs_total", () => {
  /**
   * Validates validation run counting with profile and result labels.
   * Enables operators to track validation volume by profile and outcome.
   */
  it("increments with validation_profile and result labels", async () => {
    metrics.validationRuns.inc({ validation_profile: "default-dev", result: "passed" });
    metrics.validationRuns.inc({ validation_profile: "merge-gate", result: "failed" });

    const output = await getOutput();
    expect(output).toContain("factory_validation_runs_total");
    expect(output).toContain('validation_profile="default-dev"');
    expect(output).toContain('result="passed"');
  });
});

// ─── Histogram Metrics ──────────────────────────────────────────────────────

describe("factory_worker_run_duration_seconds", () => {
  /**
   * Validates worker run duration observation with pool_id label and
   * correct histogram bucket generation. Histogram produces _bucket,
   * _sum, and _count metrics automatically.
   */
  it("observes duration values with pool_id label and correct buckets", async () => {
    metrics.workerRunDuration.observe({ pool_id: "developer" }, 42.5);
    metrics.workerRunDuration.observe({ pool_id: "developer" }, 120);
    metrics.workerRunDuration.observe({ pool_id: "reviewer" }, 7.2);

    const output = await getOutput();
    expect(output).toContain("factory_worker_run_duration_seconds_bucket");
    expect(output).toContain("factory_worker_run_duration_seconds_sum");
    expect(output).toContain("factory_worker_run_duration_seconds_count");
    expect(output).toContain('pool_id="developer"');

    // Verify custom buckets are present (5, 15, 30, 60, 120, 300, 600, 1200, 1800)
    expect(output).toContain('le="5"');
    expect(output).toContain('le="60"');
    expect(output).toContain('le="300"');
    expect(output).toContain('le="1800"');
  });
});

describe("factory_validation_duration_seconds", () => {
  /**
   * Validates validation duration observation with profile label and
   * appropriate bucket boundaries for check suite execution times.
   */
  it("observes duration values with validation_profile label", async () => {
    metrics.validationDuration.observe({ validation_profile: "default-dev" }, 15.3);
    metrics.validationDuration.observe({ validation_profile: "merge-gate" }, 45.0);

    const output = await getOutput();
    expect(output).toContain("factory_validation_duration_seconds_bucket");
    expect(output).toContain("factory_validation_duration_seconds_sum");
    expect(output).toContain("factory_validation_duration_seconds_count");
    expect(output).toContain('validation_profile="default-dev"');

    // Verify custom buckets (1, 5, 10, 30, 60, 120, 300, 600)
    expect(output).toContain('le="1"');
    expect(output).toContain('le="30"');
    expect(output).toContain('le="600"');
  });
});

// ─── Gauge Metrics ──────────────────────────────────────────────────────────

describe("factory_queue_depth", () => {
  /**
   * Validates queue depth gauge operations (set, increment, decrement)
   * with job_type label. This gauge reflects current queue backlog
   * and must support both absolute setting and relative adjustments.
   */
  it("supports set, inc, and dec operations with job_type label", async () => {
    metrics.queueDepth.set({ job_type: "worker_dispatch" }, 5);
    metrics.queueDepth.inc({ job_type: "worker_dispatch" });
    metrics.queueDepth.dec({ job_type: "worker_dispatch" });

    const output = await getOutput();
    expect(output).toContain("factory_queue_depth");
    expect(output).toContain('job_type="worker_dispatch"');
    // After set(5), inc(+1=6), dec(-1=5) → value should be 5
    expect(output).toContain('factory_queue_depth{job_type="worker_dispatch"} 5');
  });

  /**
   * Validates that multiple job types can be tracked independently,
   * which is essential for monitoring different queue backlogs.
   */
  it("tracks multiple job types independently", async () => {
    metrics.queueDepth.set({ job_type: "worker_dispatch" }, 3);
    metrics.queueDepth.set({ job_type: "reviewer_dispatch" }, 1);
    metrics.queueDepth.set({ job_type: "lead_review_consolidation" }, 0);

    const output = await getOutput();
    expect(output).toContain('job_type="worker_dispatch"');
    expect(output).toContain('job_type="reviewer_dispatch"');
    expect(output).toContain('job_type="lead_review_consolidation"');
  });
});

// ─── Label Cardinality Rules (§10.13.4) ─────────────────────────────────────

describe("label cardinality compliance (§10.13.4)", () => {
  /**
   * Critical safety test: validates that no starter metric uses
   * high-cardinality labels (task_id, run_id, branch_name) which would
   * cause Prometheus storage explosion. These values belong in traces
   * and logs, not metric labels.
   */
  it("does not include high-cardinality labels in Prometheus output", async () => {
    // Exercise all metrics with representative values
    metrics.taskTransitions.inc({ task_state: "APPROVED", result: "success" });
    metrics.workerRuns.inc({ pool_id: "developer", result: "success" });
    metrics.workerRunDuration.observe({ pool_id: "developer" }, 10);
    metrics.validationRuns.inc({ validation_profile: "default", result: "passed" });
    metrics.queueDepth.set({ job_type: "worker_dispatch" }, 1);

    const output = await getOutput();

    // These label names must NEVER appear in the metrics output
    expect(output).not.toContain("task_id=");
    expect(output).not.toContain("run_id=");
    expect(output).not.toContain("branch_name=");
  });
});

// ─── TERMINAL_TASK_STATES ───────────────────────────────────────────────────

describe("TERMINAL_TASK_STATES", () => {
  /**
   * Validates the terminal state set matches the domain model (§2.2).
   * This set is used by instrumentation code to decide when to increment
   * factory_task_terminal_total.
   */
  it("contains exactly DONE, FAILED, CANCELLED", () => {
    expect(TERMINAL_TASK_STATES.has("DONE")).toBe(true);
    expect(TERMINAL_TASK_STATES.has("FAILED")).toBe(true);
    expect(TERMINAL_TASK_STATES.has("CANCELLED")).toBe(true);
    expect(TERMINAL_TASK_STATES.size).toBe(3);
  });

  /**
   * Validates non-terminal states are not in the set, preventing
   * false positives in terminal state detection.
   */
  it("does not contain non-terminal states", () => {
    expect(TERMINAL_TASK_STATES.has("READY")).toBe(false);
    expect(TERMINAL_TASK_STATES.has("IN_DEVELOPMENT")).toBe(false);
    expect(TERMINAL_TASK_STATES.has("IN_REVIEW")).toBe(false);
    expect(TERMINAL_TASK_STATES.has("MERGING")).toBe(false);
  });
});

// ─── Full Output Validation ─────────────────────────────────────────────────

describe("complete Prometheus output", () => {
  /**
   * End-to-end test: validates that all 12 starter metrics appear in
   * the Prometheus text exposition output after being exercised. This
   * catches registration failures and ensures the /metrics endpoint
   * will include all expected metrics.
   */
  it("includes all 12 starter metric names in output after use", async () => {
    // Exercise every metric at least once
    metrics.taskTransitions.inc({ task_state: "DONE", result: "success" });
    metrics.taskTerminal.inc({ task_state: "DONE" });
    metrics.workerRuns.inc({ pool_id: "dev", result: "success" });
    metrics.workerRunDuration.observe({ pool_id: "dev" }, 10);
    metrics.workerHeartbeatTimeouts.inc({ pool_id: "dev" });
    metrics.reviewCycles.inc({ result: "approved" });
    metrics.reviewRounds.inc();
    metrics.mergeAttempts.inc({ result: "merged" });
    metrics.mergeFailures.inc();
    metrics.validationRuns.inc({ validation_profile: "default", result: "passed" });
    metrics.validationDuration.observe({ validation_profile: "default" }, 5);
    metrics.queueDepth.set({ job_type: "worker_dispatch" }, 1);

    const output = await getOutput();

    const expectedNames = [
      "factory_task_transitions_total",
      "factory_task_terminal_total",
      "factory_worker_runs_total",
      "factory_worker_run_duration_seconds",
      "factory_worker_heartbeat_timeouts_total",
      "factory_review_cycles_total",
      "factory_review_rounds_total",
      "factory_merge_attempts_total",
      "factory_merge_failures_total",
      "factory_validation_runs_total",
      "factory_validation_duration_seconds",
      "factory_queue_depth",
    ];

    for (const name of expectedNames) {
      expect(output).toContain(name);
    }
  });
});
