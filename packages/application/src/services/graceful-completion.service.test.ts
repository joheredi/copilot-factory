/**
 * Tests for the graceful completion service.
 *
 * These tests validate the result acceptance protocol for the worker lease
 * lifecycle. The graceful completion service must handle two key scenarios:
 *
 * 1. **Normal completion** (COMPLETING state): Worker sent terminal heartbeat,
 *    lease transitioned to COMPLETING, result arrives within the extended expiry.
 *
 * 2. **Late completion / race condition** (TIMED_OUT state): The staleness
 *    detector marked the lease TIMED_OUT before the terminal heartbeat arrived,
 *    but the result arrives within gracePeriodSeconds of expiresAt.
 *
 * The tests also validate security constraints (worker ID matching),
 * timing edge cases, and proper audit event recording for both accepted
 * and rejected results.
 *
 * @see docs/prd/002-data-model.md §2.8 — Graceful Completion
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8 — Lease and Heartbeat Policy
 * @module @factory/application/services/graceful-completion.service.test
 */

import { describe, it, expect } from "vitest";
import { WorkerLeaseStatus } from "@factory/domain";

import {
  createGracefulCompletionService,
  computeGraceDeadline,
  type GracefulCompletionService,
} from "./graceful-completion.service.js";

import type {
  CompletionLease,
  CompletionLeaseRepositoryPort,
  CompletionTransactionRepositories,
  CompletionUnitOfWork,
} from "../ports/graceful-completion.ports.js";

import type { AuditEventRecord, NewAuditEvent } from "../ports/repository.ports.js";
import type { AuditEventRepositoryPort } from "../ports/repository.ports.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { DomainEvent, ActorInfo } from "../events/domain-events.js";

import {
  EntityNotFoundError,
  LeaseNotAcceptingResultsError,
  GracePeriodExpiredError,
  WorkerMismatchError,
} from "../errors.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

/** Standard test actor for result submission. */
const WORKER_ACTOR: ActorInfo = { type: "worker", id: "worker-001" };

/** Default grace period matching a reasonable production value. */
const DEFAULT_GRACE_SECONDS = 30;

/** Creates a Date offset from a base date by the given number of seconds. */
function dateOffset(base: Date, offsetSeconds: number): Date {
  return new Date(base.getTime() + offsetSeconds * 1000);
}

/**
 * Creates a mock lease with sensible defaults for completion testing.
 * Override any field via the partial parameter.
 */
function createTestLease(overrides: Partial<CompletionLease> = {}): CompletionLease {
  const now = new Date("2025-01-15T10:00:00Z");
  return {
    leaseId: "lease-001",
    taskId: "task-001",
    workerId: "worker-001",
    poolId: "pool-001",
    status: WorkerLeaseStatus.COMPLETING,
    heartbeatAt: now,
    expiresAt: dateOffset(now, 1800), // 30 minutes from now
    leasedAt: dateOffset(now, -300), // leased 5 minutes ago
    ...overrides,
  };
}

// ─── Mock Factories ─────────────────────────────────────────────────────────

/**
 * Creates an in-memory mock lease repository for completion operations.
 *
 * This mock is intentionally read-only — the graceful completion service
 * does not modify lease records, only reads them for validation.
 */
function createMockLeaseRepo(
  initialLeases: CompletionLease[] = [],
): CompletionLeaseRepositoryPort & {
  leases: CompletionLease[];
} {
  const leases = [...initialLeases];

  return {
    leases,

    findById(leaseId: string): CompletionLease | undefined {
      return leases.find((l) => l.leaseId === leaseId);
    },
  };
}

/**
 * Creates an in-memory mock audit event repository.
 * Exposes the events array for assertions.
 */
function createMockAuditRepo(): AuditEventRepositoryPort & { events: AuditEventRecord[] } {
  const events: AuditEventRecord[] = [];
  let nextId = 1;

  return {
    events,

    create(event: NewAuditEvent): AuditEventRecord {
      const record: AuditEventRecord = {
        id: `audit-${String(nextId++)}`,
        entityType: event.entityType,
        entityId: event.entityId,
        eventType: event.eventType,
        actorType: event.actorType,
        actorId: event.actorId,
        oldState: event.oldState,
        newState: event.newState,
        metadata: event.metadata,
        createdAt: new Date(),
      };
      events.push(record);
      return record;
    },
  };
}

