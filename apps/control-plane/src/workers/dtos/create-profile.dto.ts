import { z } from "zod";

/** Zod schema for agent profile creation payloads. */
const createProfileSchema = z.object({
  /** FK to the prompt template used by this profile. */
  promptTemplateId: z.string().optional(),
  /** FK to the tool policy. */
  toolPolicyId: z.string().optional(),
  /** FK to the command policy. */
  commandPolicyId: z.string().optional(),
  /** FK to the file scope policy. */
  fileScopePolicyId: z.string().optional(),
  /** FK to the validation policy. */
  validationPolicyId: z.string().optional(),
  /** FK to the review policy. */
  reviewPolicyId: z.string().optional(),
  /** FK to the budget policy. */
  budgetPolicyId: z.string().optional(),
  /** FK to the retry policy. */
  retryPolicyId: z.string().optional(),
});

/**
 * Data transfer object for `POST /pools/:id/profiles` requests.
 *
 * The pool ID is taken from the route parameter. All policy references
 * are optional — profiles can be created incrementally as policies are defined.
 */
export class CreateProfileDto {
  /** Zod schema used by the global validation pipe. */
  static schema = createProfileSchema;

  promptTemplateId?: string;
  toolPolicyId?: string;
  commandPolicyId?: string;
  fileScopePolicyId?: string;
  validationPolicyId?: string;
  reviewPolicyId?: string;
  budgetPolicyId?: string;
  retryPolicyId?: string;
}
