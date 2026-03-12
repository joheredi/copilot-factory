/**
 * Job repository — data access for the job table (DB-backed job queue).
 *
 * Provides typed CRUD operations, queue polling methods, and an atomic
 * {@link claimJob} operation that sets `status = "CLAIMED"`, assigns
 * `leaseOwner`, and increments `attemptCount` in a single UPDATE statement.
 * This prevents two workers from claiming the same job concurrently.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Job
 */

import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { jobs } from "../database/schema.js";

/** A job row as read from the database. */
export type Job = InferSelectModel<typeof jobs>;

/** Data required to insert a new job row. */
export type NewJob = InferInsertModel<typeof jobs>;

/**
 * Create a job repository bound to the given Drizzle database instance.
 *
 * The {@link claimJob} method is designed for use inside
 * `conn.writeTransaction()` to provide atomic job acquisition.
 */
export function createJobRepository(db: BetterSQLite3Database) {
  return {
    /** Find a job by its primary key. */
    findById(jobId: string): Job | undefined {
      return db.select().from(jobs).where(eq(jobs.jobId, jobId)).get();
    },

    /** Return all jobs, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): Job[] {
      let query = db.select().from(jobs).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /** Find all jobs with a given status. */
    findByStatus(status: string): Job[] {
      return db.select().from(jobs).where(eq(jobs.status, status)).all();
    },

    /** Find all jobs belonging to a job group. */
    findByJobGroupId(jobGroupId: string): Job[] {
      return db.select().from(jobs).where(eq(jobs.jobGroupId, jobGroupId)).all();
    },

    /** Find all child jobs of a given parent job. */
    findByParentJobId(parentJobId: string): Job[] {
      return db.select().from(jobs).where(eq(jobs.parentJobId, parentJobId)).all();
    },

    /**
     * Find jobs that are eligible to be claimed: status is "pending" and
     * `runAfter` is either null or in the past. Results are ordered by
     * creation time (FIFO).
     */
    findClaimable(now: Date): Job[] {
      return db
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, "pending"), or(isNull(jobs.runAfter), lte(jobs.runAfter, now))))
        .all();
    },

    /**
     * Atomically claim a job for processing.
     *
     * Sets the job status to "claimed", assigns `leaseOwner`, increments
     * `attemptCount`, and updates `updatedAt` — but only if the job is
     * currently in "pending" status. If the job was already claimed (or is
     * in any other status), the WHERE clause matches zero rows and the
     * method returns `undefined`.
     *
     * This should be called inside `conn.writeTransaction()` for safety.
     *
     * @param jobId - The job to claim.
     * @param leaseOwner - Identifier of the worker/process claiming the job.
     * @returns The claimed job row, or `undefined` if the job was not claimable.
     */
    claimJob(jobId: string, leaseOwner: string): Job | undefined {
      return db
        .update(jobs)
        .set({
          status: "claimed",
          leaseOwner,
          attemptCount: sql`${jobs.attemptCount} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(jobs.jobId, jobId), eq(jobs.status, "pending")))
        .returning()
        .get();
    },

    /** Insert a new job row. Returns the inserted row with defaults. */
    create(data: NewJob): Job {
      return db.insert(jobs).values(data).returning().get();
    },

    /** Update a job by primary key. Returns the updated row or undefined. */
    update(jobId: string, data: Partial<Omit<NewJob, "jobId">>): Job | undefined {
      return db
        .update(jobs)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(jobs.jobId, jobId))
        .returning()
        .get();
    },

    /** Delete a job by primary key. Returns true if deleted. */
    delete(jobId: string): boolean {
      const result = db.delete(jobs).where(eq(jobs.jobId, jobId)).returning().get();
      return result !== undefined;
    },
  };
}
