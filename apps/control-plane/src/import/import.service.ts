/**
 * Service for task import discovery and execution.
 *
 * Implements both steps of the import pipeline:
 * 1. **Discovery** (read-only): accepts a local directory path, auto-detects
 *    format, runs parsers, and returns a preview.
 * 2. **Execution** (write): takes previewed tasks, auto-creates project/repo
 *    scaffolding, inserts tasks, and wires up dependency edges — all in a
 *    single atomic transaction.
 *
 * @module @factory/control-plane
 * @see T115 — Create POST /import/discover endpoint
 * @see T116 — Create POST /import/execute endpoint
 * @see {@link @factory/infrastructure!discoverMarkdownTasks} — markdown parser
 * @see {@link @factory/infrastructure!parseJsonTasks} — JSON parser
 */
import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import type { ImportManifest } from "@factory/schemas";
import {
  discoverMarkdownTasks,
  parseJsonTasks,
  classifyImportedTasks,
  createNodeFileSystem,
  type FileSystem,
  type TaskClassifier,
} from "@factory/infrastructure";
import { randomUUID } from "node:crypto";

import * as path from "node:path";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import { createProjectRepository } from "../infrastructure/repositories/project.repository.js";
import { createRepositoryRepository } from "../infrastructure/repositories/repository.repository.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { createTaskDependencyRepository } from "../infrastructure/repositories/task-dependency.repository.js";
import type { ExecuteRequestDto } from "./dtos/execute-request.dto.js";

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
 * Response shape for the execution endpoint.
 *
 * Summarises what was persisted to the database: which project and repository
 * were used, how many tasks were created vs skipped (dedup), and any
 * non-fatal errors encountered during dependency wiring.
 */
export interface ExecuteResponse {
  /** ID of the project (created or reused). */
  projectId: string;
  /** ID of the repository (created or reused). */
  repositoryId: string;
  /** Number of tasks newly created in this import. */
  created: number;
  /** Number of tasks skipped because their externalRef already existed. */
  skipped: number;
  /** Non-fatal errors encountered (e.g. unresolved dependency refs). */
  errors: string[];
}

/**
 * Service that orchestrates task discovery and import execution.
 *
 * The discovery flow:
 * 1. Validate that the path exists and is a readable directory
 * 2. Check for `backlog.json` — if found, use the JSON parser
 * 3. Otherwise, use the markdown parser to discover `.md` files
 * 4. Derive suggested project/repository names from the directory basename
 * 5. Return a preview manifest without touching the database
 *
 * The execution flow:
 * 1. Find or create a project by name
 * 2. Find or create a repository by name within the project
 * 3. Query existing tasks by externalRef to build a dedup skip set
 * 4. Insert non-duplicate tasks in BACKLOG status
 * 5. Wire up TaskDependency records from externalRef cross-references
 * 6. Return summary counts
 */
@Injectable()
export class ImportService {
  private readonly fs: FileSystem;
  private readonly conn: DatabaseConnection | null;
  private readonly classify: TaskClassifier;

