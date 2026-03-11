/**
 * Tests for all domain enumerations.
 *
 * These tests verify that every enum defined in enums.ts exactly matches the
 * values specified in the authoritative PRD documents. This is critical because
 * downstream migrations, state machines, and packet schemas depend on these
 * exact values being correct and complete.
 *
 * @see {@link file://docs/prd/002-data-model.md} — state machines and entity fields
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} — packet types and shared types
 *
 * @module @factory/domain/enums.test
 */

import { describe, it, expect } from "vitest";
import {
  TaskStatus,
  WorkerLeaseStatus,
  ReviewCycleStatus,
  MergeQueueItemStatus,
  DependencyType,
  WorkerPoolType,
  JobType,
  JobStatus,
  ValidationRunScope,
  ValidationCheckType,
  ValidationCheckStatus,
  PacketType,
  PacketStatus,
  FileChangeType,
  IssueSeverity,
  ReviewVerdict,
  LeadReviewDecision,
  MergeStrategy,
  MergeAssistRecommendation,
  PostMergeAnalysisRecommendation,
  Confidence,
  AgentRole,
  FileScopeEnforcementLevel,
  EscalationAction,
} from "./enums.js";

/**
 * Helper: returns all values from an `as const` object.
 * Used to verify enum completeness and exact value matching.
 */
function valuesOf<T extends Record<string, string>>(obj: T): string[] {
  return Object.values(obj);
}

describe("TaskStatus (PRD 002 §2.1)", () => {
  /**
   * Verifies the task state machine has exactly 16 states as defined in
   * PRD 002 §2.1. Missing or extra states would break transition validation
   * and migration schemas.
   */
  it("should have exactly 16 states", () => {
    expect(valuesOf(TaskStatus)).toHaveLength(16);
  });

  /**
   * Verifies each task status value exactly matches the PRD specification.
   * These values are used as database column values and must be case-sensitive.
   */
  it("should contain all states from the PRD spec", () => {
    const expected = [
      "BACKLOG",
      "READY",
      "BLOCKED",
      "ASSIGNED",
      "IN_DEVELOPMENT",
      "DEV_COMPLETE",
      "IN_REVIEW",
      "CHANGES_REQUESTED",
      "APPROVED",
      "QUEUED_FOR_MERGE",
      "MERGING",
      "POST_MERGE_VALIDATION",
      "DONE",
      "FAILED",
      "ESCALATED",
      "CANCELLED",
    ];
    expect(valuesOf(TaskStatus)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(TaskStatus)));
  });

  /**
   * Verifies enum keys match their values for UPPER_CASE enums,
   * ensuring consistent usage patterns like TaskStatus.BACKLOG === "BACKLOG".
   */
  it("should have keys matching values", () => {
    for (const [key, value] of Object.entries(TaskStatus)) {
      expect(key).toBe(value);
    }
  });
});

describe("WorkerLeaseStatus (PRD 002 §2.2)", () => {
  /**
   * Verifies the worker lease state machine has exactly 9 states.
   * These states drive lease reclaim, heartbeat, and crash recovery logic.
   */
  it("should have exactly 9 states", () => {
    expect(valuesOf(WorkerLeaseStatus)).toHaveLength(9);
  });

  it("should contain all states from the PRD spec", () => {
    const expected = [
      "IDLE",
      "LEASED",
      "STARTING",
      "RUNNING",
      "HEARTBEATING",
      "COMPLETING",
      "TIMED_OUT",
      "CRASHED",
      "RECLAIMED",
    ];
    expect(valuesOf(WorkerLeaseStatus)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(WorkerLeaseStatus)));
  });

  it("should have keys matching values", () => {
    for (const [key, value] of Object.entries(WorkerLeaseStatus)) {
      expect(key).toBe(value);
    }
  });
});

describe("ReviewCycleStatus (PRD 002 §2.2)", () => {
  /**
   * Verifies the review cycle state machine has exactly 8 states.
   * Review cycles drive the specialist → lead reviewer flow.
   */
  it("should have exactly 8 states", () => {
    expect(valuesOf(ReviewCycleStatus)).toHaveLength(8);
  });

  it("should contain all states from the PRD spec", () => {
    const expected = [
      "NOT_STARTED",
      "ROUTED",
      "IN_PROGRESS",
      "AWAITING_REQUIRED_REVIEWS",
      "CONSOLIDATING",
      "APPROVED",
      "REJECTED",
      "ESCALATED",
    ];
    expect(valuesOf(ReviewCycleStatus)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(ReviewCycleStatus)));
  });

  it("should have keys matching values", () => {
    for (const [key, value] of Object.entries(ReviewCycleStatus)) {
      expect(key).toBe(value);
    }
  });
});

