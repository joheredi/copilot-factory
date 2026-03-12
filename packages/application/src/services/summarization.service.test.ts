/**
 * Tests for the summarization service.
 *
 * These tests verify that the summarization service correctly:
 * - Reads and condenses failed-run artifacts into bounded summaries
 * - Handles missing artifacts gracefully (best-effort extraction)
 * - Enforces the 2000-character size limit through progressive truncation
 * - Stores the generated summary as an artifact
 * - Produces summaries compatible with TaskPacket.context.prior_partial_work
 *
 * @module @factory/application/services/summarization.service.test
 */

import { describe, it, expect, vi } from "vitest";

import type {
  FailedRunInfo,
  SummarizationArtifactReaderPort,
  SummarizationArtifactWriterPort,
  SummaryFileChange,
  SummaryValidation,
} from "../ports/summarization.ports.js";
import {
  createSummarizationService,
  SUMMARY_CHARACTER_LIMIT,
  extractFilesChanged,
  extractValidations,
  extractFailurePoints,
  buildFailureSummary,
  enforceCharacterLimit,
  truncate,
} from "./summarization.service.js";
import type {
  GenerateRetrySummaryParams,
  SummarizationDependencies,
} from "./summarization.service.js";
import type { RetrySummary } from "../ports/summarization.ports.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

const FIXED_NOW = new Date("2025-06-15T12:00:00.000Z");

function createDefaultParams(
  overrides?: Partial<GenerateRetrySummaryParams>,
): GenerateRetrySummaryParams {
  return {
    taskId: "task-100",
    repoId: "repo-1",
    failedRunId: "run-42",
    attemptNumber: 1,
    ...overrides,
  };
}

function createFailedRunInfo(overrides?: Partial<FailedRunInfo>): FailedRunInfo {
  return {
    status: "failed",
    resultSummary: "Build failed due to type errors in auth module",
    filesChanged: [
      { path: "src/auth.ts", changeType: "modified" },
      { path: "src/auth.test.ts", changeType: "added" },
    ],
    validationsRun: [
      { checkType: "typecheck", status: "failed", summary: "3 type errors found" },
      { checkType: "test", status: "passed", summary: "12 tests passed" },
      { checkType: "lint", status: "passed", summary: "No lint errors" },
    ],
    unresolvedIssues: ["Type mismatch in UserService.authenticate return type"],
    risks: ["Auth module refactor may break existing session handling"],
    ...overrides,
  };
}

function createPartialWork() {
  return {
    capturedAt: "2025-06-15T11:55:00.000Z",
    modifiedFiles: ["src/auth.ts", "src/auth.test.ts", "src/config.ts"],
    gitDiffRef: "repositories/repo-1/tasks/task-100/runs/run-42/outputs/git-diff.patch",
    partialOutputRefs: [
      "repositories/repo-1/tasks/task-100/runs/run-42/outputs/partial-result.json",
    ],
  };
}

function createFakeReader(
  runInfo: FailedRunInfo | null = null,
  partialWork: ReturnType<typeof createPartialWork> | null = null,
): SummarizationArtifactReaderPort {
  return {
    readFailedRunInfo: vi.fn().mockResolvedValue(runInfo),
    readPartialWorkSnapshot: vi.fn().mockResolvedValue(partialWork),
  };
}

function createFakeWriter(): SummarizationArtifactWriterPort {
  return {
    storeSummary: vi
      .fn()
      .mockImplementation((repoId: string, taskId: string, filename: string) =>
        Promise.resolve(`repositories/${repoId}/tasks/${taskId}/summaries/${filename}`),
      ),
  };
}

function createDeps(overrides?: Partial<SummarizationDependencies>): SummarizationDependencies {
  return {
    artifactReader: createFakeReader(),
    artifactWriter: createFakeWriter(),
    clock: () => FIXED_NOW,
    ...overrides,
  };
}

// ─── Unit Tests: Pure Extraction Functions ──────────────────────────────────

