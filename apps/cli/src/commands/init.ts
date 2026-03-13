/**
 * Factory init command — registers a project with the factory.
 *
 * Implements the complete `factory init` interactive flow:
 * 1. Checks for an existing `.copilot-factory.json` marker file
 * 2. Auto-detects project metadata (name, git remote, branch, owner)
 * 3. Displays detected values and prompts for any missing ones
 * 4. Ensures the factory home directory and runs DB migrations
 * 5. Creates or updates Project and Repository records in the database
 * 6. Optionally discovers and imports tasks from a local directory
 * 7. Writes/updates the `.copilot-factory.json` marker file
 * 8. Prints a summary with next steps
 *
 * The init command is fully idempotent — running it multiple times on the
 * same project updates metadata (owner, branch, etc.) without creating
 * duplicate records. Existing task imports are deduplicated by externalRef.
 *
 * All database writes are transactional — partial writes cannot occur.
 * Ctrl+C during prompts exits cleanly without side effects.
 *
 * @see {@link file://docs/backlog/tasks/T143-init-interactive-flow.md}
 * @see {@link file://docs/backlog/tasks/T144-init-idempotent.md}
 * @module @copilot/factory
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface, type Interface as ReadlineInterface } from "node:readline/promises";
import Database from "better-sqlite3";

import { detectAll, type ProjectMetadata } from "../detect.js";
import { ensureFactoryHome, getDbPath, getFactoryHome } from "../paths.js";
import { runMigrations, type MigrationResult } from "../migrate.js";
import { getMigrationsPath } from "../startup.js";

/** Name of the marker file written to the project root after registration. */
export const MARKER_FILENAME = ".copilot-factory.json";

/**
 * Shape of the `.copilot-factory.json` marker file written to the project root.
 *
 * This file links a local directory to a factory-registered project so that
 * subsequent `factory start` or `factory status` commands can identify the
 * project without re-prompting.
 */
export interface MarkerFile {
  /** UUID of the registered project in the factory database. */
  projectId: string;
  /** UUID of the registered repository, or `null` if no git remote was detected. */
  repositoryId: string | null;
  /** Absolute path to the factory home directory (e.g. `~/.copilot-factory`). */
  factoryHome: string;
}

/**
 * Result returned by {@link runInit} for composability and testing.
 */
export interface InitResult {
  /** UUID of the created (or existing) project. */
  projectId: string;
  /** UUID of the created repository, or `null` if no git remote was available. */
  repositoryId: string | null;
  /** Absolute path to the factory home directory. */
  factoryHome: string;
  /** Absolute path to the written marker file. */
  markerPath: string;
  /** Number of tasks imported (0 if skipped or no tasks found). */
  tasksImported: number;
}

/**
 * Discovered task shape matching the subset of {@link ImportedTask} fields
 * needed for database insertion.
 *
 * Kept as a standalone interface to avoid a hard compile-time dependency
 * on `@factory/schemas` — the infrastructure parsers are loaded dynamically.
 */
export interface DiscoveredTask {
  title: string;
  taskType: string;
  priority?: string;
  description?: string;
  externalRef?: string;
  source?: string;
  acceptanceCriteria?: string[];
  definitionOfDone?: string;
  estimatedSize?: string;
  riskLevel?: string;
  suggestedFileScope?: string[];
}

/**
 * Discovery result shape returned by the task import discoverer.
 */
export interface DiscoveryResult {
  tasks: DiscoveredTask[];
  warnings: Array<{ message: string }>;
}

/**
 * Injectable dependencies for {@link runInit}.
 *
 * Every field is optional — production code uses real implementations by
 * default. Tests inject fakes for deterministic behavior without filesystem
 * or database side effects.
 */
