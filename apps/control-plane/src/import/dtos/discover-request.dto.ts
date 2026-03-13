/**
 * DTO for the import discovery request.
 *
 * Validated by the global {@link ZodValidationPipe} using the static
 * `schema` property. Accepts a local filesystem path to scan for tasks,
 * and an optional glob pattern for filtering files.
 *
 * @module @factory/control-plane
 * @see T115 — Create POST /import/discover endpoint
 */
import { z } from "zod";

/** Zod schema for import discovery request payloads. */
const discoverRequestSchema = z.object({
  /**
   * Absolute or relative filesystem path to scan for task files.
   * Must point to an existing, readable directory.
   */
  path: z
    .string()
    .min(1, "path is required")
    .describe("Local filesystem path to scan for importable task files"),
  /**
   * Optional glob pattern for filtering which files to consider.
   * If omitted, all supported files (markdown, JSON) are scanned.
   */
  pattern: z
    .string()
    .optional()
    .describe("Optional glob pattern to filter files (e.g., 'tasks/*.md')"),
});

/**
 * Data transfer object for `POST /import/discover` requests.
 *
 * Properties mirror the Zod schema. The global validation pipe parses
 * raw JSON into this shape, so route handlers receive validated, typed data.
 */
export class DiscoverRequestDto {
  /** Zod schema used by the global validation pipe. */
  static schema = discoverRequestSchema;

  /** Local filesystem path to scan for task files. */
  path!: string;
  /** Optional glob pattern for filtering files. */
  pattern?: string;
}
