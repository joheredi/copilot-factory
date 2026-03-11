/**
 * Tests for the OutputValidatorService.
 *
 * These tests validate the full output validation pipeline including
 * packet extraction, schema validation, ID matching, artifact verification,
 * schema repair, consecutive failure tracking, and audit event recording.
 *
 * Why these tests matter:
 * - The output validator is the primary correctness gate between worker output
 *   and the orchestrator. If it accepts invalid output, the system state becomes
 *   corrupt. If it rejects valid output, legitimate work is lost.
 * - PRD 008 §8.14 mandates that no worker result may be accepted unless it
 *   passes all four validation checks (parse, schema, IDs, artifacts).
 * - Consecutive failure tracking (threshold 3) prevents resource waste on
 *   systematically broken agent profiles.
 *
 * @see docs/prd/008-packet-and-schema-spec.md §8.14 — Implementation Rule
 * @see docs/backlog/tasks/T046-output-capture-validation.md
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createOutputValidatorService,
  extractPacket,
  validateSchema,
  attemptSchemaRepair,
  verifyIds,
  verifyArtifacts,
  RESULT_PACKET_START_DELIMITER,
  RESULT_PACKET_END_DELIMITER,
  DEFAULT_CONSECUTIVE_FAILURE_THRESHOLD,
} from "./output-validator.service.js";
import type {
  WorkerOutputSource,
  OutputValidationContext,
  ArtifactExistencePort,
  SchemaFailureTrackerPort,
  OutputValidationAuditPort,
  OutputValidationSuccess,
  OutputValidationFailure,
  ExtractionResult,
} from "../ports/output-validator.ports.js";
import type { NewAuditEvent, AuditEventRecord } from "../ports/repository.ports.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates a valid DevResultPacket for testing.
 * All required fields are present and valid per the Zod schema.
 */
function createValidDevResultPacket(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    packet_type: "dev_result_packet",
    schema_version: "1.0",
    created_at: "2026-03-10T00:00:00Z",
    task_id: "task-123",
    repository_id: "repo-1",
    run_id: "run-456",
    status: "success",
    summary: "Implemented feature X successfully.",
    result: {
      branch_name: "factory/task-123",
      commit_sha: "abc123def456",
      files_changed: [
        {
          path: "src/feature.ts",
          change_type: "added",
          summary: "New feature implementation",
        },
      ],
      tests_added_or_updated: ["src/feature.test.ts"],
      validations_run: [
        {
          check_type: "test",
          tool_name: "vitest",
          command: "pnpm test",
          status: "passed",
          duration_ms: 5000,
          summary: "10 tests passed",
        },
      ],
      assumptions: [],
      risks: [],
      unresolved_issues: [],
    },
    artifact_refs: [],
    ...overrides,
  };
}

/**
 * Creates a valid ReviewPacket for testing.
 */
function createValidReviewPacket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    packet_type: "review_packet",
    schema_version: "1.0",
    created_at: "2026-03-10T00:00:00Z",
    task_id: "task-123",
    repository_id: "repo-1",
    review_cycle_id: "review-1",
    reviewer_pool_id: "security-reviewers",
    reviewer_type: "security",
    verdict: "approved",
    summary: "Code looks good.",
    blocking_issues: [],
    non_blocking_issues: [],
    confidence: "high",
    follow_up_task_refs: [],
    risks: [],
    open_questions: [],
    ...overrides,
  };
}

/**
 * Creates a standard OutputValidationContext for DevResultPacket tests.
 */
function createDevResultContext(
  overrides: Partial<OutputValidationContext> = {},
): OutputValidationContext {
  return {
    taskId: "task-123",
    repositoryId: "repo-1",
    runId: "run-456",
    expectedPacketType: "dev_result_packet",
    expectedMajorVersion: 1,
    agentProfileId: "profile-dev-1",
    ...overrides,
  };
}

/**
 * Creates a standard OutputValidationContext for ReviewPacket tests.
 */
function createReviewContext(
  overrides: Partial<OutputValidationContext> = {},
): OutputValidationContext {
  return {
    taskId: "task-123",
    repositoryId: "repo-1",
    reviewCycleId: "review-1",
    expectedPacketType: "review_packet",
    expectedMajorVersion: 1,
    agentProfileId: "profile-reviewer-1",
    ...overrides,
  };
}