export interface InitDeps {
  /** Prompt function replacing readline for testing. */
  prompt?: (question: string) => Promise<string>;
  /** Logger replacing console.log for output capture in tests. */
  log?: (...args: unknown[]) => void;
  /** Override path to Drizzle migration SQL files. */
  migrationsPath?: string;
  /** Override project metadata detection. */
  detect?: (cwd: string) => ProjectMetadata;
  /** Override file writing (for marker file). */
  writeFile?: (path: string, content: string) => void;
  /** Override file reading (for existing marker file). */
  readFile?: (path: string) => string | null;
  /** Override file existence check (for existing marker file). */
  fileExists?: (path: string) => boolean;
  /** Override factory home directory creation. */
  ensureHome?: () => void;
  /** Override migration runner. */
  runMigrate?: (dbPath: string, migrationsFolder: string) => Promise<MigrationResult>;
  /** Override database path resolution. */
  getDbPath?: () => string;
  /** Override factory home path resolution. */
  getFactoryHome?: () => string;
  /** Override better-sqlite3 database constructor. */
  openDb?: (dbPath: string) => Database.Database;
  /** Override task discovery for import testing. */
  discoverTasks?: (inputPath: string) => Promise<DiscoveryResult>;
}

/**
 * Run the complete `factory init` interactive flow.
 *
 * This is the main entry point for the init command. It orchestrates
 * detection, prompting, database setup, record creation, optional task
 * import, and marker file writing.
 *
 * @param cwd - Absolute path to the project root directory.
 * @param deps - Injectable dependencies for testing.
 * @returns Result describing what was created.
 * @throws {Error} If project name or owner is empty after prompting,
 *   or if database operations fail irrecoverably.
 */