describe("truncate", () => {
  /**
   * Verifies that strings shorter than the limit are returned unchanged,
   * important to ensure we don't corrupt data that already fits.
   */
  it("should return string unchanged if within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  /**
   * Verifies that strings exceeding the limit are truncated with an
   * ellipsis indicator, important for bounded summaries.
   */
  it("should truncate and append ellipsis if over limit", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
  });

  /**
   * Verifies exact-length strings pass through without modification.
   */
  it("should handle exact-length strings", () => {
    expect(truncate("12345", 5)).toBe("12345");
  });
});

describe("extractFilesChanged", () => {
  /**
   * Verifies that structured file changes from the DevResultPacket are
   * preferred over raw file lists from crash recovery, because the
   * result packet data includes change types.
   */
  it("should prefer DevResultPacket file changes over partial work", () => {
    const runInfo = createFailedRunInfo();
    const partialWork = createPartialWork();

    const result = extractFilesChanged(runInfo, partialWork);

    expect(result).toEqual([
      { path: "src/auth.ts", changeType: "modified" },
      { path: "src/auth.test.ts", changeType: "added" },
    ]);
  });

  /**
   * Verifies fallback to partial work snapshot's modified files list
   * when the DevResultPacket is unavailable (crash scenario).
   */
  it("should fall back to partial work modified files", () => {
    const partialWork = createPartialWork();

    const result = extractFilesChanged(null, partialWork);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ path: "src/auth.ts", changeType: "modified" });
  });

  /**
   * Verifies that when neither source is available, an empty array is
   * returned rather than throwing, supporting the best-effort model.
   */
  it("should return empty array if no data available", () => {
    expect(extractFilesChanged(null, null)).toEqual([]);
  });

  /**
   * Verifies the MAX_FILE_CHANGES cap prevents bloated summaries
   * when many files were changed.
   */
  it("should cap file changes at 10", () => {
    const manyFiles: SummaryFileChange[] = Array.from({ length: 20 }, (_, i) => ({
      path: `src/file-${String(i)}.ts`,
      changeType: "modified",
    }));
    const runInfo = createFailedRunInfo({ filesChanged: manyFiles });

    const result = extractFilesChanged(runInfo, null);

    expect(result).toHaveLength(10);
  });
});

describe("extractValidations", () => {
  /**
   * Verifies that failed validations appear first in the sorted output,
   * since they're the most useful signal for retry workers.
   */
  it("should sort validations with failures first", () => {
    const runInfo = createFailedRunInfo();

    const result = extractValidations(runInfo);

    expect(result[0]!.status).toBe("failed");
    expect(result[1]!.status).toBe("passed");
  });

  /**
   * Verifies that null run info produces an empty array, supporting
   * the best-effort extraction model.
   */
  it("should return empty array for null run info", () => {
    expect(extractValidations(null)).toEqual([]);
  });

  /**
   * Verifies the MAX_VALIDATIONS cap prevents bloated summaries.
   */
  it("should cap at 5 validations", () => {
    const manyValidations: SummaryValidation[] = Array.from({ length: 10 }, (_, i) => ({
      checkType: `check-${String(i)}`,
      status: "failed",
      summary: `Check ${String(i)} failed`,
    }));
    const runInfo = createFailedRunInfo({ validationsRun: manyValidations });

    const result = extractValidations(runInfo);

    expect(result).toHaveLength(5);
  });
});

