/**
 * DTO for creating a new project.
 *
 * Validated by the global {@link ZodValidationPipe} using the static
 * `schema` property. All constraints (min/max length) are enforced at
 * the Zod layer before the request reaches the route handler.
 *
 * @module @factory/control-plane
 */
import { z } from "zod";

/** Zod schema for project creation payloads. */
const createProjectSchema = z.object({
  /** Human-readable project name (1–255 characters). */
  name: z.string().min(1, "Name is required").max(255),
  /** Optional longer description. */
  description: z.string().optional(),
  /** Owner identifier — user or team (1–255 characters). */
  owner: z.string().min(1, "Owner is required").max(255),
});

/**
 * Data transfer object for `POST /projects` requests.
 *
 * Properties mirror the Zod schema. The pipe parses raw JSON into this
 * shape, so route handlers receive validated, typed data.
 */
export class CreateProjectDto {
  /** Zod schema used by the global validation pipe. */
  static schema = createProjectSchema;

  /** Human-readable project name. */
  name!: string;
  /** Optional longer description. */
  description?: string;
  /** Owner identifier. */
  owner!: string;
}
