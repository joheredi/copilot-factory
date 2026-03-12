/**
 * @module workspace/node-fs
 * Production {@link FileSystem} implementation using Node.js `fs/promises`.
 */

import { mkdir, access, writeFile, readFile, readdir, unlink, rename, rm } from "node:fs/promises";

import type { FileSystem } from "./types.js";

// ─── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a {@link FileSystem} implementation backed by Node.js `fs/promises`.
 * This is the default filesystem used by {@link WorkspaceManager} in production.
 *
 * @returns A FileSystem instance that operates on the real filesystem.
 */
export function createNodeFileSystem(): FileSystem {
  return {
    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      await mkdir(path, options);
    },

    async exists(path: string): Promise<boolean> {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },

    async writeFile(path: string, content: string): Promise<void> {
      await writeFile(path, content, "utf-8");
    },

    async readFile(path: string): Promise<string> {
      return await readFile(path, "utf-8");
    },

    async unlink(path: string): Promise<void> {
      try {
        await unlink(path);
      } catch (err: unknown) {
        // Ignore ENOENT — file already gone
        if (
          err instanceof Error &&
          "code" in err &&
          (err as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          return;
        }
        throw err;
      }
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      await rename(oldPath, newPath);
    },

    async readdir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
      try {
        const entries = await readdir(path, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        }));
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          "code" in err &&
          (err as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          return [];
        }
        throw err;
      }
    },

    async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
      try {
        await rm(path, {
          recursive: options?.recursive ?? false,
          force: options?.force ?? false,
        });
      } catch (err: unknown) {
        // Ignore ENOENT — path already gone
        if (
          err instanceof Error &&
          "code" in err &&
          (err as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          return;
        }
        throw err;
      }
    },
  };
}
