/**
 * TanStack Query hooks for review, artifact, and merge endpoints.
 *
 * @module
 */

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { queryKeys } from "../query-keys";
import type {
  ArtifactTree,
  MergeDetail,
  PacketContent,
  ReviewCyclePacketsResponse,
  ReviewHistoryResponse,
} from "../types";

/**
 * Fetches the complete review history for a task.
 *
 * Returns all review cycles with their statuses and lead decisions.
 *
 * @param taskId - Task UUID.
 */
export function useReviewHistory(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reviews.history(taskId ?? ""),
    queryFn: () => apiGet<ReviewHistoryResponse>(`/tasks/${taskId}/reviews`),
    enabled: !!taskId,
  });
}

/**
 * Fetches specialist packets and lead decision for a specific review cycle.
 *
 * @param taskId  - Task UUID.
 * @param cycleId - Review cycle identifier.
 */
export function useReviewCyclePackets(taskId: string | undefined, cycleId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reviews.cyclePackets(taskId ?? "", cycleId ?? ""),
    queryFn: () =>
      apiGet<ReviewCyclePacketsResponse>(`/tasks/${taskId}/reviews/${cycleId}/packets`),
    enabled: !!taskId && !!cycleId,
  });
}

/**
 * Fetches the artifact tree for a task.
 *
 * The tree organizes review packets, decisions, validations, and
 * merge items in a hierarchical structure.
 *
 * @param taskId - Task UUID.
 */
export function useTaskArtifacts(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reviews.artifacts(taskId ?? ""),
    queryFn: () => apiGet<ArtifactTree>(`/tasks/${taskId}/artifacts`),
    enabled: !!taskId,
  });
}

/**
 * Fetches the content of a specific review/artifact packet.
 *
 * @param taskId   - Task UUID.
 * @param packetId - Packet identifier.
 */
export function usePacketContent(taskId: string | undefined, packetId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reviews.packet(taskId ?? "", packetId ?? ""),
    queryFn: () => apiGet<PacketContent>(`/tasks/${taskId}/packets/${packetId}`),
    enabled: !!taskId && !!packetId,
  });
}

/**
 * Fetches merge queue details and validation runs for a task.
 *
 * @param taskId - Task UUID.
 */
export function useMergeDetail(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reviews.merge(taskId ?? ""),
    queryFn: () => apiGet<MergeDetail>(`/tasks/${taskId}/merge`),
    enabled: !!taskId,
  });
}
