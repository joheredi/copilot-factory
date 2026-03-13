/**
 * REST controller for task import operations.
 *
 * Exposes two endpoints:
 * - `POST /import/discover` — read-only preview of tasks found at a path
 * - `POST /import/execute` — write tasks to the database with project/repo scaffolding
 *
 * @module @factory/control-plane
 * @see T115 — Create POST /import/discover endpoint
 * @see T116 — Create POST /import/execute endpoint
 */
import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import { DiscoverRequestDto } from "./dtos/discover-request.dto.js";
import { ExecuteRequestDto } from "./dtos/execute-request.dto.js";
import { ImportService, type DiscoverResponse, type ExecuteResponse } from "./import.service.js";

/**
 * Handles HTTP requests for task import operations.
 *
 * The discovery endpoint is read-only: it scans a directory for task files,
 * parses them, and returns a preview. The execute endpoint takes the
 * previewed data and persists it to the database with automatic project
 * and repository scaffolding.
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

  /**
   * Execute an import: persist discovered tasks to the database.
   *
   * Takes the output from the discover endpoint (after user review) and
   * writes all tasks to the database in a single atomic transaction.
   * Automatically creates a project and repository if they don't exist.
   * Skips tasks whose externalRef already exists (idempotent re-import).
   *
   * @param dto Validated execution request with tasks and project/repo names.
   * @returns Summary with projectId, repositoryId, created/skipped counts, and errors.
   */
  @Post("execute")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Import discovered tasks into the database",
    description:
      "Persists previously discovered tasks to the database. Auto-creates " +
      "project and repository if needed. Skips tasks with duplicate externalRef " +
      "values. All writes are atomic — the entire import succeeds or rolls back.",
  })
  @ApiResponse({
    status: 200,
    description: "Tasks imported successfully.",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid request payload or database unavailable.",
  })
  execute(@Body() dto: ExecuteRequestDto): ExecuteResponse {
    return this.importService.execute(dto);
  }
}