export async function runInit(cwd: string, deps: InitDeps = {}): Promise<InitResult> {
  const log = deps.log ?? console.log;
  const detectFn = deps.detect ?? detectAll;
  const ensureHomeFn = deps.ensureHome ?? ensureFactoryHome;
  const migrateFn = deps.runMigrate ?? runMigrations;
  const migrationsPath = deps.migrationsPath ?? getMigrationsPath();
  const dbPathFn = deps.getDbPath ?? getDbPath;
  const factoryHomeFn = deps.getFactoryHome ?? getFactoryHome;
  const writeFn = deps.writeFile ?? ((p: string, c: string) => writeFileSync(p, c, "utf-8"));
  const readFileFn =
    deps.readFile ??
    ((p: string): string | null => {
      try {
        return readFileSync(p, "utf-8");
      } catch {
        return null;
      }
    });
  const fileExistsFn = deps.fileExists ?? existsSync;
  const openDbFn = deps.openDb ?? ((path: string) => new Database(path));

  // ── Step 0: Check for existing marker file ──────────────────────────
  const markerPath = join(cwd, MARKER_FILENAME);
  let existingMarker: MarkerFile | null = null;
  if (fileExistsFn(markerPath)) {
    const raw = readFileFn(markerPath);
    if (raw) {
      try {
        existingMarker = JSON.parse(raw) as MarkerFile;
      } catch {
        // Corrupted marker file — ignore and proceed as fresh init.
      }
    }
  }

  // Create readline interface upfront if no prompt function is injected.
  // Closed in the finally block to ensure cleanup on Ctrl+C.
  let rl: ReadlineInterface | null = null;
  if (!deps.prompt) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
  }
  const promptFn = deps.prompt ?? ((question: string): Promise<string> => rl!.question(question));

  try {
    // ── Step 1: Detect project metadata ────────────────────────────────
    const metadata = detectFn(cwd);

    // ── Step 2: Display detected values ────────────────────────────────
    log("");
    log("  Autonomous Software Factory — Project Init");
    log("");

    if (metadata.projectName) {
      log(`  ✓ Project name:   ${metadata.projectName}`);
    }
    if (metadata.gitRemoteUrl) {
      log(`  ✓ Git remote:     ${metadata.gitRemoteUrl}`);
    }
    if (metadata.defaultBranch) {
      log(`  ✓ Default branch: ${metadata.defaultBranch}`);
    }
    if (metadata.owner) {
      log(`  ✓ Owner:          ${metadata.owner}`);
    }
    log("");

    // ── Step 3: Prompt for missing values ──────────────────────────────
    const projectName = metadata.projectName ?? (await promptFn("  ? Project name: "));
    const owner = metadata.owner ?? (await promptFn("  ? Owner: "));
    const gitRemoteUrl = metadata.gitRemoteUrl;
    const defaultBranch = metadata.defaultBranch ?? "main";

    if (!projectName || projectName.trim().length === 0) {
      throw new Error("Project name is required");
    }
    if (!owner || owner.trim().length === 0) {
      throw new Error("Owner is required");
    }

    const trimmedName = projectName.trim();
    const trimmedOwner = owner.trim();

    // ── Step 4: Ensure factory home + run migrations ───────────────────
    log("  ⏳ Setting up factory...");
    ensureHomeFn();

    const dbPath = dbPathFn();
    const migrationResult = await migrateFn(dbPath, migrationsPath);
    if (migrationResult.applied > 0) {
      log(`  ✅ Applied ${migrationResult.applied} migration(s)`);
    } else {
      log("  ✅ Database is up to date");
    }

    // ── Step 5: Create or update project and repository records ────────
    const db = openDbFn(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");

    const projectId = existingMarker?.projectId ?? randomUUID();
    const repositoryId = gitRemoteUrl ? (existingMarker?.repositoryId ?? randomUUID()) : null;

    try {
      const { actualProjectId, actualRepositoryId, tasksImported } = createRecords(db, {
        projectId,
        trimmedName,
        trimmedOwner,
        gitRemoteUrl,
        defaultBranch,
        repositoryId,
        existingMarker,
        log,
        promptFn,
        deps,
      });

      // ── Step 6: Optional task import ───────────────────────────────────
      let importCount = tasksImported;
      if (actualRepositoryId && gitRemoteUrl) {
        importCount = await handleTaskImport(db, actualRepositoryId, promptFn, deps, log);
      }

      // ── Step 7: Write marker file ──────────────────────────────────────
      const factoryHome = factoryHomeFn();
      const marker: MarkerFile = {
        projectId: actualProjectId,
        repositoryId: actualRepositoryId,
        factoryHome,
      };
      writeFn(markerPath, JSON.stringify(marker, null, 2) + "\n");
      log(`  ✅ Wrote ${MARKER_FILENAME}`);

      // ── Step 8: Print summary ──────────────────────────────────────────
      log("");
      log("  ── Summary ──────────────────────────────────────");
      log(`  Project:    ${trimmedName}`);
      if (gitRemoteUrl) {
        log(`  Repository: ${extractRepoName(gitRemoteUrl) ?? gitRemoteUrl}`);
      }
      if (importCount > 0) {
        log(`  Tasks:      ${importCount} imported`);
      }
      log(`  Marker:     ${markerPath}`);
      log("");
      log("  Next steps:");
      log("    npx @copilot/factory start");
      log("");

      return {
        projectId: actualProjectId,
        repositoryId: actualRepositoryId,
        factoryHome,
        markerPath,
        tasksImported: importCount,
      };
    } finally {
      db.close();
    }
  } finally {
    if (rl) {
      rl.close();
    }
  }
}

/**
 * Parameters for {@link createRecords}.
 * @internal
 */
interface CreateRecordsParams {
  projectId: string;
  trimmedName: string;
  trimmedOwner: string;
  gitRemoteUrl: string | null;
  defaultBranch: string;
  repositoryId: string | null;
  existingMarker: MarkerFile | null;
  log: (...args: unknown[]) => void;
  promptFn: (question: string) => Promise<string>;
  deps: InitDeps;
}

/**
 * Creates or updates project and repository records in a single transaction.
 *
 * When a `.copilot-factory.json` marker file was found, the function first
 * tries to locate existing records by their stored IDs. If found, metadata
 * is updated in place. If not found (e.g. the DB was reset), falls through
 * to normal INSERT logic.
 *
 * Without a marker file, uses `ON CONFLICT (name) DO NOTHING` for the
 * project to provide basic idempotency, and catches UNIQUE constraint
 * errors for the repository.
 *
 * @param db - Open better-sqlite3 database connection.
 * @param params - Record creation parameters.
 * @returns The actual project and repository IDs (may differ from input if
 *   records already existed).
 * @internal
 */
