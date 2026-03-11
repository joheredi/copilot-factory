/**
 * Tests for the rework context service.
 *
 * These tests verify that a {@link RejectionContext} is correctly assembled
 * from persisted review data when a task receives `changes_requested`.
 * The rework context service is invoked before building the next TaskPacket
 * for a rework attempt, ensuring the developer has precise feedback on
 * what blocking issues to address.
 *
 * Test categories:
 * - Successful assembly: blocking issues from lead decision are included
 * - Fallback to specialist issues: when lead has no blocking issues
 * - Auto-discovery: finds latest rejected cycle when no cycle ID provided
 * - Explicit cycle ID: uses the provided review cycle ID
 * - Prior unresolved issues: includes dev result unresolved issues
 * - Lead decision summary: correctly extracted from packet or record
 * - Error handling: missing task, missing cycle, missing decision
 * - Schema validation: assembled context must pass RejectionContextSchema
 *
 * @module @factory/application/services/rework-context.test
 */

import { describe, it, expect } from "vitest";

import {
  createReworkContextService,
  RejectionContextAssemblyError,
} from "./rework-context.service.js";
import type { ReworkContextService, ReworkContextDependencies } from "./rework-context.service.js";
import type {
  ReworkTask,
  ReworkReviewCycle,
  ReworkLeadReviewDecision,
  ReworkSpecialistPacket,
  ReworkDevResult,
  ReworkContextTransactionRepositories,
  ReworkContextUnitOfWork,
} from "../ports/rework-context.ports.js";
import { EntityNotFoundError } from "../errors.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const FIXED_DATE = new Date("2025-06-15T10:00:00.000Z");

/**
 * Creates a mock task record with sensible defaults for rework context testing.
 */
function createMockTask(overrides: Partial<ReworkTask> = {}): ReworkTask {
  return {
    id: "task-001",
    currentReviewCycleId: "cycle-001",
    reviewRoundCount: 1,
    ...overrides,
  };
}

/**
 * Creates a mock review cycle in REJECTED state (the expected state
 * for rejection context assembly).
 */
function createMockCycle(overrides: Partial<ReworkReviewCycle> = {}): ReworkReviewCycle {
  return {
    reviewCycleId: "cycle-001",
    taskId: "task-001",
    status: "REJECTED",
    ...overrides,
  };
}

/**
 * Creates a valid blocking issue for inclusion in review packets.
 * Uses the Issue shape from PRD §8.3.2.
 */
function createBlockingIssue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    severity: "high",
    code: "security-bypass",
    title: "Command wrapper bypasses allowlist",
    description: "The implementation executes a raw shell string without policy validation.",
    file_path: "packages/infrastructure/src/runner/exec.ts",
    line: 61,
    blocking: true,
    ...overrides,
  };
}

/**
 * Creates a mock lead review decision with a `changes_requested` verdict
 * and the given blocking issues embedded in the packet JSON.
 */
function createMockDecision(
  overrides: Partial<ReworkLeadReviewDecision> = {},
  blockingIssues?: Record<string, unknown>[],
): ReworkLeadReviewDecision {
  const issues = blockingIssues ?? [createBlockingIssue()];
  return {
    leadReviewDecisionId: "decision-001",
    reviewCycleId: "cycle-001",
    taskId: "task-001",
    decision: "changes_requested",
    summary: "Address blocking security review issue before re-review.",
    blockingIssueCount: issues.length,
    packetJson: {
      packet_type: "lead_review_decision_packet",
      schema_version: "1.0",
      created_at: "2025-06-15T10:00:00.000Z",
      task_id: "task-001",
      repository_id: "repo-001",
      review_cycle_id: "cycle-001",
      decision: "changes_requested",
      summary: "Address blocking security review issue before re-review.",
      blocking_issues: issues,
      non_blocking_suggestions: [],
      deduplication_notes: [],
      follow_up_task_refs: [],
      risks: [],
      open_questions: [],
    },
    createdAt: FIXED_DATE,
    ...overrides,
  };
}

/**
 * Creates a mock specialist review packet with blocking issues.
 */