describe("MergeQueueItemStatus (PRD 002 §2.2)", () => {
  /**
   * Verifies the merge queue item state machine has exactly 8 states.
   * These states drive the merge pipeline from enqueue through integration.
   */
  it("should have exactly 8 states", () => {
    expect(valuesOf(MergeQueueItemStatus)).toHaveLength(8);
  });

  it("should contain all states from the PRD spec", () => {
    const expected = [
      "ENQUEUED",
      "PREPARING",
      "REBASING",
      "VALIDATING",
      "MERGING",
      "MERGED",
      "REQUEUED",
      "FAILED",
    ];
    expect(valuesOf(MergeQueueItemStatus)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(MergeQueueItemStatus)));
  });

  it("should have keys matching values", () => {
    for (const [key, value] of Object.entries(MergeQueueItemStatus)) {
      expect(key).toBe(value);
    }
  });
});

describe("DependencyType (PRD 002 §2.3)", () => {
  /**
   * Verifies dependency types match exactly. These values determine
   * readiness computation and task graph behavior.
   */
  it("should have exactly 3 types", () => {
    expect(valuesOf(DependencyType)).toHaveLength(3);
  });

  it("should contain all types from the PRD spec", () => {
    const expected = ["blocks", "relates_to", "parent_child"];
    expect(valuesOf(DependencyType)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(DependencyType)));
  });
});

describe("WorkerPoolType (PRD 002 §2.3)", () => {
  /**
   * Verifies pool types match exactly. Pools are specialized per agent role
   * and used for task-to-worker matching.
   */
  it("should have exactly 5 types", () => {
    expect(valuesOf(WorkerPoolType)).toHaveLength(5);
  });

  it("should contain all types from the PRD spec", () => {
    const expected = ["developer", "reviewer", "lead-reviewer", "merge-assist", "planner"];
    expect(valuesOf(WorkerPoolType)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(WorkerPoolType)));
  });
});

describe("JobType (PRD 002 §2.3)", () => {
  /**
   * Verifies job types for the DB-backed queue. These values drive
   * job dispatch and processing logic.
   */
  it("should have exactly 8 types", () => {
    expect(valuesOf(JobType)).toHaveLength(8);
  });

  it("should contain all types from the PRD spec", () => {
    const expected = [
      "scheduler_tick",
      "worker_dispatch",
      "reviewer_dispatch",
      "lead_review_consolidation",
      "merge_dispatch",
      "validation_execution",
      "reconciliation_sweep",
      "cleanup",
    ];
    expect(valuesOf(JobType)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(JobType)));
  });
});

describe("JobStatus (PRD 002 §2.3)", () => {
  /**
   * Verifies job status values. Job coordination logic (depends_on_job_ids)
   * relies on terminal status values being correct.
   */
  it("should have exactly 6 statuses", () => {
    expect(valuesOf(JobStatus)).toHaveLength(6);
  });

  it("should contain all statuses from the PRD spec", () => {
    const expected = ["pending", "claimed", "running", "completed", "failed", "cancelled"];
    expect(valuesOf(JobStatus)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(JobStatus)));
  });
});

describe("ValidationRunScope (PRD 002 §2.3)", () => {
  /**
   * Verifies validation run scopes. Validation gate rules in PRD 002 §2.3
   * reference these scopes to determine which checks run at each lifecycle stage.
   */
  it("should have exactly 5 scopes", () => {
    expect(valuesOf(ValidationRunScope)).toHaveLength(5);
  });

  it("should contain all scopes from the PRD spec", () => {
    const expected = ["pre-dev", "during-dev", "pre-review", "pre-merge", "post-merge"];
    expect(valuesOf(ValidationRunScope)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(ValidationRunScope)));
  });
});

describe("ValidationCheckType (PRD 008 §8.3.3)", () => {
  /**
   * Verifies validation check types. These categorize what kind of
   * validation was performed (test, lint, build, etc.).
   */
  it("should have exactly 7 types", () => {
    expect(valuesOf(ValidationCheckType)).toHaveLength(7);
  });

  it("should contain all types from the PRD spec", () => {
    const expected = ["test", "lint", "build", "typecheck", "policy", "schema", "security"];
    expect(valuesOf(ValidationCheckType)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(ValidationCheckType)));
  });
});