function createRecords(
  db: Database.Database,
  params: CreateRecordsParams,
): { actualProjectId: string; actualRepositoryId: string | null; tasksImported: number } {
  const {
    projectId,
    trimmedName,
    trimmedOwner,
    gitRemoteUrl,
    defaultBranch,
    repositoryId,
    existingMarker,
    log,
  } = params;

  // ── Project: update or insert ─────────────────────────────────────
  let actualProjectId: string;

  if (existingMarker?.projectId) {
    // Try to find the project by its stored ID first.
    const existing = db
      .prepare("SELECT project_id, name FROM project WHERE project_id = ?")
      .get(existingMarker.projectId) as { project_id: string; name: string } | undefined;

    if (existing) {
      // Update metadata on re-run.
      db.prepare(`UPDATE project SET owner = ?, updated_at = unixepoch() WHERE project_id = ?`).run(
        trimmedOwner,
        existing.project_id,
      );
      actualProjectId = existing.project_id;
      log(`  ℹ️  Project "${trimmedName}" already registered, updating...`);
    } else {
      // Marker refers to a project that no longer exists (DB was reset).
      actualProjectId = insertProject(db, projectId, trimmedName, trimmedOwner, log);
    }
  } else {
    // No marker file — use INSERT with conflict handling.
    actualProjectId = insertProject(db, projectId, trimmedName, trimmedOwner, log);
  }

  // ── Repository: update or insert ──────────────────────────────────
  let actualRepositoryId = repositoryId;

  if (gitRemoteUrl && repositoryId) {
    const repoName = extractRepoName(gitRemoteUrl) ?? trimmedName;

    if (existingMarker?.repositoryId) {
      // Try to find the repository by its stored ID first.
      const existing = db
        .prepare("SELECT repository_id FROM repository WHERE repository_id = ?")
        .get(existingMarker.repositoryId) as { repository_id: string } | undefined;

      if (existing) {
        // Update metadata on re-run.
        db.prepare(
          `UPDATE repository SET name = ?, remote_url = ?, default_branch = ?,
           updated_at = unixepoch() WHERE repository_id = ?`,
        ).run(repoName, gitRemoteUrl, defaultBranch, existing.repository_id);
        actualRepositoryId = existing.repository_id;
        log(`  ℹ️  Repository "${repoName}" already registered, updating...`);
      } else {
        // Marker refers to a repo that no longer exists. Fall through to INSERT.
        actualRepositoryId = insertRepository(
          db,
          repositoryId,
          actualProjectId,
          repoName,
          gitRemoteUrl,
          defaultBranch,
          log,
        );
      }
    } else {
      // No marker — try to find by remote_url under this project, then INSERT.
      const existingByUrl = db
        .prepare("SELECT repository_id FROM repository WHERE project_id = ? AND remote_url = ?")
        .get(actualProjectId, gitRemoteUrl) as { repository_id: string } | undefined;

      if (existingByUrl) {
        db.prepare(
          `UPDATE repository SET name = ?, default_branch = ?,
           updated_at = unixepoch() WHERE repository_id = ?`,
        ).run(repoName, defaultBranch, existingByUrl.repository_id);
        actualRepositoryId = existingByUrl.repository_id;
        log(`  ℹ️  Repository "${repoName}" already registered, updating...`);
      } else {
        actualRepositoryId = insertRepository(
          db,
          repositoryId,
          actualProjectId,
          repoName,
          gitRemoteUrl,
          defaultBranch,
          log,
        );
      }
    }
  }

  return { actualProjectId, actualRepositoryId, tasksImported: 0 };
}

/**
 * Inserts a new project record, handling name conflicts gracefully.
 *
 * Uses `ON CONFLICT (name) DO NOTHING` so that re-running init on a project
 * whose marker file was lost still works — the existing project is found by
 * name and its ID is returned.
 *
 * @param db - Open better-sqlite3 database connection.
 * @param projectId - UUID to use for the new project.
 * @param name - Project name (unique constraint).
 * @param owner - Project owner.
 * @param log - Logger function.
 * @returns The actual project ID (may differ from input if a conflict was hit).
 * @internal
 */
