/**
 * Orchestration span names and attribute keys from §10.13.2.
 *
 * These constants define the starter span tree for the control-plane
 * orchestration layer. Each span name corresponds to a specific service
 * method that creates a trace span when invoked.
 *
 * @see docs/prd/010-integration-contracts.md §10.13.2 — Recommended Starter Spans
 * @see docs/prd/010-integration-contracts.md §10.13.5 — Example Span Tree
 * @module @factory/observability/spans
 */

// ─── Span Names ─────────────────────────────────────────────────────────────

/**
 * Span names for the recommended starter span tree (§10.13.2).
 *
 * The parent-child relationships follow the example span tree from §10.13.5:
 *
 * ```text
 * task.assign
 *   task.transition (READY -> ASSIGNED)
 *   worker.prepare
 *   worker.run
 *     worker.heartbeat
 *     validation.run (pre-review)
 *   task.transition (IN_DEVELOPMENT -> DEV_COMPLETE)
 *   review.route
 *   review.lead_decision
 *   task.transition (IN_REVIEW -> APPROVED)
 *   merge.prepare
 *   merge.execute
 *     validation.run (post-merge)
 *   task.transition (POST_MERGE_VALIDATION -> DONE)
 * ```
 */
export const SpanNames = {
  /** Scheduler assigns a task to a worker pool and acquires a lease. */
  TASK_ASSIGN: "task.assign",

  /** Centralized state transition service commits a task state change. */
  TASK_TRANSITION: "task.transition",

  /** Worker supervisor provisions workspace and prepares runtime adapter. */
  WORKER_PREPARE: "worker.prepare",

  /** Worker runtime executes the task (streaming output and heartbeats). */
  WORKER_RUN: "worker.run",

  /** Heartbeat service processes an incoming worker heartbeat. */
  WORKER_HEARTBEAT: "worker.heartbeat",

  /** Validation runner executes profile-based checks against a workspace. */
  VALIDATION_RUN: "validation.run",

  /** Review router evaluates deterministic routing rules. */
  REVIEW_ROUTE: "review.route",

  /** Review decision service applies the lead reviewer's verdict. */
  REVIEW_LEAD_DECISION: "review.lead_decision",

  /** Merge executor loads state and transitions to REBASING/MERGING. */
  MERGE_PREPARE: "merge.prepare",

  /** Merge executor performs the merge operation, validation, and push. */
  MERGE_EXECUTE: "merge.execute",
} as const;

// ─── Attribute Keys ─────────────────────────────────────────────────────────

/**
 * Common attribute keys for orchestration spans (§10.13.2).
 *
 * Not every span includes every attribute — each service sets whichever
 * attributes are available in its context. The recommended set is:
 *
 * | Attribute            | Typical Spans                                 |
 * | -------------------- | --------------------------------------------- |
 * | task.id              | All spans                                     |
 * | repository.id        | task.assign, merge.*                          |
 * | pool.id              | task.assign, worker.*                         |
 * | worker.id            | worker.*, worker.heartbeat                    |
 * | run.id               | worker.run, validation.run                    |
 * | review_cycle.id      | review.route, review.lead_decision            |
 * | merge_queue_item.id  | merge.prepare, merge.execute                  |
 * | task.state.from      | task.transition                               |
 * | task.state.to        | task.transition                               |
 * | validation.profile   | validation.run                                |
 * | result.status        | Any span with a meaningful outcome             |
 */
export const SpanAttributes = {
  TASK_ID: "task.id",
  REPOSITORY_ID: "repository.id",
  POOL_ID: "pool.id",
  WORKER_ID: "worker.id",
  RUN_ID: "run.id",
  REVIEW_CYCLE_ID: "review_cycle.id",
  MERGE_QUEUE_ITEM_ID: "merge_queue_item.id",
  TASK_STATE_FROM: "task.state.from",
  TASK_STATE_TO: "task.state.to",
  VALIDATION_PROFILE: "validation.profile",
  RESULT_STATUS: "result.status",
} as const;
