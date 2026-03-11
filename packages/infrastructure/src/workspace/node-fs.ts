/**
 * @module workspace/node-fs
 * Production {@link FileSystem} implementation using Node.js `fs/promises`.
 */

import { mkdir, access, writeFile, readFile, unlink, rename } from "node:fs/promises";

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
  };
}
