/**
 * @module workspace/node-fs
 * Production {@link FileSystem} implementation using Node.js `fs/promises`.
 */

import { mkdir, access } from "node:fs/promises";

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
  };
}