describe("extractFailurePoints", () => {
  /**
   * Verifies that unresolved issues are included as failure points,
   * since they directly indicate what went wrong.
   */
  it("should include unresolved issues from run info", () => {
    const runInfo = createFailedRunInfo();

    const result = extractFailurePoints(runInfo, null);

    expect(result).toContain("Type mismatch in UserService.authenticate return type");
  });

  /**
   * Verifies that risk notes are appended after unresolved issues,
   * providing additional failure context.
   */
  it("should include risks prefixed with 'Risk:'", () => {
    const runInfo = createFailedRunInfo({ unresolvedIssues: [] });

    const result = extractFailurePoints(runInfo, null);

    expect(result[0]).toContain("Risk:");
  });

  /**
   * Verifies crash recovery fallback when no structured failure info
   * is available — the summary still provides useful context.
   */
  it("should fall back to partial work description on crash", () => {
    const partialWork = createPartialWork();

    const result = extractFailurePoints(null, partialWork);

    expect(result[0]).toContain("crashed or timed out");
    expect(result[0]).toContain("3 file(s)");
  });

  /**
   * Verifies that when no information is available at all, a default
   * message is provided rather than an empty array.
   */
  it("should provide default message when nothing available", () => {
    const result = extractFailurePoints(null, null);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("No detailed failure information");
  });
});

describe("buildFailureSummary", () => {
  /**
   * Verifies the result summary from DevResultPacket is preferred
   * when available, as it's the most authoritative source.
   */
  it("should use result summary when available", () => {
    const runInfo = createFailedRunInfo();

    const result = buildFailureSummary(runInfo, null);

    expect(result).toBe("Build failed due to type errors in auth module");
  });

  /**
   * Verifies crash-context summary when only partial work is available.
   */
  it("should describe crash when only partial work available", () => {
    const partialWork = createPartialWork();

    const result = buildFailureSummary(null, partialWork);

    expect(result).toContain("crashed/timed out");
    expect(result).toContain("3 file(s)");
  });

  /**
   * Verifies a default message when no source data is available.
   */
  it("should provide default message when nothing available", () => {
    const result = buildFailureSummary(null, null);

    expect(result).toContain("no result packet");
  });
});

describe("enforceCharacterLimit", () => {
  /**
   * Verifies that summaries already under the limit pass through
   * unchanged, with the characterCount field populated correctly.
   */
  it("should set characterCount for summaries under limit", () => {
    const summary: RetrySummary = {
      summary_type: "retry_summary",
      schema_version: "1.0",
      generatedAt: FIXED_NOW.toISOString(),
      taskId: "task-1",
      failedRunId: "run-1",
      attemptNumber: 1,
      failedRunStatus: "failed",
      failureSummary: "Brief failure",
      filesChanged: [{ path: "src/a.ts", changeType: "modified" }],
      validationsRun: [{ checkType: "test", status: "failed", summary: "1 failure" }],
      failurePoints: ["Test assertion failed"],
      fullResultRef: null,
      partialWorkRef: null,
      summaryArtifactRef: "summaries/test.json",
      characterCount: 0,
    };

    const result = enforceCharacterLimit(summary);

    expect(result.characterCount).toBeGreaterThan(0);
    expect(result.characterCount).toBeLessThanOrEqual(SUMMARY_CHARACTER_LIMIT);
    expect(result.filesChanged).toHaveLength(1);
  });

  /**
   * Verifies that oversized summaries are progressively truncated
   * to fit within the character limit, important for the bounded
   * context guarantee that retry workers depend on.
   */
  it("should truncate oversized summaries to fit within limit", () => {
    const manyFiles: SummaryFileChange[] = Array.from({ length: 10 }, (_, i) => ({
      path: `src/very/long/deeply/nested/path/to/file-${String(i)}.ts`,
      changeType: "modified",
    }));
    const manyValidations: SummaryValidation[] = Array.from({ length: 5 }, (_, i) => ({
      checkType: `check-${String(i)}`,
      status: "failed",
      summary: `Very long validation summary that explains in great detail what went wrong with check number ${String(i)}`,
    }));
    const manyFailurePoints = Array.from(
      { length: 5 },
      (_, i) =>
        `Detailed failure point ${String(i)} with extensive explanation of the root cause and potential remediation steps`,
    );

    const summary: RetrySummary = {
      summary_type: "retry_summary",
      schema_version: "1.0",
      generatedAt: FIXED_NOW.toISOString(),
      taskId: "task-1",
      failedRunId: "run-1",
      attemptNumber: 1,
      failedRunStatus: "failed",
      failureSummary:
        "A very long failure summary that goes on and on about what happened during the failed run attempt",
      filesChanged: manyFiles,
      validationsRun: manyValidations,
      failurePoints: manyFailurePoints,
      fullResultRef: "repositories/repo-1/tasks/task-1/runs/run-1/outputs/dev-result-packet.json",
      partialWorkRef: "repositories/repo-1/tasks/task-1/summaries/partial-work-run-1.json",
      summaryArtifactRef: "repositories/repo-1/tasks/task-1/summaries/retry-summary-run-run-1.json",
      characterCount: 0,
    };

    const result = enforceCharacterLimit(summary);

    expect(result.characterCount).toBeLessThanOrEqual(SUMMARY_CHARACTER_LIMIT);
    // Should have fewer items than the original
    expect(
      result.filesChanged.length < manyFiles.length ||
        result.validationsRun.length < manyValidations.length ||
        result.failurePoints.length < manyFailurePoints.length,
    ).toBe(true);
  });
});

