/**
 * Centralized TanStack Query key factory.
 *
 * All query keys are defined here to ensure consistency across hooks
 * and to make cache invalidation predictable. Each entity family
 * exposes `all`, `lists`, `list(params)`, `details`, and `detail(id)`
 * keys following the TanStack Query key factory pattern.
 *
 * @example
 * ```ts
 * // Invalidate all task queries (lists + details):
 * queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
 *
 * // Invalidate only task lists (keeps details cached):
 * queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists() });
 *
 * // Invalidate a single task detail:
 * queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail("abc") });
 * ```
 *
 * @see https://tkdodo.eu/blog/effective-react-query-keys
 * @module
 */

import type {
  AuditListParams,
  MergeQueueListParams,
  PaginationParams,
  PoolListParams,
  TaskListParams,
} from "./types";

export const queryKeys = {
  /** Health check query key. */
  health: {
    all: ["health"] as const,
  },

  /** Project entity query keys. */
  projects: {
    all: ["projects"] as const,
    lists: (params?: PaginationParams) =>
      [...queryKeys.projects.all, "list", params ?? {}] as const,
    details: () => [...queryKeys.projects.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.projects.details(), id] as const,
  },

  /** Repository entity query keys (scoped under a project). */
  repositories: {
    all: ["repositories"] as const,
    lists: (projectId: string, params?: PaginationParams) =>
      [...queryKeys.repositories.all, "list", projectId, params ?? {}] as const,
    details: () => [...queryKeys.repositories.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.repositories.details(), id] as const,
  },

  /** Task entity query keys. */
  tasks: {
    all: ["tasks"] as const,
    lists: (params?: TaskListParams) => [...queryKeys.tasks.all, "list", params ?? {}] as const,
    details: () => [...queryKeys.tasks.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.tasks.details(), id] as const,
    timeline: (id: string, params?: PaginationParams) =>
      [...queryKeys.tasks.all, "timeline", id, params ?? {}] as const,
  },

  /** Worker pool entity query keys. */
  pools: {
    all: ["pools"] as const,
    lists: (params?: PoolListParams) => [...queryKeys.pools.all, "list", params ?? {}] as const,
    details: () => [...queryKeys.pools.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.pools.details(), id] as const,
    workers: (poolId: string) => [...queryKeys.pools.all, "workers", poolId] as const,
  },

  /** Agent profile query keys (scoped under a pool). */
  profiles: {
    all: ["profiles"] as const,
    lists: (poolId: string) => [...queryKeys.profiles.all, "list", poolId] as const,
    detail: (poolId: string, profileId: string) =>
      [...queryKeys.profiles.all, "detail", poolId, profileId] as const,
  },

  /** Review entity query keys (scoped under a task). */
  reviews: {
    all: ["reviews"] as const,
    history: (taskId: string) => [...queryKeys.reviews.all, "history", taskId] as const,
    cyclePackets: (taskId: string, cycleId: string) =>
      [...queryKeys.reviews.all, "packets", taskId, cycleId] as const,
    artifacts: (taskId: string) => [...queryKeys.reviews.all, "artifacts", taskId] as const,
    packet: (taskId: string, packetId: string) =>
      [...queryKeys.reviews.all, "packet", taskId, packetId] as const,
    merge: (taskId: string) => [...queryKeys.reviews.all, "merge", taskId] as const,
  },

  /** Audit log query keys. */
  audit: {
    all: ["audit"] as const,
    lists: (params?: AuditListParams) => [...queryKeys.audit.all, "list", params ?? {}] as const,
  },

  /** Policy query keys. */
  policies: {
    all: ["policies"] as const,
    lists: (params?: PaginationParams) =>
      [...queryKeys.policies.all, "list", params ?? {}] as const,
    detail: (id: string) => [...queryKeys.policies.all, "detail", id] as const,
    effective: () => [...queryKeys.policies.all, "effective"] as const,
  },

  /** Merge queue list query keys. */
  mergeQueue: {
    all: ["mergeQueue"] as const,
    lists: (params?: MergeQueueListParams) =>
      [...queryKeys.mergeQueue.all, "list", params ?? {}] as const,
  },

  /** Prompt template query keys. */
  promptTemplates: {
    all: ["promptTemplates"] as const,
    lists: (params?: { role?: string }) =>
      [...queryKeys.promptTemplates.all, "list", params ?? {}] as const,
    details: () => [...queryKeys.promptTemplates.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.promptTemplates.details(), id] as const,
  },

  /** Factory state (running/paused) query keys. */
  factoryState: {
    all: ["factoryState"] as const,
  },

  /** Task import pipeline query keys. */
  import: {
    all: ["import"] as const,
  },
} as const;