function insertProject(
  db: Database.Database,
  projectId: string,
  name: string,
  owner: string,
  log: (...args: unknown[]) => void,
): string {
  const stmt = db.prepare(
    `INSERT INTO project (project_id, name, owner, created_at, updated_at)
     VALUES (?, ?, ?, unixepoch(), unixepoch())
     ON CONFLICT (name) DO NOTHING`,
  );

  const result = stmt.run(projectId, name, owner);

  if (result.changes === 0) {
    const existing = db.prepare("SELECT project_id FROM project WHERE name = ?").get(name) as
      | { project_id: string }
      | undefined;
    if (existing) {
      // Also update the owner in case it changed.
      db.prepare(`UPDATE project SET owner = ?, updated_at = unixepoch() WHERE project_id = ?`).run(
        owner,
        existing.project_id,
      );
      log(`  ℹ️  Project "${name}" already registered, updating...`);
      return existing.project_id;
    }
  } else {
    log(`  ✅ Created project: ${name}`);
  }

  return projectId;
}

/**
 * Inserts a new repository record, catching UNIQUE constraint violations.
 *
 * @param db - Open better-sqlite3 database connection.
 * @param repositoryId - UUID to use for the new repository.
 * @param projectId - UUID of the parent project.
 * @param name - Human-readable repository name.
 * @param remoteUrl - Git remote URL.
 * @param defaultBranch - Default branch name.
 * @param log - Logger function.
 * @returns The actual repository ID, or `null` if a conflict prevented insertion.
 * @internal
 */