/**
 * Creates a mock unit of work that provides transaction semantics.
 * Uses the provided repos directly (in-memory, no real DB transactions).
 */
function createMockUnitOfWork(
  leaseRepo: CompletionLeaseRepositoryPort,
  auditRepo: AuditEventRepositoryPort,
): CompletionUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: CompletionTransactionRepositories) => T): T {
      return fn({
        lease: leaseRepo,
        auditEvent: auditRepo,
      });
    },
  };
}

/**
 * Creates a mock domain event emitter.
 * Exposes the events array for assertions.
 */
function createMockEmitter(): DomainEventEmitter & { events: DomainEvent[] } {
  const events: DomainEvent[] = [];
  return {
    events,
    emit(event: DomainEvent): void {
      events.push(event);
    },
  };
}

/**
 * Creates a fully wired test harness with a service instance and all mocks.
 *
 * @param leases - Initial lease records in the mock repository
 * @param clockTime - Fixed time for the injectable clock
 */
function createTestHarness(
  leases: CompletionLease[] = [],
  clockTime: Date = new Date("2025-01-15T10:00:00Z"),
): {
  service: GracefulCompletionService;
  leaseRepo: ReturnType<typeof createMockLeaseRepo>;
  auditRepo: ReturnType<typeof createMockAuditRepo>;
  emitter: ReturnType<typeof createMockEmitter>;
} {
  const leaseRepo = createMockLeaseRepo(leases);
  const auditRepo = createMockAuditRepo();
  const emitter = createMockEmitter();
  const unitOfWork = createMockUnitOfWork(leaseRepo, auditRepo);
  const service = createGracefulCompletionService(unitOfWork, emitter, () => clockTime);

  return { service, leaseRepo, auditRepo, emitter };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("graceful-completion.service", () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // computeGraceDeadline — pure function unit tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("computeGraceDeadline", () => {
    /**
     * For COMPLETING leases, the expiresAt was already extended by the
     * terminal heartbeat's grace period. The deadline IS expiresAt.
     */
    it("returns expiresAt for COMPLETING leases (grace already applied)", () => {
      const lease = createTestLease({ status: WorkerLeaseStatus.COMPLETING });
      const deadline = computeGraceDeadline(lease, DEFAULT_GRACE_SECONDS);
      expect(deadline).toEqual(lease.expiresAt);
    });

    /**
     * For TIMED_OUT leases, the terminal heartbeat never extended expiresAt.
     * The grace deadline is expiresAt + gracePeriodSeconds.
     */
    it("returns expiresAt + gracePeriodSeconds for TIMED_OUT leases", () => {
      const lease = createTestLease({ status: WorkerLeaseStatus.TIMED_OUT });
      const deadline = computeGraceDeadline(lease, DEFAULT_GRACE_SECONDS);
      const expected = new Date(lease.expiresAt.getTime() + DEFAULT_GRACE_SECONDS * 1000);
      expect(deadline).toEqual(expected);
    });

    /**
     * Grace period of zero means no extension — deadline is exactly expiresAt
     * for both COMPLETING and TIMED_OUT.
     */
    it("handles zero grace period for TIMED_OUT leases", () => {
      const lease = createTestLease({ status: WorkerLeaseStatus.TIMED_OUT });
      const deadline = computeGraceDeadline(lease, 0);
      expect(deadline).toEqual(lease.expiresAt);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // acceptResult — happy path (COMPLETING state)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("acceptResult — happy path (COMPLETING lease)", () => {
    /**
     * The primary success scenario: worker sends terminal heartbeat,
     * lease is COMPLETING, result arrives within the grace window.
     * This validates the normal completion flow works end to end.
     */
    it("accepts result for COMPLETING lease within expiry window", () => {
      const lease = createTestLease({
        status: WorkerLeaseStatus.COMPLETING,
        expiresAt: new Date("2025-01-15T10:30:00Z"),
      });
      // Clock is 10:00, expires at 10:30 — well within window
      const { service } = createTestHarness([lease]);

      const result = service.acceptResult({
        leaseId: "lease-001",
        workerId: "worker-001",
        gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
        actor: WORKER_ACTOR,
      });

      expect(result.lease.leaseId).toBe("lease-001");
      expect(result.lateAcceptance).toBe(false);
    });

    /**
     * Result accepted at exactly the deadline boundary (expiresAt).
     * Ensures boundary condition is inclusive (<=, not <).
     */
    it("accepts result at exactly the expiry boundary", () => {
      const expiresAt = new Date("2025-01-15T10:30:00Z");
      const lease = createTestLease({
        status: WorkerLeaseStatus.COMPLETING,
        expiresAt,
      });
      // Clock is exactly at expiresAt
      const { service } = createTestHarness([lease], expiresAt);

      const result = service.acceptResult({
        leaseId: "lease-001",
        workerId: "worker-001",
        gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
        actor: WORKER_ACTOR,
      });

      expect(result.lateAcceptance).toBe(false);
    });

    /**
     * Audit event is correctly recorded for a normal acceptance.
     * Verifies the event type and key fields.
     */
    it("records lease.result-accepted audit event", () => {
      const lease = createTestLease({ status: WorkerLeaseStatus.COMPLETING });
      const { service, auditRepo } = createTestHarness([lease]);

      service.acceptResult({
        leaseId: "lease-001",
        workerId: "worker-001",
        gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
        actor: WORKER_ACTOR,
      });

      expect(auditRepo.events).toHaveLength(1);
      const event = auditRepo.events[0]!;
      expect(event.eventType).toBe("lease.result-accepted");
      expect(event.entityType).toBe("task-lease");
      expect(event.entityId).toBe("lease-001");
    });

    /**
     * Domain event is emitted after successful acceptance.
     * Ensures downstream listeners are notified.
     */
    it("emits domain event after acceptance", () => {
      const lease = createTestLease({ status: WorkerLeaseStatus.COMPLETING });
      const { service, emitter } = createTestHarness([lease]);

      service.acceptResult({
        leaseId: "lease-001",
        workerId: "worker-001",
        gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
        actor: WORKER_ACTOR,
      });

      expect(emitter.events).toHaveLength(1);
      expect(emitter.events[0]!.type).toBe("task-lease.transitioned");
    });

    /**
     * Optional metadata is correctly recorded in the audit event.
     * Workers may include summary info, artifact references, etc.
     */
    it("includes metadata in audit event when provided", () => {
      const lease = createTestLease({ status: WorkerLeaseStatus.COMPLETING });
      const { service, auditRepo } = createTestHarness([lease]);

      service.acceptResult({
        leaseId: "lease-001",
        workerId: "worker-001",
        gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
        actor: WORKER_ACTOR,
        metadata: { summary: "Task completed successfully" },
      });

      const event = auditRepo.events[0]!;
      expect(event.metadata).toBe(JSON.stringify({ summary: "Task completed successfully" }));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // acceptResult — late acceptance (TIMED_OUT state within grace period)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("acceptResult — late acceptance (TIMED_OUT within grace period)", () => {
    /**
     * Race condition scenario: staleness detector marked lease TIMED_OUT,
     * but result arrives within gracePeriodSeconds of expiresAt.
     * The result MUST be accepted to avoid losing valid work.
     */
    it("accepts result for TIMED_OUT lease within grace period", () => {
      const expiresAt = new Date("2025-01-15T10:00:00Z");
      const lease = createTestLease({
        status: WorkerLeaseStatus.TIMED_OUT,
        expiresAt,
      });
      // Clock is 10 seconds after expiry, grace period is 30 seconds
      const clockTime = dateOffset(expiresAt, 10);
      const { service } = createTestHarness([lease], clockTime);

      const result = service.acceptResult({
        leaseId: "lease-001",
        workerId: "worker-001",
        gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
        actor: WORKER_ACTOR,
      });

      expect(result.lateAcceptance).toBe(true);
      expect(result.lease.status).toBe(WorkerLeaseStatus.TIMED_OUT);
    });

    /**
     * Late acceptance at exactly the grace deadline boundary.
     * Validates inclusive boundary: expiresAt + gracePeriod = deadline.
     */
    it("accepts result at exactly the grace period boundary", () => {
      const expiresAt = new Date("2025-01-15T10:00:00Z");
      const lease = createTestLease({
        status: WorkerLeaseStatus.TIMED_OUT,
        expiresAt,
      });
      // Clock is exactly at expiresAt + gracePeriod
      const clockTime = dateOffset(expiresAt, DEFAULT_GRACE_SECONDS);
      const { service } = createTestHarness([lease], clockTime);

      const result = service.acceptResult({
        leaseId: "lease-001",
        workerId: "worker-001",
        gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
        actor: WORKER_ACTOR,
      });

      expect(result.lateAcceptance).toBe(true);
    });

    /**
     * Audit event for late acceptance uses a distinct event type.
     * This allows the audit trail to distinguish normal from late completions.
     */
    it("records lease.result-accepted-late audit event", () => {
      const expiresAt = new Date("2025-01-15T10:00:00Z");
      const lease = createTestLease({
        status: WorkerLeaseStatus.TIMED_OUT,
        expiresAt,
      });
      const clockTime = dateOffset(expiresAt, 5);
      const { service, auditRepo } = createTestHarness([lease], clockTime);

      service.acceptResult({
        leaseId: "lease-001",
        workerId: "worker-001",
        gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
        actor: WORKER_ACTOR,
      });

      expect(auditRepo.events).toHaveLength(1);
      expect(auditRepo.events[0]!.eventType).toBe("lease.result-accepted-late");
    });

    /**
     * The newState JSON in the audit event includes lateAcceptance: true.
     * Downstream systems can use this to flag late completions.
     */
    it("audit event newState includes lateAcceptance flag", () => {
      const expiresAt = new Date("2025-01-15T10:00:00Z");
      const lease = createTestLease({
        status: WorkerLeaseStatus.TIMED_OUT,
        expiresAt,
      });
      const clockTime = dateOffset(expiresAt, 5);
      const { service, auditRepo } = createTestHarness([lease], clockTime);

      service.acceptResult({
        leaseId: "lease-001",
        workerId: "worker-001",
        gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
        actor: WORKER_ACTOR,
      });

      const newState = JSON.parse(auditRepo.events[0]!.newState!) as Record<string, unknown>;
      expect(newState.lateAcceptance).toBe(true);
      expect(newState.accepted).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // acceptResult — rejection cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe("acceptResult — rejections", () => {
    /**
     * Lease not found: the lease ID is invalid or the lease was already purged.
     * Must throw EntityNotFoundError to match the pattern of other services.
     */
    it("throws EntityNotFoundError for non-existent lease", () => {
      const { service } = createTestHarness([]);

      expect(() =>
        service.acceptResult({
          leaseId: "nonexistent",
          workerId: "worker-001",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: WORKER_ACTOR,
        }),
      ).toThrow(EntityNotFoundError);
    });

    /**
     * Worker mismatch: a different worker is trying to submit a result.
     * This prevents impersonation and ensures lease holder exclusivity.
     */
    it("throws WorkerMismatchError when worker ID does not match", () => {
      const lease = createTestLease({
        workerId: "worker-001",
        status: WorkerLeaseStatus.COMPLETING,
      });
      const { service } = createTestHarness([lease]);

      expect(() =>
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "wrong-worker",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: { type: "worker", id: "wrong-worker" },
        }),
      ).toThrow(WorkerMismatchError);
    });

    /**
     * WorkerMismatchError includes diagnostic fields for debugging.
     */
    it("WorkerMismatchError contains expected and actual worker IDs", () => {
      const lease = createTestLease({
        workerId: "worker-001",
        status: WorkerLeaseStatus.COMPLETING,
      });
      const { service } = createTestHarness([lease]);

      try {
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "impersonator",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: { type: "worker", id: "impersonator" },
        });
        expect.fail("Should have thrown WorkerMismatchError");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkerMismatchError);
        const e = error as WorkerMismatchError;
        expect(e.expectedWorkerId).toBe("worker-001");
        expect(e.actualWorkerId).toBe("impersonator");
      }
    });

    /**
     * RUNNING leases cannot accept results — the worker must first send
     * a terminal heartbeat to transition to COMPLETING.
     */
    it("throws LeaseNotAcceptingResultsError for RUNNING lease", () => {
      const lease = createTestLease({ status: WorkerLeaseStatus.RUNNING });
      const { service } = createTestHarness([lease]);

      expect(() =>
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "worker-001",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: WORKER_ACTOR,
        }),
      ).toThrow(LeaseNotAcceptingResultsError);
    });

    /**
     * HEARTBEATING leases cannot accept results — same as RUNNING.
     */
    it("throws LeaseNotAcceptingResultsError for HEARTBEATING lease", () => {
      const lease = createTestLease({ status: WorkerLeaseStatus.HEARTBEATING });
      const { service } = createTestHarness([lease]);

      expect(() =>
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "worker-001",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: WORKER_ACTOR,
        }),
      ).toThrow(LeaseNotAcceptingResultsError);
    });

    /**
     * CRASHED leases cannot accept results — the worker process is dead.
     */
    it("throws LeaseNotAcceptingResultsError for CRASHED lease", () => {
      const lease = createTestLease({ status: WorkerLeaseStatus.CRASHED });
      const { service } = createTestHarness([lease]);

      expect(() =>
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "worker-001",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: WORKER_ACTOR,
        }),
      ).toThrow(LeaseNotAcceptingResultsError);
    });

    /**
     * RECLAIMED leases cannot accept results — the lease has been
     * forcibly reclaimed by the orchestrator.
     */
    it("throws LeaseNotAcceptingResultsError for RECLAIMED lease", () => {
      const lease = createTestLease({ status: WorkerLeaseStatus.RECLAIMED });
      const { service } = createTestHarness([lease]);

      expect(() =>
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "worker-001",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: WORKER_ACTOR,
        }),
      ).toThrow(LeaseNotAcceptingResultsError);
    });

    /**
     * IDLE leases cannot accept results — no work was ever started.
     */
    it("throws LeaseNotAcceptingResultsError for IDLE lease", () => {
      const lease = createTestLease({ status: WorkerLeaseStatus.IDLE });
      const { service } = createTestHarness([lease]);

      expect(() =>
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "worker-001",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: WORKER_ACTOR,
        }),
      ).toThrow(LeaseNotAcceptingResultsError);
    });

    /**
     * LEASED leases cannot accept results — worker hasn't started yet.
     */
    it("throws LeaseNotAcceptingResultsError for LEASED lease", () => {
      const lease = createTestLease({ status: WorkerLeaseStatus.LEASED });
      const { service } = createTestHarness([lease]);

      expect(() =>
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "worker-001",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: WORKER_ACTOR,
        }),
      ).toThrow(LeaseNotAcceptingResultsError);
    });

    /**
     * STARTING leases cannot accept results — worker hasn't begun work.
     */
    it("throws LeaseNotAcceptingResultsError for STARTING lease", () => {
      const lease = createTestLease({ status: WorkerLeaseStatus.STARTING });
      const { service } = createTestHarness([lease]);

      expect(() =>
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "worker-001",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: WORKER_ACTOR,
        }),
      ).toThrow(LeaseNotAcceptingResultsError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // acceptResult — grace period expiry
  // ═══════════════════════════════════════════════════════════════════════════

  describe("acceptResult — grace period expiry", () => {
    /**
     * COMPLETING lease past its expiresAt — the worker took too long
     * to deliver the result after sending the terminal heartbeat.
     */
    it("throws GracePeriodExpiredError for COMPLETING lease past expiresAt", () => {
      const expiresAt = new Date("2025-01-15T10:00:00Z");
      const lease = createTestLease({
        status: WorkerLeaseStatus.COMPLETING,
        expiresAt,
      });
      // Clock is 1 second past expiry
      const clockTime = dateOffset(expiresAt, 1);
      const { service } = createTestHarness([lease], clockTime);

      expect(() =>
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "worker-001",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: WORKER_ACTOR,
        }),
      ).toThrow(GracePeriodExpiredError);
    });

    /**
     * TIMED_OUT lease past expiresAt + gracePeriodSeconds — the result
     * arrived too late even for the race condition grace window.
     */
    it("throws GracePeriodExpiredError for TIMED_OUT lease past grace deadline", () => {
      const expiresAt = new Date("2025-01-15T10:00:00Z");
      const lease = createTestLease({
        status: WorkerLeaseStatus.TIMED_OUT,
        expiresAt,
      });
      // Clock is 1 second past expiresAt + gracePeriod
      const clockTime = dateOffset(expiresAt, DEFAULT_GRACE_SECONDS + 1);
      const { service } = createTestHarness([lease], clockTime);

      expect(() =>
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "worker-001",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: WORKER_ACTOR,
        }),
      ).toThrow(GracePeriodExpiredError);
    });

    /**
     * GracePeriodExpiredError includes the deadline and received time
     * for diagnostic purposes.
     */
    it("GracePeriodExpiredError contains diagnostic fields", () => {
      const expiresAt = new Date("2025-01-15T10:00:00Z");
      const lease = createTestLease({
        status: WorkerLeaseStatus.COMPLETING,
        expiresAt,
      });
      const clockTime = dateOffset(expiresAt, 5);
      const { service } = createTestHarness([lease], clockTime);

      try {
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "worker-001",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: WORKER_ACTOR,
        });
        expect.fail("Should have thrown GracePeriodExpiredError");
      } catch (error) {
        expect(error).toBeInstanceOf(GracePeriodExpiredError);
        const e = error as GracePeriodExpiredError;
        expect(e.leaseId).toBe("lease-001");
        expect(e.graceDeadline).toEqual(expiresAt);
        expect(e.receivedAt).toEqual(clockTime);
      }
    });

    /**
     * Rejection records an audit event so we have a trail of failed attempts.
     * This is critical for debugging race conditions in production.
     */
    it("records lease.result-rejected audit event on grace period expiry", () => {
      const expiresAt = new Date("2025-01-15T10:00:00Z");
      const lease = createTestLease({
        status: WorkerLeaseStatus.COMPLETING,
        expiresAt,
      });
      const clockTime = dateOffset(expiresAt, 5);
      const { service, auditRepo } = createTestHarness([lease], clockTime);

      try {
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "worker-001",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: WORKER_ACTOR,
        });
      } catch {
        // Expected
      }

      expect(auditRepo.events).toHaveLength(1);
      expect(auditRepo.events[0]!.eventType).toBe("lease.result-rejected");
    });

    /**
     * Zero grace period for TIMED_OUT means the deadline is exactly expiresAt.
     * Any result arriving after expiresAt is rejected.
     */
    it("zero grace period for TIMED_OUT means deadline equals expiresAt", () => {
      const expiresAt = new Date("2025-01-15T10:00:00Z");
      const lease = createTestLease({
        status: WorkerLeaseStatus.TIMED_OUT,
        expiresAt,
      });
      // Clock is 1 second past expiry, grace is 0
      const clockTime = dateOffset(expiresAt, 1);
      const { service } = createTestHarness([lease], clockTime);

      expect(() =>
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "worker-001",
          gracePeriodSeconds: 0,
          actor: WORKER_ACTOR,
        }),
      ).toThrow(GracePeriodExpiredError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // acceptResult — validation order
  // ═══════════════════════════════════════════════════════════════════════════

  describe("acceptResult — validation order", () => {
    /**
     * Worker mismatch is checked BEFORE state/grace period checks.
     * This ensures impersonation attempts are caught immediately
     * without leaking lease state information.
     */
    it("checks worker mismatch before lease state", () => {
      const lease = createTestLease({
        workerId: "worker-001",
        status: WorkerLeaseStatus.RUNNING, // not accepting results
      });
      const { service } = createTestHarness([lease]);

      // Should throw WorkerMismatchError, not LeaseNotAcceptingResultsError
      expect(() =>
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "wrong-worker",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: { type: "worker", id: "wrong-worker" },
        }),
      ).toThrow(WorkerMismatchError);
    });

    /**
     * Lease state is checked BEFORE grace period.
     * If the lease is in an invalid state, we don't compute the grace window.
     */
    it("checks lease state before grace period", () => {
      const expiresAt = new Date("2025-01-15T09:00:00Z"); // already expired
      const lease = createTestLease({
        status: WorkerLeaseStatus.CRASHED,
        expiresAt,
      });
      const { service } = createTestHarness([lease]);

      // Should throw LeaseNotAcceptingResultsError, not GracePeriodExpiredError
      expect(() =>
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "worker-001",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: WORKER_ACTOR,
        }),
      ).toThrow(LeaseNotAcceptingResultsError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Full integration scenario — terminal heartbeat + result submission
  // ═══════════════════════════════════════════════════════════════════════════

  describe("integration — full graceful completion flow", () => {
    /**
     * End-to-end scenario: worker sends terminal heartbeat (simulated by
     * creating a COMPLETING lease with extended expiry), then submits result.
     * This validates the complete happy path as described in the PRD.
     *
     * @see docs/prd/002-data-model.md §2.8 — Graceful Completion
     */
    it("terminal heartbeat extends window, result accepted within it", () => {
      // Simulate: terminal heartbeat was received at 10:00, grace period 30s
      // So expiresAt was extended to max(original, 10:00 + 30s) = 10:00:30
      const completingLease = createTestLease({
        status: WorkerLeaseStatus.COMPLETING,
        heartbeatAt: new Date("2025-01-15T10:00:00Z"),
        expiresAt: new Date("2025-01-15T10:00:30Z"), // extended by grace period
      });
      // Result arrives 15 seconds after terminal heartbeat — within grace
      const clockTime = new Date("2025-01-15T10:00:15Z");
      const { service } = createTestHarness([completingLease], clockTime);

      const result = service.acceptResult({
        leaseId: "lease-001",
        workerId: "worker-001",
        gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
        actor: WORKER_ACTOR,
      });

      expect(result.lateAcceptance).toBe(false);
      expect(result.lease.status).toBe(WorkerLeaseStatus.COMPLETING);
    });

    /**
     * Race condition scenario: staleness detector fires before terminal
     * heartbeat, marking lease TIMED_OUT. Worker still sends result within
     * grace period. The result MUST be accepted.
     *
     * This is the critical race condition the graceful completion protocol
     * is designed to prevent from causing data loss.
     */
    it("race condition: TIMED_OUT lease accepts result within grace period", () => {
      // Lease expired at 10:00 (staleness detector marked TIMED_OUT)
      const timedOutLease = createTestLease({
        status: WorkerLeaseStatus.TIMED_OUT,
        expiresAt: new Date("2025-01-15T10:00:00Z"),
        heartbeatAt: new Date("2025-01-15T09:58:00Z"), // last heartbeat 2 min before expiry
      });
      // Result arrives 20 seconds after expiry — within 30s grace period
      const clockTime = new Date("2025-01-15T10:00:20Z");
      const { service, auditRepo } = createTestHarness([timedOutLease], clockTime);

      const result = service.acceptResult({
        leaseId: "lease-001",
        workerId: "worker-001",
        gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
        actor: WORKER_ACTOR,
      });

      expect(result.lateAcceptance).toBe(true);
      expect(result.lease.status).toBe(WorkerLeaseStatus.TIMED_OUT);
      expect(auditRepo.events[0]!.eventType).toBe("lease.result-accepted-late");
    });

    /**
     * Race condition with expired grace: staleness detector fires,
     * result arrives AFTER the grace period. Must be rejected.
     */
    it("race condition: TIMED_OUT lease rejects result past grace period", () => {
      const timedOutLease = createTestLease({
        status: WorkerLeaseStatus.TIMED_OUT,
        expiresAt: new Date("2025-01-15T10:00:00Z"),
      });
      // Result arrives 60 seconds after expiry — past 30s grace period
      const clockTime = new Date("2025-01-15T10:01:00Z");
      const { service } = createTestHarness([timedOutLease], clockTime);

      expect(() =>
        service.acceptResult({
          leaseId: "lease-001",
          workerId: "worker-001",
          gracePeriodSeconds: DEFAULT_GRACE_SECONDS,
          actor: WORKER_ACTOR,
        }),
      ).toThrow(GracePeriodExpiredError);
    });
  });
});
