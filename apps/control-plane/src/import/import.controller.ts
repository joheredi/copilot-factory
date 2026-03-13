/**
 * REST controller for task import operations.
 *
 * Exposes the `POST /import/discover` endpoint that accepts a local
 * filesystem path, runs deterministic parsers, and returns a preview of
 * discovered tasks. This is a read-only operation — no data is written
 * to the database.
 *
 * @module @factory/control-plane
 * @see T115 — Create POST /import/discover endpoint
 */
import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import { DiscoverRequestDto } from "./dtos/discover-request.dto.js";
import { ImportService, type DiscoverResponse } from "./import.service.js";

/**
 * Handles HTTP requests for task import discovery.
 *
 * The discovery endpoint is intentionally read-only: it scans a directory
 * for task files, parses them, and returns a preview so the user can review
 * what will be imported before committing. The actual import (writing to the
 * database) is handled by a separate execute endpoint (T116).
 */
@ApiTags("import")
@Controller("import")
export class ImportController {
  /** @param importService Injected import service. */
  constructor(@Inject(ImportService) private readonly importService: ImportService) {}

  /**
   * Discover importable tasks at a local filesystem path.
   *
   * Scans the specified directory for task files (markdown or JSON),
   * auto-detects the format, runs the appropriate parser, and returns
   * a preview with all discovered tasks, warnings, and suggested names.
   *
   * @param dto Validated discovery request with `path` and optional `pattern`.
   * @returns Discovery result with tasks, warnings, suggested names, and format.
   */
  @Post("discover")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Discover importable tasks at a local path",
    description:
      "Scans the given directory for task files (markdown or backlog.json), " +
      "parses them, and returns a preview of discovered tasks without writing " +
      "to the database. Use this to preview before importing.",
  })
  @ApiResponse({
    status: 200,
    description: "Tasks discovered successfully.",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid path or path does not exist.",
  })
  async discover(@Body() dto: DiscoverRequestDto): Promise<DiscoverResponse> {
    return this.importService.discover(dto.path, dto.pattern);
  }
}
