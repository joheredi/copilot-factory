/**
 * Custom hook that syncs audit explorer filter/pagination state with URL search params.
 *
 * Storing filter state in the URL enables shareable links — operators can
 * bookmark or share a filtered audit view with a colleague. The hook reads
 * initial values from the current URL and writes changes back via
 * React Router's `useSearchParams`.
 *
 * Supports: entityType, entityId, eventType, actorType, actorId filters,
 * time range (start/end), and page/limit pagination.
 *
 * @module
 * @see T100 — Build audit explorer view
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { AuditListParams } from "../../../api/types.js";

/** Full filter + pagination state exposed by the hook. */
export interface AuditFilterState {
  /** Current filter/pagination params ready for the API query. */
  readonly params: AuditListParams;
  /** Currently active entity type filter (empty string = all). */
  readonly entityTypeFilter: string;
  /** Currently active entity ID filter (empty string = all). */
  readonly entityIdFilter: string;
  /** Currently active event type filter (empty string = all). */
  readonly eventTypeFilter: string;
  /** Currently active actor type filter (empty string = all). */
  readonly actorTypeFilter: string;
  /** Currently active actor ID filter (empty string = all). */
  readonly actorIdFilter: string;
  /** Time range start (ISO string, empty = unbounded). */
  readonly startFilter: string;
  /** Time range end (ISO string, empty = unbounded). */
  readonly endFilter: string;
  /** Current page (1-based). */
  readonly page: number;
  /** Items per page. */
  readonly limit: number;
}

/** Actions to update the filter state. */
export interface AuditFilterActions {
  /** Set the entity type filter (empty string = all). */
  readonly setEntityType: (entityType: string) => void;
  /** Set the entity ID filter (empty string = all). */
  readonly setEntityId: (entityId: string) => void;
  /** Set the event type filter (empty string = all). */
  readonly setEventType: (eventType: string) => void;
  /** Set the actor type filter (empty string = all). */
  readonly setActorType: (actorType: string) => void;
  /** Set the actor ID filter (empty string = all). */
  readonly setActorId: (actorId: string) => void;
  /** Set the time range start (empty string = unbounded). */
  readonly setStart: (start: string) => void;
  /** Set the time range end (empty string = unbounded). */
  readonly setEnd: (end: string) => void;
  /** Navigate to a specific page. */
  readonly setPage: (page: number) => void;
  /** Change the items-per-page limit. */
  readonly setLimit: (limit: number) => void;
  /** Clear all filters and reset to page 1. */
  readonly clearAll: () => void;
}

const DEFAULT_LIMIT = 20;

/**
 * Hook that manages audit explorer filter and pagination state via URL search params.
 *
 * @returns Tuple of [state, actions] for reading and modifying filters.
 */
export function useAuditFilters(): [AuditFilterState, AuditFilterActions] {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo<AuditFilterState>(() => {
    const entityType = searchParams.get("entityType") ?? "";
    const entityId = searchParams.get("entityId") ?? "";
    const eventType = searchParams.get("eventType") ?? "";
    const actorType = searchParams.get("actorType") ?? "";
    const actorId = searchParams.get("actorId") ?? "";
    const start = searchParams.get("start") ?? "";
    const end = searchParams.get("end") ?? "";
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || DEFAULT_LIMIT));

    const params: AuditListParams = {
      page,
      limit,
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(eventType ? { eventType } : {}),
      ...(actorType ? { actorType } : {}),
      ...(actorId ? { actorId } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
    };

    return {
      params,
      entityTypeFilter: entityType,
      entityIdFilter: entityId,
      eventTypeFilter: eventType,
      actorTypeFilter: actorType,
      actorIdFilter: actorId,
      startFilter: start,
      endFilter: end,
      page,
      limit,
    };
  }, [searchParams]);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value) {
              next.set(key, value);
            } else {
              next.delete(key);
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const actions = useMemo<AuditFilterActions>(
    () => ({
      setEntityType: (entityType: string) => {
        updateParams({ entityType, page: "1" });
      },

      setEntityId: (entityId: string) => {
        updateParams({ entityId, page: "1" });
      },

      setEventType: (eventType: string) => {
        updateParams({ eventType, page: "1" });
      },

      setActorType: (actorType: string) => {
        updateParams({ actorType, page: "1" });
      },

      setActorId: (actorId: string) => {
        updateParams({ actorId, page: "1" });
      },

      setStart: (start: string) => {
        updateParams({ start, page: "1" });
      },

      setEnd: (end: string) => {
        updateParams({ end, page: "1" });
      },

      setPage: (page: number) => {
        updateParams({ page: String(page) });
      },

      setLimit: (limit: number) => {
        updateParams({ limit: String(limit), page: "1" });
      },

      clearAll: () => {
        setSearchParams({}, { replace: true });
      },
    }),
    [updateParams, setSearchParams],
  );

  return [state, actions];
}