  /**
   * @param conn Database connection for write operations (execute).
   *   Injected from the global {@link DatabaseModule}. Optional so the
   *   service can be instantiated without a database for discovery-only
   *   usage and for tests that only exercise the discover path.
   * @param fileSystem Optional injected filesystem for testability.
   *   Defaults to the real Node.js filesystem.
   * @param classifier Optional AI task classifier for type/status inference.
   *   Defaults to the built-in {@link classifyImportedTasks}.
   */
  constructor(
    @Optional() @Inject(DATABASE_CONNECTION) conn?: DatabaseConnection,
    @Optional() @Inject("FILE_SYSTEM") fileSystem?: FileSystem,
  ) {
    this.conn = conn ?? null;
    this.fs = fileSystem ?? createNodeFileSystem();
    this.classify = classifyImportedTasks;
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
      manifest = await discoverMarkdownTasks(resolvedPath, this.fs, this.classify);
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

  /**
   * Execute an import: persist discovered tasks to the database.
   *
   * All writes happen in a single SQLite transaction (BEGIN IMMEDIATE).
   * If any step fails, the entire import is rolled back — no partial data
   * is left behind. The method is idempotent with respect to `externalRef`:
   * tasks whose externalRef already exists in the target repository are
   * skipped rather than duplicated.
   *
   * Project and repository scaffolding is automatic: if no project with the
   * given name exists, one is created. Similarly for the repository within
   * that project.
   *
   * Dependency wiring is best-effort: if a dependency's externalRef does not
   * match any imported or existing task, a warning is emitted in the errors
   * array but the import continues.
   *
   * @param request Validated execution request with tasks and project/repo names.
   * @returns Summary with created/skipped counts and any non-fatal errors.
   * @throws BadRequestException if no database connection is available.
   */
  execute(request: ExecuteRequestDto): ExecuteResponse {
    if (!this.conn) {
      throw new BadRequestException("Database connection is required for import execution");
    }

    return this.conn.writeTransaction((db) => {
      const projectRepo = createProjectRepository(db);
      const repoRepo = createRepositoryRepository(db);
      const taskRepo = createTaskRepository(db);
      const depRepo = createTaskDependencyRepository(db);

      // ── 1. Find or create project ────────────────────────────────────
      let project = projectRepo.findByName(request.projectName);
      if (!project) {
        project = projectRepo.create({
          projectId: randomUUID(),
          name: request.projectName,
          owner: "imported",
        });
      }

      // ── 2. Find or create repository within the project ──────────────
      const repoName = request.repositoryName ?? request.projectName;
      const existingRepos = repoRepo.findByProjectId(project.projectId);
      let repository = existingRepos.find((r) => r.name === repoName);
      if (!repository) {
        const remoteUrl = request.repositoryUrl ?? `file://${request.path}`;
        repository = repoRepo.create({
          repositoryId: randomUUID(),
          projectId: project.projectId,
          name: repoName,
          remoteUrl,
          defaultBranch: "main",
          localCheckoutStrategy: "worktree",
          status: "active",
        });
      }

      // ── 3. Build dedup set from existing tasks ───────────────────────
      const existingTasks = taskRepo.findByRepositoryId(repository.repositoryId);
      const existingExternalRefs = new Set<string>();
      const externalRefToTaskId = new Map<string, string>();

      for (const t of existingTasks) {
        if (t.externalRef) {
          existingExternalRefs.add(t.externalRef);
          externalRefToTaskId.set(t.externalRef, t.taskId);
        }
      }

      // ── 4. Insert tasks ──────────────────────────────────────────────
      let created = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const importedTask of request.tasks) {
        if (importedTask.externalRef && existingExternalRefs.has(importedTask.externalRef)) {
          skipped++;
          continue;
        }

        const taskId = randomUUID();
        taskRepo.create({
          taskId,
          repositoryId: repository.repositoryId,
          title: importedTask.title,
          description: importedTask.description ?? null,
          taskType: importedTask.taskType,
          priority: importedTask.priority ?? "medium",
          source: "automated",
          status: importedTask.status ?? "BACKLOG",
          externalRef: importedTask.externalRef ?? null,
          acceptanceCriteria: importedTask.acceptanceCriteria ?? null,
          definitionOfDone: importedTask.definitionOfDone ?? null,
          estimatedSize: importedTask.estimatedSize ?? null,
          riskLevel: importedTask.riskLevel ?? null,
          suggestedFileScope: importedTask.suggestedFileScope ?? null,
        });

        if (importedTask.externalRef) {
          externalRefToTaskId.set(importedTask.externalRef, taskId);
        }
        created++;
      }

      // ── 5. Wire dependency edges ─────────────────────────────────────
      for (const importedTask of request.tasks) {
        if (!importedTask.dependencies?.length || !importedTask.externalRef) continue;

        const taskId = externalRefToTaskId.get(importedTask.externalRef);
        if (!taskId) continue;

        for (const depRef of importedTask.dependencies) {
          const depTaskId = externalRefToTaskId.get(depRef);
          if (!depTaskId) {
            errors.push(
              `Dependency "${depRef}" for task "${importedTask.externalRef}" not found — skipped`,
            );
            continue;
          }

          try {
            depRepo.create({
              taskDependencyId: randomUUID(),
              taskId,
              dependsOnTaskId: depTaskId,
              dependencyType: "blocks",
              isHardBlock: 1,
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(
              `Failed to create dependency ${importedTask.externalRef} → ${depRef}: ${msg}`,
            );
          }
        }
      }

      return {
        projectId: project.projectId,
        repositoryId: repository.repositoryId,
        created,
        skipped,
        errors,
      };
    });
  }
}