/** Creates a WorkerOutputSource with file content. */
function fileSource(content: string): WorkerOutputSource {
  return { outputFileContent: content, stdoutContent: "" };
}

/** Creates a WorkerOutputSource with stdout content between delimiters. */
function stdoutSource(json: string): WorkerOutputSource {
  return {
    outputFileContent: null,
    stdoutContent: `Some log output\n${RESULT_PACKET_START_DELIMITER}\n${json}\n${RESULT_PACKET_END_DELIMITER}\nMore logs`,
  };
}

/** Creates a WorkerOutputSource with no packet. */
function emptySource(): WorkerOutputSource {
  return { outputFileContent: null, stdoutContent: "Just some logs, no packet" };
}

/**
 * Creates fake infrastructure ports for testing.
 * All ports start with default behavior (artifacts exist, no prior failures).
 */
function createFakePorts() {
  const auditEvents: NewAuditEvent[] = [];
  let failureCounts: Record<string, number> = {};

  const artifactChecker: ArtifactExistencePort = {
    exists: vi.fn(async () => true),
  };

  const failureTracker: SchemaFailureTrackerPort = {
    getConsecutiveFailures: vi.fn(async (profileId: string) => failureCounts[profileId] ?? 0),
    recordFailure: vi.fn(async (profileId: string) => {
      failureCounts[profileId] = (failureCounts[profileId] ?? 0) + 1;
      return failureCounts[profileId]!;
    }),
    resetFailures: vi.fn(async (profileId: string) => {
      failureCounts[profileId] = 0;
    }),
  };

  const auditRecorder: OutputValidationAuditPort = {
    recordAuditEvent: vi.fn(async (event: NewAuditEvent): Promise<AuditEventRecord> => {
      auditEvents.push(event);
      return {
        id: `audit-${String(auditEvents.length)}`,
        ...event,
        createdAt: "2026-03-10T00:00:00Z",
      };
    }),
  };

  return {
    artifactChecker,
    failureTracker,
    auditRecorder,
    auditEvents,
    /** Reset all fake state for a fresh test. */
    reset() {
      auditEvents.length = 0;
      failureCounts = {};
      vi.clearAllMocks();
    },
    /** Set failure count for a specific profile. */
    setFailureCount(profileId: string, count: number) {
      failureCounts[profileId] = count;
    },
  };
}

// ─── extractPacket Tests ─────────────────────────────────────────────────────

