/**
 * DTO for audit event search query parameters.
 *
 * Supports filtering by entity, event type, actor, and time range.
 * All filter fields are optional — when omitted, no filtering is
 * applied for that dimension. Filters combine with AND semantics.
 *
 * @module @factory/control-plane
 */
import { z } from "zod";

/**
 * Coerces an ISO 8601 date string from query params into a Date object.
 * Returns undefined if the value is empty or not provided.
 */
const optionalDateString = z
  .string()
  .optional()
  .transform((val) => (val ? new Date(val) : undefined))
  .pipe(z.date().optional());

/** Zod schema for audit event search query parameters. */
const auditQuerySchema = z.object({
  /** Page number (1-based). Defaults to 1. */
  page: z.coerce.number().int().min(1).default(1),
  /** Items per page (1–100). Defaults to 20. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Filter by entity type (e.g. "task", "lease", "review_cycle"). */
  entityType: z.string().optional(),
  /** Filter by entity ID. */
  entityId: z.string().optional(),
  /** Filter by event type (e.g. "state_transition", "created"). */
  eventType: z.string().optional(),
  /** Filter by actor type (e.g. "system", "worker", "operator"). */
  actorType: z.string().optional(),
  /** Filter by actor ID. */
  actorId: z.string().optional(),
  /** Filter for events on or after this ISO 8601 timestamp. */
  start: optionalDateString,
  /** Filter for events on or before this ISO 8601 timestamp. */
  end: optionalDateString,
});

/**
 * Data transfer object for `GET /audit` query parameters.
 *
 * Combines pagination with optional audit-specific filters. Zod coerces
 * raw string values from the query string into validated types.
 */
export class AuditQueryDto {
  /** Zod schema used by the global validation pipe. */
  static schema = auditQuerySchema;

  /** Page number (1-based). */
  page!: number;
  /** Items per page. */
  limit!: number;
  /** Filter by entity type. */
  entityType?: string;
  /** Filter by entity ID. */
  entityId?: string;
  /** Filter by event type. */
  eventType?: string;
  /** Filter by actor type. */
  actorType?: string;
  /** Filter by actor ID. */
  actorId?: string;
  /** Filter for events on or after this timestamp. */
  start?: Date;
  /** Filter for events on or before this timestamp. */
  end?: Date;
}

/** Zod schema for the task timeline query parameters. */
const timelineQuerySchema = z.object({
  /** Page number (1-based). Defaults to 1. */
  page: z.coerce.number().int().min(1).default(1),
  /** Items per page (1–100). Defaults to 50. */
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Data transfer object for `GET /tasks/:id/timeline` query parameters.
 *
 * Provides pagination-only filtering for task audit timelines.
 */
export class TimelineQueryDto {
  /** Zod schema used by the global validation pipe. */
  static schema = timelineQuerySchema;

  /** Page number (1-based). */
  page!: number;
  /** Items per page. */
  limit!: number;
}
