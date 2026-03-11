/**
 * Global exception filter that converts all thrown exceptions into
 * structured JSON error responses.
 *
 * Ensures every API error — whether from NestJS built-in exceptions,
 * Zod validation failures, or unexpected runtime errors — returns a
 * consistent shape that clients can programmatically handle.
 *
 * Response format:
 * ```json
 * {
 *   "statusCode": 400,
 *   "error": "Bad Request",
 *   "message": "Human-readable description",
 *   "details": [...],           // optional, e.g. validation errors
 *   "timestamp": "ISO 8601",
 *   "path": "/api/tasks"
 * }
 * ```
 *
 * @module @factory/control-plane
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";

/** Structured error response returned by all API error paths. */
export interface ErrorResponse {
  /** HTTP status code. */
  statusCode: number;
  /** HTTP status text (e.g. "Bad Request", "Internal Server Error"). */
  error: string;
  /** Human-readable error description. */
  message: string;
  /** Optional additional error details (e.g. validation field errors). */
  details?: unknown;
  /** ISO 8601 timestamp of when the error occurred. */
  timestamp: string;
  /** Request path that triggered the error. */
  path: string;
}

/** Map of HTTP status codes to their standard text labels. */
const HTTP_STATUS_TEXT: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: "Bad Request",
  [HttpStatus.UNAUTHORIZED]: "Unauthorized",
  [HttpStatus.FORBIDDEN]: "Forbidden",
  [HttpStatus.NOT_FOUND]: "Not Found",
  [HttpStatus.CONFLICT]: "Conflict",
  [HttpStatus.UNPROCESSABLE_ENTITY]: "Unprocessable Entity",
  [HttpStatus.TOO_MANY_REQUESTS]: "Too Many Requests",
  [HttpStatus.INTERNAL_SERVER_ERROR]: "Internal Server Error",
  [HttpStatus.SERVICE_UNAVAILABLE]: "Service Unavailable",
};

/**
 * Catches all exceptions and returns structured JSON errors.
 *
 * - {@link HttpException} instances preserve their status code and message.
 * - Unknown exceptions are mapped to 500 Internal Server Error with a
 *   generic message (to avoid leaking implementation details).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  /**
   * Transforms the caught exception into a structured {@link ErrorResponse}.
   *
   * @param exception - The thrown exception (may be HttpException or any Error).
   * @param host - NestJS arguments host providing access to the request/response.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();

    const { statusCode, message, details } = this.extractErrorInfo(exception);

    const errorResponse: ErrorResponse = {
      statusCode,
      error: HTTP_STATUS_TEXT[statusCode] ?? "Unknown Error",
      message,
      ...(details !== undefined && { details }),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    void reply.status(statusCode).send(errorResponse);
  }

  /**
   * Extracts status code, message, and optional details from an exception.
   *
   * NestJS HttpExceptions carry their own status and response body.
   * Unknown exceptions default to 500 with a safe generic message.
   */
  private extractErrorInfo(exception: unknown): {
    statusCode: number;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === "string") {
        return { statusCode: status, message: response };
      }

      if (typeof response === "object" && response !== null) {
        const resp = response as Record<string, unknown>;
        return {
          statusCode: status,
          message: typeof resp["message"] === "string" ? resp["message"] : exception.message,
          details: resp["details"] ?? resp["errors"],
        };
      }

      return { statusCode: status, message: exception.message };
    }

    // Unknown errors — return 500 with safe message
    if (exception instanceof Error) {
      console.error("Unhandled exception:", exception);
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "An unexpected error occurred",
    };
  }
}
