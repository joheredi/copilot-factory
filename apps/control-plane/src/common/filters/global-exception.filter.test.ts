/**
 * Tests for the global exception filter.
 *
 * The exception filter is the single point where all API errors are
 * normalized into a consistent JSON structure. If it breaks, clients
 * receive unpredictable error formats, making programmatic error handling
 * impossible. These tests verify:
 *
 * 1. NestJS HttpExceptions are correctly formatted
 * 2. Unknown errors produce safe 500 responses (no info leakage)
 * 3. The response always includes statusCode, error, message, timestamp, path
 *
 * @module @factory/control-plane
 */
import { BadRequestException, HttpStatus, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { ErrorResponse, GlobalExceptionFilter } from "./global-exception.filter.js";

/**
 * Creates a minimal mock of NestJS ArgumentsHost for testing the filter
 * without a real HTTP server. This avoids the overhead of bootstrapping
 * the full NestJS application for unit tests.
 */
function createMockHost(url: string = "/test") {
  let capturedStatus = 0;
  let capturedBody: ErrorResponse | undefined;

  const reply = {
    status(code: number) {
      capturedStatus = code;
      return reply;
    },
    send(body: ErrorResponse) {
      capturedBody = body;
      return reply;
    },
  };

  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ url }),
      getResponse: () => reply,
    }),
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Minimal mock that satisfies ArgumentsHost interface for testing
    host: host as any,
    getStatus: () => capturedStatus,
    getBody: () => capturedBody,
  };
}

describe("GlobalExceptionFilter", () => {
  const filter = new GlobalExceptionFilter();

  /**
   * Verifies that a standard NestJS NotFoundException is converted into
   * a structured 404 response. This is the most common error case —
   * clients request a resource that doesn't exist.
   */
  it("should handle HttpException with string response", () => {
    const { host, getStatus, getBody } = createMockHost("/api/tasks/999");
    const exception = new NotFoundException("Task not found");

    filter.catch(exception, host);

    expect(getStatus()).toBe(404);
    const body = getBody()!;
    expect(body.statusCode).toBe(404);
    expect(body.error).toBe("Not Found");
    expect(body.message).toBe("Task not found");
    expect(body.path).toBe("/api/tasks/999");
    expect(body.timestamp).toBeDefined();
  });

  /**
   * Verifies that BadRequestException with an object response (which is
   * how validation errors are typically thrown) preserves the details field.
   * This allows clients to display per-field validation messages.
   */
  it("should handle HttpException with object response containing details", () => {
    const { host, getStatus, getBody } = createMockHost("/api/tasks");
    const exception = new BadRequestException({
      message: "Validation failed",
      details: [{ field: "title", message: "Required" }],
    });

    filter.catch(exception, host);

    expect(getStatus()).toBe(400);
    const body = getBody()!;
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe("Bad Request");
    expect(body.message).toBe("Validation failed");
    expect(body.details).toEqual([{ field: "title", message: "Required" }]);
  });

  /**
   * Verifies that unknown errors (non-HttpException) produce a safe 500
   * response with a generic message. This prevents leaking stack traces,
   * database queries, or internal implementation details to API consumers.
   */
  it("should handle unknown errors with 500 and safe message", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, getStatus, getBody } = createMockHost("/api/dangerous");
    const exception = new Error("database connection refused");

    filter.catch(exception, host);

    expect(getStatus()).toBe(500);
    const body = getBody()!;
    expect(body.statusCode).toBe(500);
    expect(body.error).toBe("Internal Server Error");
    expect(body.message).toBe("An unexpected error occurred");
    // The real error message must NOT appear in the response
    expect(body.message).not.toContain("database");
    expect(body.details).toBeUndefined();

    consoleSpy.mockRestore();
  });

  /**
   * Verifies that non-Error values thrown (e.g. strings, numbers) are also
   * caught and converted to 500 responses. JavaScript allows throwing any
   * value, and the filter must handle all of them safely.
   */
  it("should handle non-Error exceptions safely", () => {
    const { host, getStatus, getBody } = createMockHost("/api/weird");

    filter.catch("some string error", host);

    expect(getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(getBody()!.message).toBe("An unexpected error occurred");
  });

  /**
   * Verifies that the timestamp in the error response is a valid ISO 8601
   * string. Clients use this for error correlation and debugging.
   */
  it("should include a valid ISO 8601 timestamp", () => {
    const { host, getBody } = createMockHost();
    filter.catch(new NotFoundException("gone"), host);

    const timestamp = getBody()!.timestamp;
    expect(Date.parse(timestamp)).not.toBeNaN();
  });
});
