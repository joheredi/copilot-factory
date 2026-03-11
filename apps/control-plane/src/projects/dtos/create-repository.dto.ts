/**
 * DTO for creating a new repository within a project.
 *
 * Validated by the global {@link ZodValidationPipe}. The `remoteUrl`
 * field must be a valid URL, and `localCheckoutStrategy` is restricted
 * to known strategies.
 *
 * @module @factory/control-plane
 */
import { z } from "zod";

/** Zod schema for repository creation payloads. */
const createRepositorySchema = z.object({
  /** Human-readable repository name (1–255 characters). */
  name: z.string().min(1, "Name is required").max(255),
  /** Git remote URL for cloning and fetching. */
  remoteUrl: z.string().min(1, "Remote URL is required").url("Must be a valid URL"),
  /** Default branch name. Defaults to "main". */
  defaultBranch: z.string().optional().default("main"),
  /** Strategy for local checkouts — "worktree" or "clone". */
  localCheckoutStrategy: z.enum(["worktree", "clone"]),
  /** Optional credential profile reference. */
  credentialProfileId: z.string().optional(),
  /** Repository operational status. Defaults to "active". */
  status: z.string().optional().default("active"),
});

/**
 * Data transfer object for `POST /projects/:projectId/repositories` requests.
 *
 * Defaults are applied by Zod: `defaultBranch` → "main", `status` → "active".
 */
export class CreateRepositoryDto {
  /** Zod schema used by the global validation pipe. */
  static schema = createRepositorySchema;

  /** Human-readable repository name. */
  name!: string;
  /** Git remote URL. */
  remoteUrl!: string;
  /** Default branch name. */
  defaultBranch!: string;
  /** Local checkout strategy. */
  localCheckoutStrategy!: "worktree" | "clone";
  /** Optional credential profile ID. */
  credentialProfileId?: string;
  /** Operational status. */
  status!: string;
}