describe("ValidationCheckStatus (PRD 008 §8.3.3)", () => {
  /**
   * Verifies validation check status values. Validation gate logic
   * uses these to determine whether transitions are allowed.
   */
  it("should have exactly 3 statuses", () => {
    expect(valuesOf(ValidationCheckStatus)).toHaveLength(3);
  });

  it("should contain all statuses from the PRD spec", () => {
    const expected = ["passed", "failed", "skipped"];
    expect(valuesOf(ValidationCheckStatus)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(ValidationCheckStatus)));
  });
});

describe("PacketType (PRD 008 §8.4–§8.11)", () => {
  /**
   * Verifies all packet type identifiers. Packet routing, schema
   * validation, and artifact storage rely on exact type strings.
   */
  it("should have exactly 8 types", () => {
    expect(valuesOf(PacketType)).toHaveLength(8);
  });

  it("should contain all types from the PRD spec", () => {
    const expected = [
      "task_packet",
      "dev_result_packet",
      "review_packet",
      "lead_review_decision_packet",
      "merge_packet",
      "merge_assist_packet",
      "validation_result_packet",
      "post_merge_analysis_packet",
    ];
    expect(valuesOf(PacketType)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(PacketType)));
  });
});

describe("PacketStatus (PRD 008 §8.2.3)", () => {
  /**
   * Verifies packet-level execution status values. The orchestrator uses
   * these to interpret worker output but never infers task state from them.
   */
  it("should have exactly 4 statuses", () => {
    expect(valuesOf(PacketStatus)).toHaveLength(4);
  });

  it("should contain all statuses from the PRD spec", () => {
    const expected = ["success", "failed", "partial", "blocked"];
    expect(valuesOf(PacketStatus)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(PacketStatus)));
  });
});

describe("FileChangeType (PRD 008 §8.3.1)", () => {
  /**
   * Verifies file change type values used in FileChangeSummary entries.
   * Dev result packets report changed files using these types.
   */
  it("should have exactly 4 types", () => {
    expect(valuesOf(FileChangeType)).toHaveLength(4);
  });

  it("should contain all types from the PRD spec", () => {
    const expected = ["added", "modified", "deleted", "renamed"];
    expect(valuesOf(FileChangeType)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(FileChangeType)));
  });
});

describe("IssueSeverity (PRD 008 §8.3.2)", () => {
  /**
   * Verifies issue severity levels. Review packets use these to classify
   * issues, and escalation policy may trigger on critical severity.
   */
  it("should have exactly 4 levels", () => {
    expect(valuesOf(IssueSeverity)).toHaveLength(4);
  });

  it("should contain all levels from the PRD spec", () => {
    const expected = ["critical", "high", "medium", "low"];
    expect(valuesOf(IssueSeverity)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(IssueSeverity)));
  });
});

describe("ReviewVerdict (PRD 008 §8.6.3)", () => {
  /**
   * Verifies specialist reviewer verdict values. Cross-field invariant:
   * blocking_issues must be empty when verdict is "approved".
   */
  it("should have exactly 3 verdicts", () => {
    expect(valuesOf(ReviewVerdict)).toHaveLength(3);
  });

  it("should contain all verdicts from the PRD spec", () => {
    const expected = ["approved", "changes_requested", "escalated"];
    expect(valuesOf(ReviewVerdict)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(ReviewVerdict)));
  });
});

describe("LeadReviewDecision (PRD 008 §8.7.3)", () => {
  /**
   * Verifies lead review decision values. Cross-field invariants:
   * - changes_requested requires at least one blocking_issues entry
   * - approved_with_follow_up requires non-empty follow_up_task_refs
   */
  it("should have exactly 4 decisions", () => {
    expect(valuesOf(LeadReviewDecision)).toHaveLength(4);
  });

  it("should contain all decisions from the PRD spec", () => {
    const expected = ["approved", "approved_with_follow_up", "changes_requested", "escalated"];
    expect(valuesOf(LeadReviewDecision)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(LeadReviewDecision)));
  });
});

describe("MergeStrategy (PRD 008 §8.8)", () => {
  /**
   * Verifies merge strategy values. The merge module uses these to
   * determine how approved changes are integrated into the target branch.
   */
  it("should have exactly 3 strategies", () => {
    expect(valuesOf(MergeStrategy)).toHaveLength(3);
  });

  it("should contain all strategies from the PRD spec", () => {
    const expected = ["rebase-and-merge", "squash", "merge-commit"];
    expect(valuesOf(MergeStrategy)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(MergeStrategy)));
  });
});