// ─── Integration Tests: Full Service ────────────────────────────────────────

describe("createSummarizationService", () => {
  describe("generateRetrySummary", () => {
    /**
     * Verifies the happy path: when both a DevResultPacket and a
     * PartialWorkSnapshot are available, the summary incorporates
     * information from both sources and stores the result as an artifact.
     * This is the primary scenario for retry context generation.
     */
    it("should generate a complete summary from both result packet and partial work", async () => {
      const runInfo = createFailedRunInfo();
      const partialWork = createPartialWork();
      const reader = createFakeReader(runInfo, partialWork);
      const writer = createFakeWriter();
      const service = createSummarizationService(
        createDeps({ artifactReader: reader, artifactWriter: writer }),
      );

      const result = await service.generateRetrySummary(createDefaultParams());

      // Summary structure
      expect(result.summary.summary_type).toBe("retry_summary");
      expect(result.summary.schema_version).toBe("1.0");
      expect(result.summary.taskId).toBe("task-100");
      expect(result.summary.failedRunId).toBe("run-42");
      expect(result.summary.attemptNumber).toBe(1);
      expect(result.summary.failedRunStatus).toBe("failed");
      expect(result.summary.generatedAt).toBe("2025-06-15T12:00:00.000Z");

      // Content from result packet
      expect(result.summary.failureSummary).toBe("Build failed due to type errors in auth module");
      expect(result.summary.filesChanged).toHaveLength(2);
      expect(result.summary.validationsRun.length).toBeGreaterThan(0);
      expect(result.summary.failurePoints.length).toBeGreaterThan(0);

      // References
      expect(result.summary.fullResultRef).not.toBeNull();
      expect(result.summary.partialWorkRef).not.toBeNull();
      expect(result.summary.summaryArtifactRef).toContain("retry-summary-run-run-42.json");

      // Size constraint
      expect(result.summary.characterCount).toBeLessThanOrEqual(SUMMARY_CHARACTER_LIMIT);
      expect(result.summary.characterCount).toBeGreaterThan(0);

      // Artifact stored
      expect(writer.storeSummary).toHaveBeenCalledOnce();
      expect(writer.storeSummary).toHaveBeenCalledWith(
        "repo-1",
        "task-100",
        "retry-summary-run-run-42.json",
        expect.any(String),
      );
      expect(result.artifactRef).toContain("summaries/retry-summary-run-run-42.json");
    });

    /**
     * Verifies that when only the DevResultPacket is available (no crash
     * recovery snapshot), the summary still works correctly. This covers
     * the case where a worker failed gracefully (produced a result packet
     * with status="failed") but no crash occurred.
     */
    it("should generate summary from result packet only", async () => {
      const runInfo = createFailedRunInfo();
      const reader = createFakeReader(runInfo, null);
      const writer = createFakeWriter();
      const service = createSummarizationService(
        createDeps({ artifactReader: reader, artifactWriter: writer }),
      );

      const result = await service.generateRetrySummary(createDefaultParams());

      expect(result.summary.failureSummary).toBe("Build failed due to type errors in auth module");
      expect(result.summary.filesChanged).toHaveLength(2);
      expect(result.summary.partialWorkRef).toBeNull();
      expect(result.summary.fullResultRef).not.toBeNull();
      expect(result.summary.characterCount).toBeLessThanOrEqual(SUMMARY_CHARACTER_LIMIT);
    });

    /**
     * Verifies that when only the PartialWorkSnapshot is available (no
     * result packet), the summary falls back to crash recovery data.
     * This covers the case where a worker crashed without producing a
     * result packet at all.
     */
    it("should generate summary from partial work snapshot only", async () => {
      const partialWork = createPartialWork();
      const reader = createFakeReader(null, partialWork);
      const writer = createFakeWriter();
      const service = createSummarizationService(
        createDeps({ artifactReader: reader, artifactWriter: writer }),
      );

      const result = await service.generateRetrySummary(createDefaultParams());

      expect(result.summary.failureSummary).toContain("crashed/timed out");
      expect(result.summary.filesChanged).toHaveLength(3);
      expect(result.summary.failedRunStatus).toBe("unknown");
      expect(result.summary.partialWorkRef).not.toBeNull();
      expect(result.summary.fullResultRef).toBeNull();
      expect(result.summary.characterCount).toBeLessThanOrEqual(SUMMARY_CHARACTER_LIMIT);
    });

    /**
     * Verifies that when no artifacts are available at all (neither result
     * packet nor crash snapshot), the summary still produces a usable
     * output with default messaging. This supports the best-effort model
     * where the summarization never fails, just degrades.
     */
    it("should generate minimal summary when no artifacts available", async () => {
      const reader = createFakeReader(null, null);
      const writer = createFakeWriter();
      const service = createSummarizationService(
        createDeps({ artifactReader: reader, artifactWriter: writer }),
      );

      const result = await service.generateRetrySummary(createDefaultParams());

      expect(result.summary.failedRunStatus).toBe("unknown");
      expect(result.summary.filesChanged).toEqual([]);
      expect(result.summary.validationsRun).toEqual([]);
      expect(result.summary.failurePoints).toHaveLength(1);
      expect(result.summary.failurePoints[0]).toContain("No detailed failure information");
      expect(result.summary.fullResultRef).toBeNull();
      expect(result.summary.partialWorkRef).toBeNull();
      expect(result.summary.characterCount).toBeLessThanOrEqual(SUMMARY_CHARACTER_LIMIT);

      // Still stored as artifact
      expect(writer.storeSummary).toHaveBeenCalledOnce();
    });

    /**
     * Verifies that artifact read failures are handled gracefully.
     * The reader may throw if the artifact store is corrupted or
     * inaccessible — the service should degrade to a minimal summary
     * rather than propagating the error.
     */
    it("should handle artifact reader failures gracefully", async () => {
      const reader: SummarizationArtifactReaderPort = {
        readFailedRunInfo: vi.fn().mockRejectedValue(new Error("Storage corrupted")),
        readPartialWorkSnapshot: vi.fn().mockRejectedValue(new Error("Storage corrupted")),
      };
      const writer = createFakeWriter();
      const service = createSummarizationService(
        createDeps({ artifactReader: reader, artifactWriter: writer }),
      );

      const result = await service.generateRetrySummary(createDefaultParams());

      // Should still produce a summary (degraded)
      expect(result.summary.summary_type).toBe("retry_summary");
      expect(result.summary.failedRunStatus).toBe("unknown");
      expect(result.summary.characterCount).toBeLessThanOrEqual(SUMMARY_CHARACTER_LIMIT);
    });

    /**
     * Verifies that the generated summary can be parsed back as valid JSON
     * and that the stored artifact matches the returned summary. This
     * ensures round-trip compatibility with TaskPacket deserialization.
     */
    it("should store valid JSON that round-trips correctly", async () => {
      const runInfo = createFailedRunInfo();
      const reader = createFakeReader(runInfo, null);
      const writer = createFakeWriter();
      const service = createSummarizationService(
        createDeps({ artifactReader: reader, artifactWriter: writer }),
      );

      await service.generateRetrySummary(createDefaultParams());

      const storedContent = (writer.storeSummary as ReturnType<typeof vi.fn>).mock
        .calls[0]![3] as string;
      const parsed = JSON.parse(storedContent) as RetrySummary;

      expect(parsed.summary_type).toBe("retry_summary");
      expect(parsed.schema_version).toBe("1.0");
      expect(parsed.taskId).toBe("task-100");
      expect(parsed.failedRunId).toBe("run-42");
    });

    /**
     * Verifies that the attempt number from the params is correctly
     * reflected in the summary, important for tracking retry progression.
     */
    it("should include correct attempt number", async () => {
      const reader = createFakeReader(createFailedRunInfo(), null);
      const writer = createFakeWriter();
      const service = createSummarizationService(
        createDeps({ artifactReader: reader, artifactWriter: writer }),
      );

      const result = await service.generateRetrySummary(createDefaultParams({ attemptNumber: 3 }));

      expect(result.summary.attemptNumber).toBe(3);
    });

    /**
     * Verifies that the artifact reader is called with correct parameters,
     * ensuring proper path-based artifact lookup.
     */
    it("should pass correct IDs to artifact reader", async () => {
      const reader = createFakeReader(null, null);
      const writer = createFakeWriter();
      const service = createSummarizationService(
        createDeps({ artifactReader: reader, artifactWriter: writer }),
      );

      await service.generateRetrySummary(
        createDefaultParams({ repoId: "repo-X", taskId: "task-Y", failedRunId: "run-Z" }),
      );

      expect(reader.readFailedRunInfo).toHaveBeenCalledWith("repo-X", "task-Y", "run-Z");
      expect(reader.readPartialWorkSnapshot).toHaveBeenCalledWith("repo-X", "task-Y", "run-Z");
    });

    /**
     * Verifies that the serialized summary stored as an artifact never
     * exceeds the character limit, even with maximum-size input data.
     * This is a critical invariant: retry workers depend on bounded context.
     */
    it("should never exceed character limit even with large input", async () => {
      const largeRunInfo = createFailedRunInfo({
        filesChanged: Array.from({ length: 50 }, (_, i) => ({
          path: `src/very/deeply/nested/module/submodule/component/file-${String(i)}.ts`,
          changeType: "modified",
        })),
        validationsRun: Array.from({ length: 20 }, (_, i) => ({
          checkType: `check-${String(i)}`,
          status: "failed",
          summary: `Extremely detailed validation failure explanation for check ${String(i)} that goes on and on with specific details about what went wrong`,
        })),
        unresolvedIssues: Array.from(
          { length: 20 },
          (_, i) =>
            `Unresolved issue ${String(i)}: A very detailed description of the problem that needs to be fixed before this can pass`,
        ),
        risks: Array.from(
          { length: 10 },
          (_, i) => `Risk ${String(i)}: Detailed risk description with mitigation strategy`,
        ),
        resultSummary: "A very long result summary: " + "x".repeat(300),
      });
      const reader = createFakeReader(largeRunInfo, createPartialWork());
      const writer = createFakeWriter();
      const service = createSummarizationService(
        createDeps({ artifactReader: reader, artifactWriter: writer }),
      );

      const result = await service.generateRetrySummary(createDefaultParams());

      expect(result.summary.characterCount).toBeLessThanOrEqual(SUMMARY_CHARACTER_LIMIT);

      // Verify the stored content also fits
      const storedContent = (writer.storeSummary as ReturnType<typeof vi.fn>).mock
        .calls[0]![3] as string;
      expect(storedContent.length).toBeLessThanOrEqual(SUMMARY_CHARACTER_LIMIT);
    });
  });
});
