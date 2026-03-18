/**
 * Hook for streaming or fetching worker output for a task.
 *
 * When an active worker is running (`workerId` is present), subscribes
 * to the `workers:{workerId}` WebSocket room and accumulates incoming
 * `worker.output` events in real time.
 *
 * When no worker is active (`workerId` is null/undefined), fetches
 * persisted logs from `GET /tasks/:taskId/logs`.
 *
 * @module @factory/web-ui/features/task-detail/useWorkerOutput
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useWebSocket } from "../../lib/websocket/use-websocket.js";
import { apiGet } from "../../api/client.js";
import { EventChannel } from "../../lib/websocket/types.js";
import type { FactoryEvent } from "../../lib/websocket/types.js";

/** A single chunk of worker output (stdout or stderr). */
export interface OutputChunk {
  stream: string;
  content: string;
  timestamp: string;
}

/** Return value of {@link useWorkerOutput}. */
export interface UseWorkerOutputResult {
  /** Accumulated output chunks, in arrival order. */
  lines: OutputChunk[];
  /** True when streaming from a live WebSocket subscription. */
  isLive: boolean;
  /** True while fetching persisted logs from the REST API. */
  isLoading: boolean;
}

/**
 * Streams or fetches worker output for a task.
 *
 * @param workerId - The active worker's ID, or null/undefined if no worker is running.
 * @param taskId   - The task ID used to fetch persisted logs.
 */
export function useWorkerOutput(
  workerId: string | null | undefined,
  taskId: string,
): UseWorkerOutputResult {
  const [lines, setLines] = useState<OutputChunk[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { subscribe, unsubscribe, addListener, removeListener } = useWebSocket();
  const isLive = !!workerId;

  // Keep a ref to workerId so the event listener callback always reads
  // the latest value without needing to be re-registered on every change.
  const workerIdRef = useRef(workerId);
  workerIdRef.current = workerId;

  // Live mode: subscribe to the worker's WebSocket room
  useEffect(() => {
    if (!workerId) return;

    setLines([]);
    subscribe(EventChannel.Workers, workerId);

    return () => {
      unsubscribe(EventChannel.Workers, workerId);
    };
  }, [workerId, subscribe, unsubscribe]);

  // Live mode: register an event listener for worker.output events
  const handleEvent = useCallback((event: FactoryEvent) => {
    if (event.type !== "worker.output") return;
    if (event.entityId !== workerIdRef.current) return;

    const chunks = (event.data as { chunks?: OutputChunk[] }).chunks;
    if (chunks) {
      setLines((prev) => [...prev, ...chunks]);
    }
  }, []);

  useEffect(() => {
    if (!workerId) return;

    addListener(handleEvent);
    return () => {
      removeListener(handleEvent);
    };
  }, [workerId, addListener, removeListener, handleEvent]);

  // Historical mode: fetch persisted logs
  useEffect(() => {
    if (workerId) return;

    let cancelled = false;
    setIsLoading(true);
    setLines([]);

    apiGet<{ stdout: string; stderr: string }>(`/tasks/${taskId}/logs`)
      .then((data) => {
        if (cancelled) return;
        const historicalLines: OutputChunk[] = [];
        if (data.stdout) {
          historicalLines.push({ stream: "stdout", content: data.stdout, timestamp: "" });
        }
        if (data.stderr) {
          historicalLines.push({ stream: "stderr", content: data.stderr, timestamp: "" });
        }
        setLines(historicalLines);
      })
      .catch(() => {
        if (!cancelled) setLines([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workerId, taskId]);

  return { lines, isLive, isLoading };
}