function createMockSpecialistPacket(
  overrides: Partial<ReworkSpecialistPacket> = {},
  blockingIssues?: Record<string, unknown>[],
): ReworkSpecialistPacket {
  const issues = blockingIssues ?? [
    createBlockingIssue({
      code: "specialist-issue",
      title: "Specialist found an issue",
      description: "Detailed specialist finding.",
    }),
  ];
  return {
    reviewPacketId: "packet-001",
    reviewCycleId: "cycle-001",
    reviewerType: "security",
    verdict: "changes_requested",
    packetJson: {
      packet_type: "review_packet",
      schema_version: "1.0",
      created_at: "2025-06-15T10:00:00.000Z",
      task_id: "task-001",
      repository_id: "repo-001",
      review_cycle_id: "cycle-001",
      reviewer_pool_id: "security-reviewers",
      reviewer_type: "security",
      verdict: "changes_requested",
      summary: "Blocking issue found.",
      blocking_issues: issues,
      non_blocking_issues: [],
      confidence: "high",
      follow_up_task_refs: [],
      risks: [],
      open_questions: [],
    },
    ...overrides,
  };
}

/**
 * Creates a mock dev result with unresolved issues.
 */
function createMockDevResult(
  overrides: Partial<ReworkDevResult> = {},
  unresolvedIssues?: string[],
): ReworkDevResult {
  return {
    runId: "run-001",
    taskId: "task-001",
    packetJson: {
      packet_type: "dev_result_packet",
      schema_version: "1.0",
      task_id: "task-001",
      repository_id: "repo-001",
      run_id: "run-001",
      status: "success",
      summary: "Implementation complete.",
      result: {
        branch_name: "factory/task-001",
        files_changed: [],
        validations_run: [],
        assumptions: [],
        risks: [],
        unresolved_issues: unresolvedIssues ?? ["Edge case handling for empty input"],
      },
    },
    ...overrides,
  };
}

/**
 * Repository state for configuring mock repos in tests.
 */
interface MockRepoState {
  task?: ReworkTask;
  cycles?: ReworkReviewCycle[];
  decisions?: ReworkLeadReviewDecision[];
  specialistPackets?: ReworkSpecialistPacket[];
  devResults?: ReworkDevResult[];
}

/**
 * Creates mock repositories from the given state configuration.
 * Each repository method operates over the provided state arrays.
 */
function createMockRepos(state: MockRepoState): ReworkContextTransactionRepositories {
  return {
    task: {
      findById: (id: string) => (state.task?.id === id ? state.task : undefined),
    },
    reviewCycle: {
      findById: (reviewCycleId: string) =>
        (state.cycles ?? []).find((c) => c.reviewCycleId === reviewCycleId),
      findLatestRejectedByTaskId: (taskId: string) =>
        (state.cycles ?? []).filter((c) => c.taskId === taskId && c.status === "REJECTED").at(-1),
    },
    leadReviewDecision: {
      findByReviewCycleId: (reviewCycleId: string) =>
        (state.decisions ?? []).find((d) => d.reviewCycleId === reviewCycleId),
    },
    specialistPacket: {
      findByReviewCycleId: (reviewCycleId: string) =>
        (state.specialistPackets ?? []).filter((p) => p.reviewCycleId === reviewCycleId),
    },
    devResult: {
      findLatestByTaskId: (taskId: string) =>
        (state.devResults ?? []).filter((d) => d.taskId === taskId).at(-1),
    },
  };
}

/**
 * Creates a mock unit of work that delegates directly to the given repos.
 */
function createMockUnitOfWork(
  repos: ReworkContextTransactionRepositories,
): ReworkContextUnitOfWork {
  return {
    runInTransaction: <T>(fn: (r: ReworkContextTransactionRepositories) => T): T => fn(repos),
  };
}

/**
 * Creates a fully wired service from a mock state configuration.
 */