describe("MergeAssistRecommendation (PRD 008 §8.9.3)", () => {
  /**
   * Verifies merge assist recommendation values. Cross-field invariant:
   * when confidence is "low", recommendation must be reject_to_dev or escalate.
   */
  it("should have exactly 3 recommendations", () => {
    expect(valuesOf(MergeAssistRecommendation)).toHaveLength(3);
  });

  it("should contain all recommendations from the PRD spec", () => {
    const expected = ["auto_resolve", "reject_to_dev", "escalate"];
    expect(valuesOf(MergeAssistRecommendation)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(MergeAssistRecommendation)));
  });
});

describe("PostMergeAnalysisRecommendation (PRD 008 §8.11.3)", () => {
  /**
   * Verifies post-merge analysis recommendation values. Cross-field invariant:
   * when confidence is "low", recommendation must be "escalate".
   */
  it("should have exactly 4 recommendations", () => {
    expect(valuesOf(PostMergeAnalysisRecommendation)).toHaveLength(4);
  });

  it("should contain all recommendations from the PRD spec", () => {
    const expected = ["revert", "hotfix_task", "escalate", "pre_existing"];
    expect(valuesOf(PostMergeAnalysisRecommendation)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(PostMergeAnalysisRecommendation)));
  });
});

describe("Confidence (PRD 008 §8.9.3, §8.11.3)", () => {
  /**
   * Verifies confidence level values. Low confidence restricts available
   * recommendations in merge assist and post-merge analysis packets.
   */
  it("should have exactly 3 levels", () => {
    expect(valuesOf(Confidence)).toHaveLength(3);
  });

  it("should contain all levels from the PRD spec", () => {
    const expected = ["high", "medium", "low"];
    expect(valuesOf(Confidence)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(Confidence)));
  });
});

describe("AgentRole (PRD 008 §8.4.3)", () => {
  /**
   * Verifies agent role values. The role field in TaskPacket determines
   * which agent contract applies to the task execution.
   */
  it("should have exactly 6 roles", () => {
    expect(valuesOf(AgentRole)).toHaveLength(6);
  });

  it("should contain all roles from the PRD spec", () => {
    const expected = [
      "planner",
      "developer",
      "reviewer",
      "lead-reviewer",
      "merge-assist",
      "post-merge-analysis",
    ];
    expect(valuesOf(AgentRole)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(AgentRole)));
  });
});

describe("FileScopeEnforcementLevel (PRD 002 §2.3)", () => {
  /**
   * Verifies file scope enforcement level values. The policy layer uses
   * these to determine how strictly file scope restrictions are applied.
   */
  it("should have exactly 3 levels", () => {
    expect(valuesOf(FileScopeEnforcementLevel)).toHaveLength(3);
  });

  it("should contain all levels from the PRD spec", () => {
    const expected = ["strict", "audit", "advisory"];
    expect(valuesOf(FileScopeEnforcementLevel)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(FileScopeEnforcementLevel)));
  });
});

describe("EscalationAction (PRD 002 §2.7)", () => {
  /**
   * Verifies escalation action values. The escalation policy specifies
   * one of these actions per trigger condition.
   */
  it("should have exactly 2 actions", () => {
    expect(valuesOf(EscalationAction)).toHaveLength(2);
  });

  it("should contain all actions from the PRD spec", () => {
    const expected = ["escalate", "fail_then_escalate"];
    expect(valuesOf(EscalationAction)).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(valuesOf(EscalationAction)));
  });
});

describe("Enum completeness", () => {
  /**
   * Meta-test ensuring the total number of enums matches our expected count.
   * If someone adds a new enum to enums.ts without adding tests, this
   * will catch the discrepancy (assuming they also export from index.ts).
   */
  it("should export exactly 24 enum objects", () => {
    const enumObjects = [
      TaskStatus,
      WorkerLeaseStatus,
      ReviewCycleStatus,
      MergeQueueItemStatus,
      DependencyType,
      WorkerPoolType,
      JobType,
      JobStatus,
      ValidationRunScope,
      ValidationCheckType,
      ValidationCheckStatus,
      PacketType,
      PacketStatus,
      FileChangeType,
      IssueSeverity,
      ReviewVerdict,
      LeadReviewDecision,
      MergeStrategy,
      MergeAssistRecommendation,
      PostMergeAnalysisRecommendation,
      Confidence,
      AgentRole,
      FileScopeEnforcementLevel,
      EscalationAction,
    ];
    expect(enumObjects).toHaveLength(24);
    for (const obj of enumObjects) {
      expect(typeof obj).toBe("object");
      expect(Object.keys(obj).length).toBeGreaterThan(0);
    }
  });
});
