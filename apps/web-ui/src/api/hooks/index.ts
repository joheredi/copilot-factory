/**
 * Re-exports all API hooks from a single entry point.
 *
 * Feature views import hooks from `../api/hooks` rather than
 * reaching into individual hook files.
 *
 * @module
 */

export { useHealth } from "./use-health";

export {
  useProjects,
  useProject,
  useCreateProject,
  useUpdateProject,
  useDeleteProject,
} from "./use-projects";

export {
  useRepositories,
  useRepository,
  useCreateRepository,
  useUpdateRepository,
  useDeleteRepository,
} from "./use-repositories";

export {
  useTasks,
  useTask,
  useTaskTimeline,
  useCreateTask,
  useCreateTaskBatch,
  useUpdateTask,
  usePauseTask,
  useResumeTask,
  useRequeueTask,
  useForceUnblock,
  useChangePriority,
  useReassignPool,
  useRerunReview,
  useOverrideMergeOrder,
  useReopenTask,
  useCancelTask,
  useResolveEscalation,
} from "./use-tasks";

export {
  usePools,
  usePool,
  usePoolWorkers,
  useCreatePool,
  useUpdatePool,
  useDeletePool,
  useAgentProfiles,
  useAgentProfile,
  useCreateAgentProfile,
  useUpdateAgentProfile,
  useDeleteAgentProfile,
} from "./use-pools";

export { useAuditLog } from "./use-audit";

export {
  useReviewHistory,
  useReviewCyclePackets,
  useTaskArtifacts,
  usePacketContent,
  useMergeDetail,
} from "./use-reviews";

export { usePolicies, usePolicy, useEffectiveConfig, useUpdatePolicy } from "./use-policies";

export { useMergeQueue } from "./use-merge-queue";

export { useDiscoverTasks, useExecuteImport } from "./use-import";
