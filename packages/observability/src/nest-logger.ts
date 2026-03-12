import type { Logger } from "./logger.js";

/**
 * NestJS LoggerService interface.
 *
 * Defined here to avoid a hard dependency on `@nestjs/common`.
 * This matches the NestJS LoggerService contract so the adapter can be used
 * as a drop-in replacement via `app.useLogger(adapter)`.
 */
export interface NestLoggerService {
  log(message: string, context?: string): void;
  error(message: string, trace?: string, context?: string): void;
  warn(message: string, context?: string): void;
  debug?(message: string, context?: string): void;
  verbose?(message: string, context?: string): void;
}

/**
 * Adapts the structured {@link Logger} to the NestJS LoggerService interface.
 *
 * This allows the factory's structured logger to be used as NestJS's
 * application-wide logger, replacing the default console-based logger.
 * All NestJS framework logs (bootstrap, route registration, errors) will
 * flow through the structured JSON logger with correlation context.
 *
 * @example
 * ```ts
 * import { createLogger } from "@factory/observability";
 * import { NestLoggerAdapter } from "@factory/observability";
 *
 * const logger = createLogger("control-plane");
 * const app = await NestFactory.create(AppModule, {
 *   logger: new NestLoggerAdapter(logger),
 * });
 * ```
 *
 * @see docs/prd/007-technical-architecture.md §7.14 for the observability architecture.
 */
export class NestLoggerAdapter implements NestLoggerService {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Maps NestJS `log` (info-level) to structured logger `info`.
   * @param message - The log message.
   * @param context - Optional NestJS context string (e.g., class name).
   */
  log(message: string, context?: string): void {
    this.logger.info(message, context ? { nestContext: context } : undefined);
  }

  /**
   * Maps NestJS `error` to structured logger `error`.
   * Includes the stack trace as a separate field for structured querying.
   * @param message - The error message.
   * @param trace - Optional stack trace string.
   * @param context - Optional NestJS context string.
   */
  error(message: string, trace?: string, context?: string): void {
    const data: Record<string, unknown> = {};
    if (trace) data["trace"] = trace;
    if (context) data["nestContext"] = context;
    this.logger.error(message, Object.keys(data).length > 0 ? data : undefined);
  }

  /**
   * Maps NestJS `warn` to structured logger `warn`.
   * @param message - The warning message.
   * @param context - Optional NestJS context string.
   */
  warn(message: string, context?: string): void {
    this.logger.warn(message, context ? { nestContext: context } : undefined);
  }

  /**
   * Maps NestJS `debug` to structured logger `debug`.
   * @param message - The debug message.
   * @param context - Optional NestJS context string.
   */
  debug(message: string, context?: string): void {
    this.logger.debug(message, context ? { nestContext: context } : undefined);
  }

  /**
   * Maps NestJS `verbose` to structured logger `trace`.
   * NestJS "verbose" maps to pino "trace" as the most detailed level.
   * @param message - The verbose message.
   * @param context - Optional NestJS context string.
   */
  verbose(message: string, context?: string): void {
    this.logger.trace(message, context ? { nestContext: context } : undefined);
  }
}
