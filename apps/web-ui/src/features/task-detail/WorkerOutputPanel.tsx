/**
 * Terminal-style output viewer for worker stdout/stderr.
 *
 * Renders output chunks in a dark, monospace panel with auto-scroll.
 * Shows a live indicator when streaming via WebSocket and distinguishes
 * stderr (red) from stdout (green).
 *
 * @module @factory/web-ui/features/task-detail/WorkerOutputPanel
 */

import { useEffect, useRef } from "react";
import { useWorkerOutput } from "./useWorkerOutput.js";

/** Props for {@link WorkerOutputPanel}. */
export interface WorkerOutputPanelProps {
  /** Active worker ID, or null/undefined when no worker is running. */
  workerId: string | null | undefined;
  /** Task ID for fetching persisted logs. */
  taskId: string;
}

/**
 * Terminal-style panel that displays worker output.
 *
 * - Auto-scrolls to the bottom when new content arrives
 * - Displays a green "● Live" badge during real-time streaming
 * - Colors stderr lines red and stdout lines green
 */
export function WorkerOutputPanel({ workerId, taskId }: WorkerOutputPanelProps) {
  const { lines, isLive, isLoading } = useWorkerOutput(workerId, taskId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="space-y-2" data-testid="worker-output-panel">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Worker Output</h3>
        {isLive && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-green-900/40 px-2 py-0.5 text-xs font-medium text-green-400"
            data-testid="live-indicator"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
            Live
          </span>
        )}
      </div>

      {/* Terminal viewport */}
      <div
        ref={scrollRef}
        className="h-96 overflow-auto rounded-md bg-gray-950 p-4 font-mono text-sm leading-relaxed"
        data-testid="output-viewport"
      >
        {isLoading && (
          <span className="text-gray-500" data-testid="output-loading">
            Loading logs…
          </span>
        )}

        {!isLoading && lines.length === 0 && (
          <span className="text-gray-500" data-testid="output-empty">
            No output yet.
          </span>
        )}

        {lines.map((chunk, index) => (
          <pre
            key={index}
            className={`whitespace-pre-wrap break-all ${
              chunk.stream === "stderr" ? "text-red-400" : "text-green-300"
            }`}
          >
            {chunk.content}
          </pre>
        ))}
      </div>
    </div>
  );
}