function insertRepository(
  db: Database.Database,
  repositoryId: string,
  projectId: string,
  name: string,
  remoteUrl: string,
  defaultBranch: string,
  log: (...args: unknown[]) => void,
): string | null {
  const stmt = db.prepare(
    `INSERT INTO repository (repository_id, project_id, name, remote_url, default_branch,
                             local_checkout_strategy, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
  );

  try {
    stmt.run(repositoryId, projectId, name, remoteUrl, defaultBranch, "worktree", "active");
    log(`  ✅ Created repository: ${name}`);
    return repositoryId;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      log("  ℹ️  Repository already exists");
      return null;
    }
    throw err;
  }
}

/**
 * Handles the optional task import prompt and execution.
 *
 * Prompts the user for a directory path containing task files. If a path
 * is provided, discovers tasks using the infrastructure parsers (markdown
 * or JSON format) and inserts them into the task table.
 *
 * @param db - Open better-sqlite3 database connection.
 * @param repositoryId - UUID of the repository to associate tasks with.
 * @param promptFn - Function to prompt the user for input.
 * @param deps - Injectable dependencies.
 * @param log - Logger function.
 * @returns Number of tasks successfully imported.
 * @internal
 */
async function handleTaskImport(
  db: Database.Database,
  repositoryId: string,
  promptFn: (question: string) => Promise<string>,
  deps: InitDeps,
  log: (...args: unknown[]) => void,
): Promise<number> {
  const importPath = await promptFn(
    "  ? Import tasks from local directory? (path or Enter to skip): ",
  );

  if (!importPath || importPath.trim().length === 0) {
    return 0;
  }

  return importTasks(db, repositoryId, importPath.trim(), deps, log);
}

/**
 * Discovers and imports tasks from a local directory into the database.
 *
 * Uses `@factory/infrastructure` parsers to discover tasks in either
 * markdown or JSON format. Each discovered task is inserted into the
 * `task` table within a transaction for atomicity.
 *
 * @param db - Open better-sqlite3 database connection.
 * @param repositoryId - UUID of the repository to associate tasks with.
 * @param inputPath - Path to the directory containing task files.
 * @param deps - Injectable dependencies (may provide a custom discoverer).
 * @param log - Logger function.
 * @returns Number of tasks successfully inserted.
 * @internal
 */
async function importTasks(
  db: Database.Database,
  repositoryId: string,
  inputPath: string,
  deps: InitDeps,
  log: (...args: unknown[]) => void,
): Promise<number> {
  try {
    const discoverFn = deps.discoverTasks ?? (await loadDefaultDiscoverer());
    const result = await discoverFn(inputPath);

    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        log(`  ⚠️  ${w.message}`);
      }
    }

    if (result.tasks.length === 0) {
      log("  ℹ️  No tasks found at the given path");
      return 0;
    }

    const insertTask = db.prepare(
      `INSERT INTO task (
         task_id, repository_id, external_ref, title, description,
         task_type, priority, status, source,
         acceptance_criteria, definition_of_done,
         estimated_size, risk_level, suggested_file_scope,
         created_at, updated_at
       ) VALUES (
         ?, ?, ?, ?, ?,
         ?, ?, 'pending', ?,
         ?, ?,
         ?, ?, ?,
         unixepoch(), unixepoch()
       )`,
    );

    const insertMany = db.transaction((tasks: DiscoveredTask[]) => {
      let count = 0;
      for (const task of tasks) {
        insertTask.run(
          randomUUID(),
          repositoryId,
          task.externalRef ?? null,
          task.title,
          task.description ?? null,
          task.taskType,
          task.priority ?? "medium",
          task.source ?? "import",
          task.acceptanceCriteria ? JSON.stringify(task.acceptanceCriteria) : null,
          task.definitionOfDone ? JSON.stringify(task.definitionOfDone) : null,
          task.estimatedSize ?? null,
          task.riskLevel ?? null,
          task.suggestedFileScope ? JSON.stringify(task.suggestedFileScope) : null,
        );
        count++;
      }
      return count;
    });

    const imported = insertMany(result.tasks);
    log(`  ✅ Imported ${imported} task(s)`);
    return imported;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(`  ⚠️  Task import failed: ${message}`);
    return 0;
  }
}

/**
 * Dynamically loads the default task discoverer from `@factory/infrastructure`.
 *
 * Uses dynamic `import()` to avoid a hard compile-time dependency on
 * `@factory/infrastructure` at module load time. This keeps the init
 * command lightweight when task import is not used.
 *
 * @returns A discovery function matching the {@link InitDeps.discoverTasks} signature.
 * @internal
 */
async function loadDefaultDiscoverer(): Promise<(inputPath: string) => Promise<DiscoveryResult>> {
  const { discoverMarkdownTasks, parseJsonTasks, createNodeFileSystem } =
    await import("@factory/infrastructure");
  const { resolve: pathResolve, join: pathJoin } = await import("node:path");
  const fs = createNodeFileSystem();

  return async (inputPath: string): Promise<DiscoveryResult> => {
    const resolvedPath = pathResolve(inputPath);

    const pathExists = await fs.exists(resolvedPath);
    if (!pathExists) {
      throw new Error(`Path does not exist: ${resolvedPath}`);
    }

    const backlogJsonPath = pathJoin(resolvedPath, "backlog.json");
    const hasBacklogJson = await fs.exists(backlogJsonPath);

    if (hasBacklogJson) {
      return parseJsonTasks(backlogJsonPath, fs);
    }
    return discoverMarkdownTasks(resolvedPath, fs);
  };
}

/**
 * Extracts a human-readable repository name from a git remote URL.
 *
 * Handles both HTTPS and SSH URL formats:
 * - `https://github.com/owner/repo.git` → `"repo"`
 * - `git@github.com:owner/repo.git` → `"repo"`
 * - `https://github.com/owner/repo` → `"repo"`
 *
 * @param remoteUrl - Git remote URL to parse.
 * @returns Extracted repository name, or `null` if parsing fails.
 */
export function extractRepoName(remoteUrl: string): string | null {
  // Handle SSH format: git@host:owner/repo.git
  const sshMatch = remoteUrl.match(/:([^/]+\/)?([^/]+?)(?:\.git)?$/);
  if (sshMatch?.[2]) {
    return sshMatch[2];
  }
  // Handle HTTPS format: https://host/owner/repo.git
  const httpsMatch = remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
  return httpsMatch?.[1] ?? null;
}