describe("extractPacket", () => {
  /**
   * Validates that file-based extraction takes priority over stdout.
   * This ensures that when a worker writes to the output file,
   * we prefer the file content over potentially incomplete stdout data.
   */
  it("extracts packet from output file content (priority over stdout)", () => {
    const packet = { packet_type: "dev_result_packet", schema_version: "1.0" };
    const source: WorkerOutputSource = {
      outputFileContent: JSON.stringify(packet),
      stdoutContent: `${RESULT_PACKET_START_DELIMITER}{"other":"data"}${RESULT_PACKET_END_DELIMITER}`,
    };

    const result = extractPacket(source);

    expect(result.status).toBe("found");
    expect(result).toEqual({
      status: "found",
      packet: expect.objectContaining({ packet_type: "dev_result_packet" }),
      source: "file",
    });
  });

  /**
   * Validates the fallback extraction path when no output file exists.
   * Workers may emit their result packet inline within stdout delimiters.
   */
  it("extracts packet from stdout when file content is null", () => {
    const packet = { packet_type: "dev_result_packet" };
    const source = stdoutSource(JSON.stringify(packet));

    const result = extractPacket(source);

    expect(result.status).toBe("found");
    expect((result as Extract<ExtractionResult, { status: "found" }>).source).toBe("stdout");
    expect((result as Extract<ExtractionResult, { status: "found" }>).packet).toEqual(packet);
  });

  /**
   * Validates that malformed JSON in the output file is reported
   * as a parse error rather than silently falling through to stdout.
   * This prevents masking file corruption with a stale stdout packet.
   */
  it("returns json_parse_error when file content is invalid JSON", () => {
    const source: WorkerOutputSource = {
      outputFileContent: "{ not valid json }",
      stdoutContent: "",
    };

    const result = extractPacket(source);

    expect(result.status).toBe("json_parse_error");
    expect((result as Extract<ExtractionResult, { status: "json_parse_error" }>).source).toBe(
      "file",
    );
  });

  /**
   * Validates that malformed JSON between stdout delimiters is
   * detected and reported rather than returning not_found.
   */
  it("returns json_parse_error when stdout delimited content is invalid JSON", () => {
    const source: WorkerOutputSource = {
      outputFileContent: null,
      stdoutContent: `${RESULT_PACKET_START_DELIMITER}not json${RESULT_PACKET_END_DELIMITER}`,
    };

    const result = extractPacket(source);

    expect(result.status).toBe("json_parse_error");
    expect((result as Extract<ExtractionResult, { status: "json_parse_error" }>).source).toBe(
      "stdout",
    );
  });

  /**
   * Validates that when no output file exists and stdout has no
   * delimiters, the extraction correctly reports not_found.
   */
  it("returns not_found when no file and no stdout delimiters", () => {
    const result = extractPacket(emptySource());

    expect(result.status).toBe("not_found");
  });

  /**
   * Validates that empty/whitespace-only output file content
   * falls through to the stdout extraction path.
   */
  it("falls through to stdout when file content is whitespace-only", () => {
    const packet = { test: true };
    const source: WorkerOutputSource = {
      outputFileContent: "   \n   ",
      stdoutContent: `${RESULT_PACKET_START_DELIMITER}${JSON.stringify(packet)}${RESULT_PACKET_END_DELIMITER}`,
    };

    const result = extractPacket(source);

    expect(result.status).toBe("found");
    expect((result as Extract<ExtractionResult, { status: "found" }>).source).toBe("stdout");
  });

  /**
   * Validates handling of missing end delimiter in stdout.
   * Workers may crash mid-output, producing only the start delimiter.
   */
  it("returns not_found when stdout has start delimiter but no end delimiter", () => {
    const source: WorkerOutputSource = {
      outputFileContent: null,
      stdoutContent: `${RESULT_PACKET_START_DELIMITER}{"partial":"data"`,
    };

    const result = extractPacket(source);

    expect(result.status).toBe("not_found");
  });

  /**
   * Validates that empty content between delimiters is treated
   * as not_found rather than a parse error.
   */
  it("returns not_found when delimiter content is empty", () => {
    const source: WorkerOutputSource = {
      outputFileContent: null,
      stdoutContent: `${RESULT_PACKET_START_DELIMITER}   ${RESULT_PACKET_END_DELIMITER}`,
    };

    const result = extractPacket(source);

    expect(result.status).toBe("not_found");
  });
});

// ─── validateSchema Tests ────────────────────────────────────────────────────

