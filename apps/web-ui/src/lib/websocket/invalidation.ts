/**
 * Maps incoming WebSocket events to TanStack Query cache invalidations.
 *
 * When the server broadcasts a domain event (e.g., a task state change),
 * this module determines which query keys should be invalidated so that
 * affected UI components automatically refetch fresh data. This is the
 * bridge between the real-time event stream and the query cache.
 *
 * The mapping is intentionally broad — invalidating at the entity-type
 * level (e.g., all task queries) rather than surgical single-key
 * invalidation. This ensures correctness: list queries, detail queries,
 * and related entities all get refreshed. TanStack Query's staleTime
 * and deduplication prevent excessive network requests.
 *
 * @see docs/prd/007-technical-architecture.md §7.7 — event architecture
 * @module @factory/web-ui/lib/websocket/invalidation
 */

import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../api/query-keys";
import type { FactoryEvent } from "./types";
import { EventChannel } from "./types";

/**
 * Mapping from event channel to the query key prefixes that should be
 * invalidated when an event arrives on that channel.
 *
 * Each channel may affect multiple query key families. For example,
 * a task state change may affect both the task list and the audit log.
 */
const CHANNEL_INVALIDATION_MAP: Record<EventChannel, readonly unknown[][]> = {
  [EventChannel.Tasks]: [queryKeys.tasks.all, queryKeys.reviews.all, queryKeys.audit.all],
  [EventChannel.Workers]: [queryKeys.pools.all, queryKeys.audit.all],
  [EventChannel.Queue]: [queryKeys.tasks.all, queryKeys.audit.all, queryKeys.mergeQueue.all],
};

/**
 * Event-type-specific invalidation overrides for fine-grained control.
 *
 * When a specific event type needs to invalidate additional query families
 * beyond the channel-level defaults, it is listed here. These are merged
 * with (not replacing) the channel-level invalidations.
 */
const EVENT_TYPE_EXTRA_INVALIDATIONS: Record<string, readonly unknown[][]> = {
  "task.state_changed": [queryKeys.pools.all],
  "merge_queue_item.state_changed": [queryKeys.reviews.all, queryKeys.mergeQueue.all],
};

/**
 * Returns the set of query key prefixes that should be invalidated for a
 * given factory event.
 *
 * Combines channel-level invalidations with any event-type-specific extras.
 * Returns deduplicated keys by reference equality.
 *
 * @param event - The incoming factory event
 * @returns Array of query key prefixes to invalidate
 */
export function getInvalidationKeys(event: FactoryEvent): readonly unknown[][] {
  const channelKeys = CHANNEL_INVALIDATION_MAP[event.channel] ?? [];
  const extraKeys = EVENT_TYPE_EXTRA_INVALIDATIONS[event.type] ?? [];

  if (extraKeys.length === 0) {
    return channelKeys;
  }

  // Deduplicate by reference equality
  const seen = new Set<unknown[]>(channelKeys);
  const merged = [...channelKeys];
  for (const key of extraKeys) {
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(key);
    }
  }
  return merged;
}

/**
 * Invalidates TanStack Query caches based on an incoming factory event.
 *
 * This is the main integration point between the WebSocket event stream
 * and the query cache. It determines which queries are affected by the
 * event and triggers invalidation, which causes active queries to refetch.
 *
 * @param queryClient - The TanStack QueryClient instance
 * @param event - The incoming factory event
 */
export function invalidateQueriesForEvent(queryClient: QueryClient, event: FactoryEvent): void {
  const keys = getInvalidationKeys(event);
  for (const queryKey of keys) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
