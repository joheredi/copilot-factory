/**
 * Service for task import discovery.
 *
 * Implements the read-only discovery step of the import pipeline: accepts a
 * local directory path, auto-detects whether it contains markdown task files
 * or a backlog.json, runs the appropriate deterministic parser, and returns
 * a preview of discovered tasks without writing anything to the database.
 *
 * This is the backend for the `POST /import/discover` endpoint (T115).
 *
 * @module @factory/control-plane
 * @see T115 — Create POST /import/discover endpoint
 * @see {@link @factory/infrastructure!discoverMarkdownTasks} — markdown parser
 * @see {@link @factory/infrastructure!parseJsonTasks} — JSON parser
 */
import { BadRequestException, Injectable } from "@nestjs/common";
import type { ImportManifest } from "@factory/schemas";
import {
  discoverMarkdownTasks,
  parseJsonTasks,
  createNodeFileSystem,
  type FileSystem,
} from "@factory/infrastructure";

import * as path from "node:path";

/**
 * Response shape for the discovery endpoint.
 *
 * Extends the raw {@link ImportManifest} with suggested names derived from
 * the source path and detected format information.
 */
export interface DiscoverResponse {
  /** All tasks parsed from the source directory. */
  tasks: ImportManifest["tasks"];
  /** Warnings generated during parsing (field mapping issues, missing data, etc.). */
  warnings: ImportManifest["warnings"];
  /** Project name inferred from directory basename or source metadata. */
  suggestedProjectName: string;
  /** Repository name inferred from directory basename. */
  suggestedRepositoryName: string;
  /** Detected source format: `"markdown"`, `"json"`, or `"mixed"`. */
  format: string;
}

/**
 * Service that orchestrates task discovery from local filesystem paths.
 *
 * The discovery flow:
 * 1. Validate that the path exists and is a readable directory
 * 2. Check for `backlog.json` — if found, use the JSON parser
 * 3. Otherwise, use the markdown parser to discover `.md` files
 * 4. Derive suggested project/repository names from the directory basename
 * 5. Return a preview manifest without touching the database
 */
@Injectable()
export class ImportService {
  private readonly fs: FileSystem;

  /**
   * @param fileSystem Optional injected filesystem for testability.
   *   Defaults to the real Node.js filesystem.
   */
  constructor(fileSystem?: FileSystem) {
    this.fs = fileSystem ?? createNodeFileSystem();
  }

  /**
   * Discover importable tasks at the given filesystem path.
   *
   * Auto-detects format by checking for `backlog.json` first, then falling
   * back to markdown file discovery. Returns a preview with all parsed tasks,
   * any warnings, and suggested project/repository names derived from the path.
   *
   * @param inputPath - Absolute or relative filesystem path to scan.
   * @param _pattern  - Reserved for future glob filtering (currently unused).
   * @returns Discovery result with tasks, warnings, suggested names, and format.
   * @throws BadRequestException if the path does not exist or is not readable.
   */
  async discover(inputPath: string, _pattern?: string): Promise<DiscoverResponse> {
    const resolvedPath = path.resolve(inputPath);

    // ── Validate path exists ─────────────────────────────────────────────
    const pathExists = await this.fs.exists(resolvedPath);
    if (!pathExists) {
      throw new BadRequestException(`Path does not exist or is not readable: ${resolvedPath}`);
    }

    // ── Detect format and parse ──────────────────────────────────────────
    const backlogJsonPath = path.join(resolvedPath, "backlog.json");
    const hasBacklogJson = await this.fs.exists(backlogJsonPath);

    let manifest: ImportManifest;
    let format: string;

    if (hasBacklogJson) {
      manifest = await parseJsonTasks(backlogJsonPath, this.fs);
      format = "json";
    } else {
      manifest = await discoverMarkdownTasks(resolvedPath, this.fs);
      format = "markdown";
    }

    // ── Derive suggested names ───────────────────────────────────────────
    const dirBasename = path.basename(resolvedPath);
    const suggestedProjectName = manifest.discoveredProjectName ?? dirBasename;
    const suggestedRepositoryName = manifest.discoveredRepositoryName ?? dirBasename;

    return {
      tasks: manifest.tasks,
      warnings: manifest.warnings,
      suggestedProjectName,
      suggestedRepositoryName,
      format,
    };
  }
}
