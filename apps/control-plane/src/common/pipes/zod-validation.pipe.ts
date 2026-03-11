/**
 * Global validation pipe that uses Zod schemas for request validation.
 *
 * NestJS pipes run before the route handler and can transform or validate
 * incoming data. This pipe checks if the route handler's parameter type
 * has a static `schema` property (a Zod schema) and validates the
 * incoming value against it.
 *
 * Usage in a controller:
 * ```typescript
 * class CreateTaskDto {
 *   static schema = z.object({ title: z.string().min(1) });
 *   title!: string;
 * }
 *
 * @Post("tasks")
 * create(@Body() dto: CreateTaskDto) { ... }
 * ```
 *
 * When validation fails, throws a 400 Bad Request with structured
 * details listing each invalid field.
 *
 * @module @factory/control-plane
 */
import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import { ZodError, ZodSchema } from "zod";

/** The shape of a single Zod validation issue in the error details. */
export interface ValidationIssue {
  /** Dot-separated path to the invalid field (e.g. "address.zip"). */
  field: string;
  /** Human-readable description of what's wrong. */
  message: string;
}

/**
 * Validates incoming request data against Zod schemas attached to DTO classes.
 *
 * If the DTO class has a static `schema` property that is a ZodSchema,
 * the pipe parses the incoming value through it. On success, the parsed
 * (and potentially transformed) value is passed to the handler. On failure,
 * a BadRequestException is thrown with structured validation details.
 *
 * Values without a corresponding Zod schema are passed through unchanged.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  /**
   * Validates and optionally transforms the incoming value.
   *
   * @param value - The raw request data (body, query, param).
   * @param metadata - NestJS argument metadata including the metatype (DTO class).
   * @returns The validated (and possibly transformed) value.
   * @throws BadRequestException when Zod validation fails.
   */
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema = this.extractSchema(metadata);
    if (!schema) {
      return value;
    }

    try {
      return schema.parse(value) as unknown;
    } catch (error) {
      if (error instanceof ZodError) {
        const issues: ValidationIssue[] = error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));

        throw new BadRequestException({
          message: "Validation failed",
          details: issues,
        });
      }
      throw error;
    }
  }

  /**
   * Attempts to extract a Zod schema from the metatype's static `schema` property.
   *
   * @param metadata - NestJS argument metadata.
   * @returns The ZodSchema if found, or undefined.
   */
  private extractSchema(metadata: ArgumentMetadata): ZodSchema | undefined {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- NestJS metatype is typed as Function
    const metatype = metadata.metatype as (Function & { schema?: unknown }) | undefined;
    if (!metatype || !("schema" in metatype)) {
      return undefined;
    }

    const schema = metatype.schema;
    if (schema && typeof schema === "object" && "parse" in schema) {
      return schema as ZodSchema;
    }

    return undefined;
  }
}
