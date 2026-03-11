/**
 * Tests for the Zod validation pipe.
 *
 * The validation pipe is a critical security and data-integrity gate.
 * It ensures all incoming request data is validated against Zod schemas
 * before reaching route handlers. Without it, handlers would receive
 * unvalidated input, leading to runtime errors or data corruption.
 *
 * These tests verify:
 * 1. Valid data passes through after Zod parsing
 * 2. Invalid data produces structured 400 errors with per-field details
 * 3. DTOs without schemas pass through unchanged (backward compatible)
 * 4. Zod transformations (e.g. .trim(), .default()) are applied
 *
 * @module @factory/control-plane
 */
import { ArgumentMetadata, BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ZodValidationPipe } from "./zod-validation.pipe.js";

/** Test DTO with a Zod schema attached as a static property. */
class CreateTaskDto {
  static schema = z.object({
    title: z.string().min(1, "Title is required"),
    priority: z.enum(["low", "medium", "high"]),
    description: z.string().optional(),
  });

  title!: string;
  priority!: string;
  description?: string;
}

/** Test DTO without a Zod schema — should pass through unchanged. */
class PlainDto {
  name!: string;
}

/** Test DTO with a transforming schema (trim + default). */
class TransformDto {
  static schema = z.object({
    name: z.string().trim(),
    active: z.boolean().default(true),
  });

  name!: string;
  active!: boolean;
}

describe("ZodValidationPipe", () => {
  const pipe = new ZodValidationPipe();

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- NestJS ArgumentMetadata.metatype uses Function
  const bodyMetadata = (metatype: Function): ArgumentMetadata => ({
    type: "body",
    metatype,
  });

  /**
   * Verifies that valid input matching the Zod schema passes through
   * successfully. This is the happy path — most requests should succeed.
   */
  it("should pass valid data through", () => {
    const input = { title: "Implement feature", priority: "high" };
    const result = pipe.transform(input, bodyMetadata(CreateTaskDto));

    expect(result).toEqual({ title: "Implement feature", priority: "high" });
  });

  /**
   * Verifies that invalid input is rejected with a BadRequestException.
   * The exception must contain structured validation details so clients
   * can display per-field error messages.
   */
  it("should throw BadRequestException for invalid data", () => {
    const input = { title: "", priority: "invalid" };

    expect(() => pipe.transform(input, bodyMetadata(CreateTaskDto))).toThrow(BadRequestException);
  });

  /**
   * Verifies that the validation error details include per-field messages.
   * Without this, clients cannot show users which specific field is wrong.
   */
  it("should include field-level error details", () => {
    const input = { title: "", priority: "invalid" };

    try {
      pipe.transform(input, bodyMetadata(CreateTaskDto));
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as Record<string, unknown>;
      expect(response["message"]).toBe("Validation failed");
      expect(response["details"]).toBeDefined();
      const details = response["details"] as Array<{ field: string; message: string }>;
      expect(details.length).toBeGreaterThan(0);
      expect(details.some((d) => d.field === "title")).toBe(true);
      expect(details.some((d) => d.field === "priority")).toBe(true);
    }
  });

  /**
   * Verifies that DTOs without a static schema property pass through
   * unchanged. This ensures backward compatibility — not every parameter
   * needs a Zod schema (e.g. route params handled by NestJS itself).
   */
  it("should pass through when DTO has no schema", () => {
    const input = { name: "test" };
    const result = pipe.transform(input, bodyMetadata(PlainDto));
    expect(result).toEqual({ name: "test" });
  });

  /**
   * Verifies that data passes through when no metatype is provided.
   * This handles cases like custom decorators or raw parameter access.
   */
  it("should pass through when metatype is undefined", () => {
    const input = { anything: true };
    const result = pipe.transform(input, { type: "body" });
    expect(result).toEqual({ anything: true });
  });

  /**
   * Verifies that Zod transformations (trim, default values) are applied
   * to the incoming data. This ensures the handler receives clean,
   * normalized data without needing manual transformations.
   */
  it("should apply Zod transformations", () => {
    const input = { name: "  padded  " };
    const result = pipe.transform(input, bodyMetadata(TransformDto)) as {
      name: string;
      active: boolean;
    };

    expect(result.name).toBe("padded");
    expect(result.active).toBe(true); // default applied
  });
});