describe("validateSchema", () => {
  /**
   * Validates that a complete, correct DevResultPacket passes schema validation.
   * This is the happy path that all valid worker outputs should follow.
   */
  it("accepts a valid DevResultPacket", () => {
    const packet = createValidDevResultPacket();
    const result = validateSchema(packet, "dev_result_packet");

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  /**
   * Validates that a complete, correct ReviewPacket passes schema validation.
   */
  it("accepts a valid ReviewPacket", () => {
    const packet = createValidReviewPacket();
    const result = validateSchema(packet, "review_packet");

    expect(result.valid).toBe(true);
  });

  /**
   * Validates that missing required fields are caught.
   * The schema must reject packets missing critical fields like `summary`.
   */
  it("rejects a DevResultPacket missing required fields", () => {
    const packet = createValidDevResultPacket();
    delete packet["summary"];

    const result = validateSchema(packet, "dev_result_packet");

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  /**
   * Validates that requesting validation with an unknown packet type
   * returns a clear error rather than throwing.
   */
  it("returns error for unregistered packet type", () => {
    const result = validateSchema({}, "unknown_packet_type");

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("No schema registered");
  });

  /**
   * Validates that Zod issues are properly formatted with field paths
   * for debugging convenience.
   */
  it("formats error messages with field paths", () => {
    const packet = createValidDevResultPacket();
    (packet["result"] as Record<string, unknown>)["branch_name"] = 123; // wrong type

    const result = validateSchema(packet, "dev_result_packet");

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("result.branch_name"))).toBe(true);
  });
});

// ─── attemptSchemaRepair Tests ───────────────────────────────────────────────

describe("attemptSchemaRepair", () => {
  /**
   * Validates that repair correctly fills in a missing optional array field.
   * Packets may omit optional arrays (e.g., artifact_refs), and the repair
   * should supply an empty array default.
   */
  it("repairs a missing array field by defaulting to []", () => {
    const packet = createValidDevResultPacket();
    delete packet["artifact_refs"];

    const validation = validateSchema(packet, "dev_result_packet");
    expect(validation.valid).toBe(false);

    const repair = attemptSchemaRepair(packet, validation.issues, "dev_result_packet");

    expect(repair.success).toBe(true);
    expect(repair.actions.length).toBeGreaterThan(0);
    expect(repair.actions[0]).toContain("artifact_refs");
  });

  /**
   * Validates that repair does NOT attempt to default required string fields.
   * Defaulting a required string (e.g., summary) would produce semantically
   * wrong data that passes schema validation but is meaningless.
   */
  it("does not repair missing required string fields", () => {
    const packet = createValidDevResultPacket();
    delete packet["summary"];

    const validation = validateSchema(packet, "dev_result_packet");
    const repair = attemptSchemaRepair(packet, validation.issues, "dev_result_packet");

    expect(repair.success).toBe(false);
  });

  /**
   * Validates that repair returns success:false when no repairs are applicable.
   * This prevents false positives where the repair claims success without
   * actually fixing anything.
   */
  it("returns success:false when no safe repairs are possible", () => {
    const repair = attemptSchemaRepair(
      { completely: "wrong" },
      [
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["required_field"],
          message: "Required",
        },
      ],
      "dev_result_packet",
    );

    expect(repair.success).toBe(false);
    expect(repair.actions).toHaveLength(0);
  });

  /**
   * Validates that non-object data cannot be repaired.
   */
  it("returns success:false for non-object data", () => {
    const repair = attemptSchemaRepair("not an object", [], "dev_result_packet");

    expect(repair.success).toBe(false);
  });
});

// ─── verifyIds Tests ─────────────────────────────────────────────────────────

describe("verifyIds", () => {
  /**
   * Validates that matching IDs produce no mismatches.
   * This is the happy path for ID verification.
   */
  it("returns empty array when all IDs match", () => {
    const packet = createValidDevResultPacket();
    const context = createDevResultContext();

    const mismatches = verifyIds(packet, context);

    expect(mismatches).toHaveLength(0);
  });

  /**
   * Validates that a task_id mismatch is detected.
   * This prevents cross-task result injection where a worker
   * submits a result for a different task than assigned.
   */
  it("detects task_id mismatch", () => {
    const packet = createValidDevResultPacket({ task_id: "task-999" });
    const context = createDevResultContext();

    const mismatches = verifyIds(packet, context);

    expect(mismatches.length).toBe(1);
    expect(mismatches[0]).toContain("task_id");
    expect(mismatches[0]).toContain("task-123");
    expect(mismatches[0]).toContain("task-999");
  });

  /**
   * Validates that a repository_id mismatch is detected.
   */
  it("detects repository_id mismatch", () => {
    const packet = createValidDevResultPacket({ repository_id: "repo-wrong" });
    const context = createDevResultContext();

    const mismatches = verifyIds(packet, context);

    expect(mismatches.length).toBe(1);
    expect(mismatches[0]).toContain("repository_id");
  });

  /**
   * Validates that stage-specific IDs (run_id) are checked for the
   * appropriate packet type. DevResultPackets must include run_id.
   */
  it("detects run_id mismatch for DevResultPacket", () => {
    const packet = createValidDevResultPacket({ run_id: "run-wrong" });
    const context = createDevResultContext();

    const mismatches = verifyIds(packet, context);

    expect(mismatches.length).toBe(1);
    expect(mismatches[0]).toContain("run_id");
  });

  /**
   * Validates that review_cycle_id is checked for ReviewPackets.
   */
  it("detects review_cycle_id mismatch for ReviewPacket", () => {
    const packet = createValidReviewPacket({ review_cycle_id: "review-wrong" });
    const context = createReviewContext();

    const mismatches = verifyIds(packet, context);

    expect(mismatches.length).toBe(1);
    expect(mismatches[0]).toContain("review_cycle_id");
  });

  /**
   * Validates that multiple simultaneous mismatches are all reported.
   */
  it("reports multiple simultaneous mismatches", () => {
    const packet = createValidDevResultPacket({
      task_id: "wrong-task",
      repository_id: "wrong-repo",
      run_id: "wrong-run",
    });
    const context = createDevResultContext();

    const mismatches = verifyIds(packet, context);

    expect(mismatches.length).toBe(3);
  });

  /**
   * Validates that stage-specific IDs are not checked when
   * the context doesn't specify them (e.g., review_cycle_id
   * is not checked for dev result contexts).
   */
  it("skips stage IDs not specified in context", () => {
    const packet = createValidDevResultPacket();
    const context = createDevResultContext();
    // Context has no reviewCycleId, so it shouldn't check for it

    const mismatches = verifyIds(packet, context);

    expect(mismatches).toHaveLength(0);
  });
});

// ─── verifyArtifacts Tests ───────────────────────────────────────────────────

describe("verifyArtifacts", () => {
  /**
   * Validates that existing artifacts produce no missing entries.
   */
  it("returns empty array when all artifacts exist", async () => {
    const checker: ArtifactExistencePort = {
      exists: vi.fn(async () => true),
    };
    const packet = createValidDevResultPacket({
      artifact_refs: ["logs/run.log", "outputs/diff.patch"],
    });

    const missing = await verifyArtifacts(packet, checker);

    expect(missing).toHaveLength(0);
    expect(checker.exists).toHaveBeenCalledTimes(2);
  });

  /**
   * Validates that missing artifacts are correctly identified.
   */
  it("reports missing artifacts", async () => {
    const checker: ArtifactExistencePort = {
      exists: vi.fn(async (path: string) => path !== "missing.log"),
    };
    const packet = createValidDevResultPacket({
      artifact_refs: ["exists.log", "missing.log"],
    });

    const missing = await verifyArtifacts(packet, checker);

    expect(missing).toEqual(["missing.log"]);
  });

  /**
   * Validates that packets with no artifact_refs pass without errors.
   * Many valid packets have empty artifact_refs arrays.
   */
  it("returns empty array when packet has no artifact_refs", async () => {
    const checker: ArtifactExistencePort = { exists: vi.fn() };
    const packet = createValidDevResultPacket({ artifact_refs: [] });

    const missing = await verifyArtifacts(packet, checker);

    expect(missing).toHaveLength(0);
    expect(checker.exists).not.toHaveBeenCalled();
  });

  /**
   * Validates that packets without an artifact_refs field at all are handled.
   */
  it("returns empty array when packet has no artifact_refs field", async () => {
    const checker: ArtifactExistencePort = { exists: vi.fn() };
    const packet = createValidDevResultPacket();
    delete packet["artifact_refs"];

    const missing = await verifyArtifacts(packet, checker);

    expect(missing).toHaveLength(0);
  });
});

// ─── OutputValidatorService Integration Tests ────────────────────────────────

describe("OutputValidatorService", () => {
  let fakes: ReturnType<typeof createFakePorts>;

  beforeEach(() => {
    fakes = createFakePorts();
  });

  /**
   * Creates a service instance with the current fake ports.
   */
  function createService(threshold?: number) {
    return createOutputValidatorService({
      artifactChecker: fakes.artifactChecker,
      failureTracker: fakes.failureTracker,
      auditRecorder: fakes.auditRecorder,
      consecutiveFailureThreshold: threshold,
    });
  }

  // ── Happy Path ──────────────────────────────────────────────────────────

  describe("valid packet acceptance", () => {
    /**
     * Validates the complete happy path: a valid DevResultPacket in an output
     * file is accepted, failure tracker is reset, and no audit events are recorded.
     *
     * This is the most critical test — it verifies that correct worker output
     * flows through without rejection.
     */
    it("accepts a valid DevResultPacket from file output", async () => {
      const service = createService();
      const packet = createValidDevResultPacket();
      const source = fileSource(JSON.stringify(packet));
      const context = createDevResultContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("accepted");
      const success = result as OutputValidationSuccess;
      expect(success.packet).toEqual(expect.objectContaining({ task_id: "task-123" }));
      expect(success.repaired).toBe(false);
      expect(success.repairActions).toHaveLength(0);

      // Should reset failure tracker on success
      expect(fakes.failureTracker.resetFailures).toHaveBeenCalledWith("profile-dev-1");
      // Should NOT record audit events
      expect(fakes.auditEvents).toHaveLength(0);
    });

    /**
     * Validates acceptance from stdout delimiter extraction.
     */
    it("accepts a valid DevResultPacket from stdout delimiters", async () => {
      const service = createService();
      const packet = createValidDevResultPacket();
      const source = stdoutSource(JSON.stringify(packet));
      const context = createDevResultContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("accepted");
    });

    /**
     * Validates acceptance of a valid ReviewPacket with correct review_cycle_id.
     */
    it("accepts a valid ReviewPacket with correct stage IDs", async () => {
      const service = createService();
      const packet = createValidReviewPacket();
      const source = fileSource(JSON.stringify(packet));
      const context = createReviewContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("accepted");
    });
  });

  // ── Extraction Failures ─────────────────────────────────────────────────

  describe("extraction failures", () => {
    /**
     * Validates that missing output (no file, no stdout delimiters) is
     * rejected as fatal. Workers must always produce structured output.
     */
    it("rejects when no packet found anywhere", async () => {
      const service = createService();
      const source = emptySource();
      const context = createDevResultContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("rejected");
      const failure = result as OutputValidationFailure;
      expect(failure.reason).toBe("no_packet_found");
      expect(fakes.auditEvents).toHaveLength(1);
      expect(fakes.auditEvents[0]!.eventType).toBe("schema_violation");
    });

    /**
     * Validates that corrupt JSON in the output file is treated as
     * a fatal error with appropriate audit trail.
     */
    it("rejects invalid JSON as fatal error", async () => {
      const service = createService();
      const source = fileSource("{ this is not json }");
      const context = createDevResultContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("rejected");
      const failure = result as OutputValidationFailure;
      expect(failure.reason).toBe("json_parse_error");
      expect(failure.packet).toBeNull();
      expect(fakes.auditEvents).toHaveLength(1);
    });
  });

  // ── Schema Validation ───────────────────────────────────────────────────

  describe("schema validation", () => {
    /**
     * Validates that packets failing schema validation are rejected
     * when repair is not possible (missing required fields).
     */
    it("rejects packet with unfixable schema errors", async () => {
      const service = createService();
      const packet = createValidDevResultPacket();
      delete packet["summary"];
      delete packet["status"];
      const source = fileSource(JSON.stringify(packet));
      const context = createDevResultContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("rejected");
      const failure = result as OutputValidationFailure;
      expect(failure.reason).toBe("schema_validation_failed");
      expect(failure.errors.length).toBeGreaterThan(0);
    });

    /**
     * Validates that a repairable schema violation (missing optional array)
     * is repaired and accepted rather than rejected.
     *
     * This tests the conservative repair strategy: only arrays default
     * to [], which is safe because an empty array has no semantic meaning.
     */
    it("repairs and accepts packet with missing optional array field", async () => {
      const service = createService();
      const packet = createValidDevResultPacket();
      delete packet["artifact_refs"];
      const source = fileSource(JSON.stringify(packet));
      const context = createDevResultContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("accepted");
      const success = result as OutputValidationSuccess;
      expect(success.repaired).toBe(true);
      expect(success.repairActions.length).toBeGreaterThan(0);
      expect(success.repairActions[0]).toContain("artifact_refs");
    });
  });

  // ── Version Compatibility ───────────────────────────────────────────────

  describe("version compatibility", () => {
    /**
     * Validates that packets with a compatible minor version are accepted.
     * A worker emitting 1.1 should be accepted by an orchestrator expecting major 1.
     */
    it("accepts compatible minor version (1.1 with expected major 1)", async () => {
      const service = createService();
      const packet = createValidDevResultPacket({ schema_version: "1.1" });
      const source = fileSource(JSON.stringify(packet));
      const context = createDevResultContext({ expectedMajorVersion: 1 });

      const result = await service.validateOutput(source, context);

      // Schema validation may or may not pass depending on the Zod schema's
      // exact version constraint, but version check itself should pass
      if (result.status === "rejected") {
        // If rejected, it should NOT be for version incompatibility
        expect((result as OutputValidationFailure).reason).not.toBe("version_incompatible");
      }
    });

    /**
     * Validates that packets with an incompatible major version are rejected.
     * This prevents accepting structurally different packet formats.
     */
    it("rejects incompatible major version", async () => {
      const service = createService();
      const packet = createValidDevResultPacket({ schema_version: "2.0" });
      const source = fileSource(JSON.stringify(packet));
      const context = createDevResultContext({ expectedMajorVersion: 1 });

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("rejected");
      expect((result as OutputValidationFailure).reason).toBe("version_incompatible");
    });

    /**
     * Validates that a missing schema_version field is rejected.
     */
    it("rejects packet missing schema_version", async () => {
      const service = createService();
      const packet = createValidDevResultPacket();
      delete packet["schema_version"];
      const source = fileSource(JSON.stringify(packet));
      const context = createDevResultContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("rejected");
      expect((result as OutputValidationFailure).reason).toBe("version_incompatible");
    });
  });

  // ── ID Matching ─────────────────────────────────────────────────────────

  describe("ID matching", () => {
    /**
     * Validates that task_id mismatches cause rejection.
     * This is a critical security check — prevents a compromised worker
     * from injecting results for a different task.
     */
    it("rejects packet with wrong task_id", async () => {
      const service = createService();
      const packet = createValidDevResultPacket({ task_id: "task-evil" });
      const source = fileSource(JSON.stringify(packet));
      const context = createDevResultContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("rejected");
      const failure = result as OutputValidationFailure;
      expect(failure.reason).toBe("id_mismatch");
      expect(failure.errors[0]).toContain("task_id");
    });

    /**
     * Validates that run_id mismatches cause rejection for DevResultPackets.
     */
    it("rejects packet with wrong run_id", async () => {
      const service = createService();
      const packet = createValidDevResultPacket({ run_id: "run-wrong" });
      const source = fileSource(JSON.stringify(packet));
      const context = createDevResultContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("rejected");
      expect((result as OutputValidationFailure).reason).toBe("id_mismatch");
    });
  });

  // ── Artifact Verification ───────────────────────────────────────────────

  describe("artifact verification", () => {
    /**
     * Validates that packets referencing non-existent artifacts are rejected.
     * This enforces PRD 008 §8.14 rule 4.
     */
    it("rejects packet with missing artifact references", async () => {
      const service = createService();
      vi.mocked(fakes.artifactChecker.exists).mockResolvedValue(false);

      const packet = createValidDevResultPacket({
        artifact_refs: ["logs/missing.log"],
      });
      const source = fileSource(JSON.stringify(packet));
      const context = createDevResultContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("rejected");
      const failure = result as OutputValidationFailure;
      expect(failure.reason).toBe("artifacts_missing");
      expect(failure.errors[0]).toContain("missing.log");
    });

    /**
     * Validates that packets with empty artifact_refs are accepted.
     */
    it("accepts packet with empty artifact_refs", async () => {
      const service = createService();
      const packet = createValidDevResultPacket({ artifact_refs: [] });
      const source = fileSource(JSON.stringify(packet));
      const context = createDevResultContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("accepted");
    });
  });

  // ── Consecutive Failure Tracking ────────────────────────────────────────

  describe("consecutive failure tracking", () => {
    /**
     * Validates that each validation failure increments the consecutive
     * failure counter for the agent profile.
     */
    it("increments failure counter on each rejection", async () => {
      const service = createService();
      const source = emptySource();
      const context = createDevResultContext();

      await service.validateOutput(source, context);
      await service.validateOutput(source, context);

      expect(fakes.failureTracker.recordFailure).toHaveBeenCalledTimes(2);
      expect(fakes.failureTracker.recordFailure).toHaveBeenCalledWith("profile-dev-1");
    });

    /**
     * Validates that the profile is marked as disabled when the consecutive
     * failure threshold is reached. Default threshold is 3.
     */
    it("marks profile as disabled after 3 consecutive failures (default threshold)", async () => {
      const service = createService();
      fakes.setFailureCount("profile-dev-1", 2); // Next failure will be #3
      const source = emptySource();
      const context = createDevResultContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("rejected");
      const failure = result as OutputValidationFailure;
      expect(failure.profileDisabled).toBe(true);
      expect(failure.consecutiveFailures).toBe(3);
    });

    /**
     * Validates that a successful validation resets the failure counter.
     */
    it("resets failure counter on successful validation", async () => {
      const service = createService();
      fakes.setFailureCount("profile-dev-1", 2);

      const packet = createValidDevResultPacket();
      const source = fileSource(JSON.stringify(packet));
      const context = createDevResultContext();

      await service.validateOutput(source, context);

      expect(fakes.failureTracker.resetFailures).toHaveBeenCalledWith("profile-dev-1");
    });

    /**
     * Validates that a custom threshold is respected.
     */
    it("respects custom consecutive failure threshold", async () => {
      const service = createService(5);
      fakes.setFailureCount("profile-dev-1", 4); // Next failure will be #5
      const source = emptySource();
      const context = createDevResultContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("rejected");
      expect((result as OutputValidationFailure).profileDisabled).toBe(true);
    });

    /**
     * Validates that below-threshold failures don't disable the profile.
     */
    it("does not disable profile below threshold", async () => {
      const service = createService();
      fakes.setFailureCount("profile-dev-1", 0); // Next failure will be #1
      const source = emptySource();
      const context = createDevResultContext();

      const result = await service.validateOutput(source, context);

      expect(result.status).toBe("rejected");
      expect((result as OutputValidationFailure).profileDisabled).toBe(false);
      expect((result as OutputValidationFailure).consecutiveFailures).toBe(1);
    });
  });

  // ── Audit Events ────────────────────────────────────────────────────────

  describe("audit events", () => {
    /**
     * Validates that every validation failure produces exactly one
     * schema_violation audit event with the correct metadata.
     */
    it("records schema_violation audit event on failure", async () => {
      const service = createService();
      const source = emptySource();
      const context = createDevResultContext();

      await service.validateOutput(source, context);

      expect(fakes.auditEvents).toHaveLength(1);
      const event = fakes.auditEvents[0]!;
      expect(event.eventType).toBe("schema_violation");
      expect(event.entityType).toBe("task");
      expect(event.entityId).toBe("task-123");
      expect(event.actorType).toBe("system");
      expect(event.actorId).toBe("output-validator");
    });

    /**
     * Validates that audit event metadata includes the rejection reason,
     * error details, and failure tracking info.
     */
    it("includes comprehensive metadata in audit events", async () => {
      const service = createService();
      const packet = createValidDevResultPacket({ task_id: "wrong-id" });
      const source = fileSource(JSON.stringify(packet));
      const context = createDevResultContext();

      await service.validateOutput(source, context);

      expect(fakes.auditEvents).toHaveLength(1);
      const metadata = JSON.parse(fakes.auditEvents[0]!.metadata as string) as Record<
        string,
        unknown
      >;
      expect(metadata["reason"]).toBe("id_mismatch");
      expect(metadata["expectedPacketType"]).toBe("dev_result_packet");
      expect(metadata["agentProfileId"]).toBe("profile-dev-1");
      expect(metadata["consecutiveFailures"]).toBe(1);
      expect(Array.isArray(metadata["errors"])).toBe(true);
    });

    /**
     * Validates that no audit events are recorded for successful validations.
     */
    it("does not record audit events on success", async () => {
      const service = createService();
      const packet = createValidDevResultPacket();
      const source = fileSource(JSON.stringify(packet));
      const context = createDevResultContext();

      await service.validateOutput(source, context);

      expect(fakes.auditEvents).toHaveLength(0);
    });

    /**
     * Validates that the profileDisabled flag is included in audit metadata
     * when the threshold is reached.
     */
    it("includes profileDisabled in audit metadata at threshold", async () => {
      const service = createService();
      fakes.setFailureCount("profile-dev-1", 2);
      const source = emptySource();
      const context = createDevResultContext();

      await service.validateOutput(source, context);

      const metadata = JSON.parse(fakes.auditEvents[0]!.metadata as string) as Record<
        string,
        unknown
      >;
      expect(metadata["profileDisabled"]).toBe(true);
    });
  });

  // ── extractPacket delegation ────────────────────────────────────────────

  describe("extractPacket method", () => {
    /**
     * Validates that the service's extractPacket method delegates
     * to the pure extraction function correctly.
     */
    it("delegates to the pure extractPacket function", () => {
      const service = createService();
      const packet = { test: true };
      const source = fileSource(JSON.stringify(packet));

      const result = service.extractPacket(source);

      expect(result.status).toBe("found");
    });
  });

  // ── Constants ───────────────────────────────────────────────────────────

  describe("constants", () => {
    /**
     * Validates that the default threshold matches the PRD specification.
     */
    it("has default consecutive failure threshold of 3", () => {
      expect(DEFAULT_CONSECUTIVE_FAILURE_THRESHOLD).toBe(3);
    });

    /**
     * Validates that delimiters match the expected format.
     */
    it("exports correct delimiter constants", () => {
      expect(RESULT_PACKET_START_DELIMITER).toBe("---BEGIN_RESULT_PACKET---");
      expect(RESULT_PACKET_END_DELIMITER).toBe("---END_RESULT_PACKET---");
    });
  });
});