function createServiceFromState(state: MockRepoState): ReworkContextService {
  const repos = createMockRepos(state);
  const unitOfWork = createMockUnitOfWork(repos);
  const deps: ReworkContextDependencies = { unitOfWork };
  return createReworkContextService(deps);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReworkContextService", () => {
  // ── Successful assembly ───────────────────────────────────────────────

  describe("successful assembly with explicit review cycle ID", () => {
    /**
     * Verifies the core happy path: given a rejected review cycle with a
     * lead decision containing blocking issues, the service assembles a
     * valid RejectionContext with the correct prior_review_cycle_id,
     * blocking_issues, and lead_decision_summary.
     *
     * This is the foundational test — if this fails, no rework TaskPacket
     * can carry rejection feedback to the developer.
     */
    it("assembles RejectionContext from lead decision blocking issues", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [createMockDecision()],
        specialistPackets: [],
        devResults: [],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      expect(result.reviewCycleId).toBe("cycle-001");
      expect(result.rejectionContext.prior_review_cycle_id).toBe("cycle-001");
      expect(result.rejectionContext.blocking_issues).toHaveLength(1);
      expect(result.rejectionContext.blocking_issues[0]!.code).toBe("security-bypass");
      expect(result.rejectionContext.blocking_issues[0]!.blocking).toBe(true);
      expect(result.rejectionContext.lead_decision_summary).toBe(
        "Address blocking security review issue before re-review.",
      );
    });
  });

  describe("successful assembly with auto-discovered cycle", () => {
    /**
     * Verifies that when no explicit reviewCycleId is provided, the service
     * automatically finds the latest rejected review cycle for the task.
     * This supports the common flow where the scheduler doesn't track which
     * specific cycle was rejected — it just needs the rejection context.
     */
    it("finds latest rejected cycle when reviewCycleId is omitted", () => {
      const service = createServiceFromState({
        task: createMockTask({ currentReviewCycleId: null }),
        cycles: [
          createMockCycle({ reviewCycleId: "cycle-old", status: "REJECTED" }),
          createMockCycle({ reviewCycleId: "cycle-latest", status: "REJECTED" }),
        ],
        decisions: [
          createMockDecision({
            reviewCycleId: "cycle-latest",
            summary: "Latest rejection.",
            packetJson: {
              packet_type: "lead_review_decision_packet",
              schema_version: "1.0",
              created_at: "2025-06-15T10:00:00.000Z",
              task_id: "task-001",
              repository_id: "repo-001",
              review_cycle_id: "cycle-latest",
              decision: "changes_requested",
              summary: "Latest rejection.",
              blocking_issues: [createBlockingIssue({ code: "latest-issue" })],
              non_blocking_suggestions: [],
              deduplication_notes: [],
              follow_up_task_refs: [],
              risks: [],
              open_questions: [],
            },
          }),
        ],
        specialistPackets: [],
        devResults: [],
      });

      const result = service.buildRejectionContext({ taskId: "task-001" });

      expect(result.reviewCycleId).toBe("cycle-latest");
      expect(result.rejectionContext.prior_review_cycle_id).toBe("cycle-latest");
      expect(result.rejectionContext.blocking_issues[0]!.code).toBe("latest-issue");
    });
  });

  // ── Blocking issue sources ────────────────────────────────────────────

  describe("blocking issue source selection", () => {
    /**
     * Verifies that when the lead decision has blocking issues, they
     * take priority over specialist blocking issues (since the lead
     * reviewer may have deduplicated or re-prioritized them).
     */
    it("uses lead decision blocking issues when available", () => {
      const leadIssue = createBlockingIssue({
        code: "lead-consolidated",
        title: "Consolidated by lead",
      });
      const specialistIssue = createBlockingIssue({
        code: "specialist-original",
        title: "Original from specialist",
      });

      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [createMockDecision({}, [leadIssue])],
        specialistPackets: [createMockSpecialistPacket({}, [specialistIssue])],
        devResults: [],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      expect(result.rejectionContext.blocking_issues).toHaveLength(1);
      expect(result.rejectionContext.blocking_issues[0]!.code).toBe("lead-consolidated");
    });

    /**
     * Verifies fallback behavior: when the lead decision packet has no
     * blocking_issues array (or it's empty), specialist blocking issues
     * are used instead. This handles edge cases where the lead decision
     * record exists but blocking issues weren't embedded in the packet.
     */
    it("falls back to specialist blocking issues when lead has none", () => {
      const specialistIssue = createBlockingIssue({
        code: "specialist-fallback",
        title: "Specialist issue used as fallback",
      });

      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [
          createMockDecision(
            {
              packetJson: {
                packet_type: "lead_review_decision_packet",
                schema_version: "1.0",
                created_at: "2025-06-15T10:00:00.000Z",
                task_id: "task-001",
                repository_id: "repo-001",
                review_cycle_id: "cycle-001",
                decision: "changes_requested",
                summary: "Has issues but none embedded in packet.",
                blocking_issues: [],
                non_blocking_suggestions: [],
                deduplication_notes: [],
                follow_up_task_refs: [],
                risks: [],
                open_questions: [],
              },
            },
            [],
          ),
        ],
        specialistPackets: [createMockSpecialistPacket({}, [specialistIssue])],
        devResults: [],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      expect(result.rejectionContext.blocking_issues).toHaveLength(1);
      expect(result.rejectionContext.blocking_issues[0]!.code).toBe("specialist-fallback");
    });

    /**
     * Verifies that blocking issues from multiple specialist reviewers
     * are concatenated when used as fallback.
     */
    it("concatenates issues from multiple specialists on fallback", () => {
      const securityIssue = createBlockingIssue({
        code: "security-issue",
        title: "Security finding",
      });
      const performanceIssue = createBlockingIssue({
        code: "performance-issue",
        title: "Performance finding",
      });

      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [
          createMockDecision(
            {
              packetJson: {
                packet_type: "lead_review_decision_packet",
                schema_version: "1.0",
                created_at: "2025-06-15T10:00:00.000Z",
                task_id: "task-001",
                repository_id: "repo-001",
                review_cycle_id: "cycle-001",
                decision: "changes_requested",
                summary: "Multiple specialists found issues.",
                blocking_issues: [],
                non_blocking_suggestions: [],
                deduplication_notes: [],
                follow_up_task_refs: [],
                risks: [],
                open_questions: [],
              },
            },
            [],
          ),
        ],
        specialistPackets: [
          createMockSpecialistPacket(
            { reviewPacketId: "packet-security", reviewerType: "security" },
            [securityIssue],
          ),
          createMockSpecialistPacket(
            { reviewPacketId: "packet-perf", reviewerType: "performance" },
            [performanceIssue],
          ),
        ],
        devResults: [],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      expect(result.rejectionContext.blocking_issues).toHaveLength(2);
      const codes = result.rejectionContext.blocking_issues.map((i) => i.code);
      expect(codes).toContain("security-issue");
      expect(codes).toContain("performance-issue");
    });
  });

  // ── Prior unresolved issues ───────────────────────────────────────────

  describe("prior unresolved issues from dev result", () => {
    /**
     * Verifies that unresolved issues from the prior dev result are
     * extracted and returned alongside the rejection context. These
     * issues were flagged by the developer themselves and inform the
     * next attempt about known remaining work.
     */
    it("includes unresolved issues from the latest dev result", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [createMockDecision()],
        specialistPackets: [],
        devResults: [
          createMockDevResult({}, [
            "Edge case handling for empty input",
            "TODO: add retry logic for flaky network",
          ]),
        ],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      expect(result.priorUnresolvedIssues).toHaveLength(2);
      expect(result.priorUnresolvedIssues).toContain("Edge case handling for empty input");
      expect(result.priorUnresolvedIssues).toContain("TODO: add retry logic for flaky network");
    });

    /**
     * Verifies that when no dev result exists, prior unresolved issues
     * are returned as an empty array (not undefined or null).
     */
    it("returns empty array when no dev result exists", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [createMockDecision()],
        specialistPackets: [],
        devResults: [],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      expect(result.priorUnresolvedIssues).toEqual([]);
    });

    /**
     * Verifies that when the dev result has no unresolved_issues field,
     * an empty array is returned.
     */
    it("returns empty array when dev result has no unresolved_issues", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [createMockDecision()],
        specialistPackets: [],
        devResults: [
          {
            runId: "run-001",
            taskId: "task-001",
            packetJson: {
              result: {
                branch_name: "factory/task-001",
                files_changed: [],
                validations_run: [],
              },
            },
          },
        ],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      expect(result.priorUnresolvedIssues).toEqual([]);
    });
  });

  // ── Lead decision summary extraction ──────────────────────────────────

  describe("lead decision summary extraction", () => {
    /**
     * Verifies that the summary is extracted from the packet JSON when
     * available, which is the primary source.
     */
    it("extracts summary from packet JSON", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [
          createMockDecision({
            summary: "Record-level summary",
            packetJson: {
              packet_type: "lead_review_decision_packet",
              schema_version: "1.0",
              created_at: "2025-06-15T10:00:00.000Z",
              task_id: "task-001",
              repository_id: "repo-001",
              review_cycle_id: "cycle-001",
              decision: "changes_requested",
              summary: "Packet-level summary takes precedence.",
              blocking_issues: [createBlockingIssue()],
              non_blocking_suggestions: [],
              deduplication_notes: [],
              follow_up_task_refs: [],
              risks: [],
              open_questions: [],
            },
          }),
        ],
        specialistPackets: [],
        devResults: [],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      expect(result.rejectionContext.lead_decision_summary).toBe(
        "Packet-level summary takes precedence.",
      );
    });

    /**
     * Verifies fallback: when the packet JSON doesn't contain a summary
     * string, the record-level summary field is used instead.
     */
    it("falls back to record summary when packet has no summary", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [
          createMockDecision({
            summary: "Record-level fallback summary",
            packetJson: {
              blocking_issues: [createBlockingIssue()],
            },
          }),
        ],
        specialistPackets: [],
        devResults: [],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      expect(result.rejectionContext.lead_decision_summary).toBe("Record-level fallback summary");
    });
  });

  // ── Error handling ────────────────────────────────────────────────────

  describe("error handling", () => {
    /**
     * Verifies that EntityNotFoundError is thrown when the task doesn't exist.
     * Guards against calling buildRejectionContext with an invalid task ID.
     */
    it("throws EntityNotFoundError when task does not exist", () => {
      const service = createServiceFromState({
        task: undefined,
        cycles: [createMockCycle()],
        decisions: [createMockDecision()],
      });

      expect(() =>
        service.buildRejectionContext({
          taskId: "nonexistent",
          reviewCycleId: "cycle-001",
        }),
      ).toThrow(EntityNotFoundError);
    });

    /**
     * Verifies that EntityNotFoundError is thrown when the specified
     * review cycle doesn't exist.
     */
    it("throws EntityNotFoundError when explicit cycle does not exist", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [],
        decisions: [createMockDecision()],
      });

      expect(() =>
        service.buildRejectionContext({
          taskId: "task-001",
          reviewCycleId: "nonexistent",
        }),
      ).toThrow(EntityNotFoundError);
    });

    /**
     * Verifies that EntityNotFoundError is thrown when the review cycle
     * exists but belongs to a different task.
     */
    it("throws EntityNotFoundError when cycle belongs to different task", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle({ taskId: "other-task" })],
        decisions: [createMockDecision()],
      });

      expect(() =>
        service.buildRejectionContext({
          taskId: "task-001",
          reviewCycleId: "cycle-001",
        }),
      ).toThrow(EntityNotFoundError);
    });

    /**
     * Verifies that EntityNotFoundError is thrown when no rejected
     * review cycle is found during auto-discovery.
     */
    it("throws EntityNotFoundError when no rejected cycle found", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle({ status: "APPROVED" })],
        decisions: [],
      });

      expect(() => service.buildRejectionContext({ taskId: "task-001" })).toThrow(
        EntityNotFoundError,
      );
    });

    /**
     * Verifies that EntityNotFoundError is thrown when the lead review
     * decision record doesn't exist for the review cycle.
     */
    it("throws EntityNotFoundError when lead decision not found", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [],
        specialistPackets: [],
      });

      expect(() =>
        service.buildRejectionContext({
          taskId: "task-001",
          reviewCycleId: "cycle-001",
        }),
      ).toThrow(EntityNotFoundError);
    });

    /**
     * Verifies that RejectionContextAssemblyError is thrown when no
     * blocking issues are available from either the lead decision or
     * specialist packets, because the RejectionContextSchema requires
     * at least one blocking issue.
     */
    it("throws RejectionContextAssemblyError when no blocking issues available", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [
          createMockDecision(
            {
              packetJson: {
                packet_type: "lead_review_decision_packet",
                schema_version: "1.0",
                created_at: "2025-06-15T10:00:00.000Z",
                task_id: "task-001",
                repository_id: "repo-001",
                review_cycle_id: "cycle-001",
                decision: "changes_requested",
                summary: "No issues somehow.",
                blocking_issues: [],
                non_blocking_suggestions: [],
                deduplication_notes: [],
                follow_up_task_refs: [],
                risks: [],
                open_questions: [],
              },
            },
            [],
          ),
        ],
        specialistPackets: [],
        devResults: [],
      });

      expect(() =>
        service.buildRejectionContext({
          taskId: "task-001",
          reviewCycleId: "cycle-001",
        }),
      ).toThrow(RejectionContextAssemblyError);
    });
  });

  // ── Schema validation ─────────────────────────────────────────────────

  describe("schema validation", () => {
    /**
     * Verifies that the assembled RejectionContext passes the Zod schema
     * validation, confirming it matches the canonical shape from PRD §8.12.
     * This ensures the context is valid for inclusion in a TaskPacket.
     */
    it("assembled context passes RejectionContextSchema validation", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [createMockDecision()],
        specialistPackets: [],
        devResults: [],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      // The RejectionContextSchema validation is done inside the service,
      // so reaching here without error means it passed. Verify structure.
      expect(result.rejectionContext).toHaveProperty("prior_review_cycle_id");
      expect(result.rejectionContext).toHaveProperty("blocking_issues");
      expect(result.rejectionContext).toHaveProperty("lead_decision_summary");
      expect(result.rejectionContext.blocking_issues.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * Verifies that multiple blocking issues with all optional fields
     * are correctly preserved through assembly and validation.
     */
    it("preserves all issue fields through assembly", () => {
      const detailedIssue = createBlockingIssue({
        severity: "critical",
        code: "data-loss",
        title: "Database writes not atomic",
        description: "Concurrent writes can cause data corruption.",
        file_path: "apps/control-plane/src/db/write.ts",
        line: 42,
        blocking: true,
      });

      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [createMockDecision({}, [detailedIssue])],
        specialistPackets: [],
        devResults: [],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      const issue = result.rejectionContext.blocking_issues[0]!;
      expect(issue.severity).toBe("critical");
      expect(issue.code).toBe("data-loss");
      expect(issue.title).toBe("Database writes not atomic");
      expect(issue.description).toBe("Concurrent writes can cause data corruption.");
      expect(issue.file_path).toBe("apps/control-plane/src/db/write.ts");
      expect(issue.line).toBe(42);
      expect(issue.blocking).toBe(true);
    });
  });

  // ── Defensive handling of malformed data ──────────────────────────────

  describe("defensive handling of malformed packet data", () => {
    /**
     * Verifies that when the lead decision packet JSON has an unexpected
     * structure (no blocking_issues field), the service falls back to
     * specialist packets rather than crashing.
     */
    it("handles missing blocking_issues in lead packet gracefully", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [
          createMockDecision({
            packetJson: { summary: "A valid summary but no issues array" },
          }),
        ],
        specialistPackets: [createMockSpecialistPacket()],
        devResults: [],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      // Should fall back to specialist issues
      expect(result.rejectionContext.blocking_issues).toHaveLength(1);
    });

    /**
     * Verifies that null packet JSON on the lead decision doesn't crash
     * the service — it falls back to specialist packets.
     */
    it("handles null packet JSON on decision gracefully", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [
          createMockDecision({
            packetJson: null,
          }),
        ],
        specialistPackets: [createMockSpecialistPacket()],
        devResults: [],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      expect(result.rejectionContext.blocking_issues).toHaveLength(1);
    });

    /**
     * Verifies that malformed specialist packet JSON is safely skipped
     * without propagating errors.
     */
    it("skips specialist packets with malformed JSON", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [createMockDecision()],
        specialistPackets: [
          { ...createMockSpecialistPacket(), packetJson: "not an object" },
          { ...createMockSpecialistPacket(), packetJson: null },
        ],
        devResults: [],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      // Lead decision has blocking issues, so those are used
      expect(result.rejectionContext.blocking_issues).toHaveLength(1);
    });

    /**
     * Verifies that when dev result packet has unexpected structure,
     * unresolved issues come back as empty array.
     */
    it("handles malformed dev result packet gracefully", () => {
      const service = createServiceFromState({
        task: createMockTask(),
        cycles: [createMockCycle()],
        decisions: [createMockDecision()],
        specialistPackets: [],
        devResults: [
          {
            runId: "run-001",
            taskId: "task-001",
            packetJson: "totally not valid JSON object",
          },
        ],
      });

      const result = service.buildRejectionContext({
        taskId: "task-001",
        reviewCycleId: "cycle-001",
      });

      expect(result.priorUnresolvedIssues).toEqual([]);
    });
  });
});
