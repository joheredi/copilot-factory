/**
 * TanStack Query hooks for Task CRUD and operator action operations.
 *
 * Tasks are the central entity in the Factory. These hooks cover:
 * - List/detail queries with filtering
 * - Task creation (single and batch)
 * - Task updates with optimistic concurrency
 * - Operator actions (pause, resume, cancel, etc.)
 * - Task timeline (audit events for a specific task)
 *
 * @module
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "../client";
import { queryKeys } from "../query-keys";
import type {
  CancelTaskInput,
  ChangePriorityInput,
  CreateTaskInput,
  OperatorActionInput,
  OperatorActionResult,
  OverrideMergeOrderInput,
  PaginatedResponse,
  PaginationParams,
  ReassignPoolInput,
  ResolveEscalationInput,
  Task,
  TaskDetail,
  TaskListParams,
  UpdateTaskInput,
  AuditEvent,
} from "../types";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetches a paginated, filterable list of tasks.
 *
 * @param params - Filter and pagination parameters.
 * @returns TanStack Query result with a paginated task list.
 */
export function useTasks(params?: TaskListParams) {
  return useQuery({
    queryKey: queryKeys.tasks.lists(params),
    queryFn: () => apiGet<PaginatedResponse<Task>>("/tasks", params as Record<string, unknown>),
  });
}

/**
 * Fetches a single task by ID (enriched detail view).
 *
 * Returns the task with current lease, review cycle, dependencies,
 * and dependents. Disabled when `id` is falsy for conditional usage.
 *
 * @param id - Task UUID.
 */
export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.tasks.detail(id ?? ""),
    queryFn: () => apiGet<TaskDetail>(`/tasks/${id}`),
    enabled: !!id,
  });
}

/**
 * Fetches the audit event timeline for a specific task.
 *
 * @param taskId - Task UUID.
 * @param params - Pagination parameters.
 */
export function useTaskTimeline(taskId: string | undefined, params?: PaginationParams) {
  return useQuery({
    queryKey: queryKeys.tasks.timeline(taskId ?? "", params),
    queryFn: () =>
      apiGet<PaginatedResponse<AuditEvent>>(
        `/tasks/${taskId}/timeline`,
        params as Record<string, unknown>,
      ),
    enabled: !!taskId,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Creates a single task.
 *
 * Invalidates task list queries on success.
 */
export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => apiPost<Task>("/tasks", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

/**
 * Creates multiple tasks in a single atomic transaction.
 *
 * Invalidates task list queries on success.
 */
export function useCreateTaskBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inputs: CreateTaskInput[]) => apiPost<Task[]>("/tasks/batch", inputs),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

/**
 * Updates a task's mutable fields.
 *
 * Requires `version` in the input for optimistic concurrency control.
 * Invalidates all task queries on success so both lists and detail
 * views reflect the change.
 */
export function useUpdateTask(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTaskInput) => apiPut<Task>(`/tasks/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Operator Actions
// ---------------------------------------------------------------------------

/** Helper that creates a mutation hook for a specific operator action endpoint. */
function useOperatorAction<TInput extends OperatorActionInput = OperatorActionInput>(
  taskId: string,
  action: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) =>
      apiPost<OperatorActionResult>(`/tasks/${taskId}/actions/${action}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
    },
  });
}

/** Pause a task (moves to ESCALATED). */
export function usePauseTask(taskId: string) {
  return useOperatorAction(taskId, "pause");
}

/** Resume an escalated task (moves to ASSIGNED). */
export function useResumeTask(taskId: string) {
  return useOperatorAction(taskId, "resume");
}

/** Requeue a task (moves to READY). */
export function useRequeueTask(taskId: string) {
  return useOperatorAction(taskId, "requeue");
}

/** Force-unblock a blocked task (moves to READY). */
export function useForceUnblock(taskId: string) {
  return useOperatorAction(taskId, "force-unblock");
}

/** Change a task's priority. */
export function useChangePriority(taskId: string) {
  return useOperatorAction<ChangePriorityInput>(taskId, "change-priority");
}

/** Reassign a task to a different worker pool. */
export function useReassignPool(taskId: string) {
  return useOperatorAction<ReassignPoolInput>(taskId, "reassign-pool");
}

/** Rerun the review cycle for a task. */
export function useRerunReview(taskId: string) {
  return useOperatorAction(taskId, "rerun-review");
}

/** Override a task's position in the merge queue. */
export function useOverrideMergeOrder(taskId: string) {
  return useOperatorAction<OverrideMergeOrderInput>(taskId, "override-merge-order");
}

/** Reopen a completed/failed/cancelled task. */
export function useReopenTask(taskId: string) {
  return useOperatorAction(taskId, "reopen");
}

/** Cancel a task. */
export function useCancelTask(taskId: string) {
  return useOperatorAction<CancelTaskInput>(taskId, "cancel");
}

/** Resolve an escalated task. */
export function useResolveEscalation(taskId: string) {
  return useOperatorAction<ResolveEscalationInput>(taskId, "resolve-escalation");
}
