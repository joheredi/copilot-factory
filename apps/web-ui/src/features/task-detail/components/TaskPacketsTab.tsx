/**
 * Packets tab for task detail page.
 *
 * Displays review packets, lead review decisions, and other structured
 * data packets associated with the task. Uses syntax-highlighted JSON
 * rendering for packet contents with expandable/collapsible sections.
 *
 * @see T095 — Build task detail timeline view
 */

import { ChevronDown, ChevronRight, FileJson } from "lucide-react";
import { useState } from "react";
import {
  useReviewHistory,
  useReviewCyclePackets,
  usePacketContent,
} from "../../../api/hooks/use-reviews.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Card, CardContent, CardHeader } from "../../../components/ui/card.js";
import type { ReviewCycle } from "../../../api/types.js";

export interface TaskPacketsTabProps {
  /** The task ID to load packets for. */
  readonly taskId: string;
}

/**
 * Renders the Packets tab showing review cycles and their packets.
 *
 * Shows each review cycle as a collapsible section containing
 * specialist review packets and lead review decisions with
 * syntax-highlighted JSON content.
 */
export function TaskPacketsTab({ taskId }: TaskPacketsTabProps) {
  const { data: reviewHistory, isLoading, isError } = useReviewHistory(taskId);

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="packets-loading">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        role="alert"
        data-testid="packets-error"
      >
        <strong>Unable to load packets.</strong> Check that the control-plane API is running.
      </div>
    );
  }

  const cycles = reviewHistory?.cycles ?? [];

  if (cycles.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-md border border-dashed p-12 text-center"
        data-testid="packets-empty"
      >
        <FileJson className="mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-lg font-medium text-muted-foreground">No packets yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Packets will appear after the task enters review.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="task-packets-tab">
      {cycles.map((cycle, index) => (
        <ReviewCycleSection
          key={cycle.cycleId}
          taskId={taskId}
          cycle={cycle}
          cycleNumber={cycles.length - index}
        />
      ))}
    </div>
  );
}

/**
 * Collapsible section for a single review cycle.
 *
 * Shows cycle metadata and, when expanded, loads and displays
 * all specialist review packets and the lead review decision.
 */
function ReviewCycleSection({
  taskId,
  cycle,
  cycleNumber,
}: {
  readonly taskId: string;
  readonly cycle: ReviewCycle;
  readonly cycleNumber: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: packets, isLoading } = useReviewCyclePackets(
    expanded ? taskId : undefined,
    expanded ? cycle.cycleId : undefined,
  );

  const statusStyle = getReviewStatusStyle(cycle.status);

  return (
    <Card data-testid={`review-cycle-${cycle.cycleId}`}>
      <CardHeader className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <h4 className="text-sm font-semibold">Review Cycle #{cycleNumber}</h4>
            <Badge variant="outline" className={statusStyle}>
              {cycle.status}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{cycle.specialistCount} reviewer(s)</span>
            {cycle.leadDecision && (
              <Badge variant="outline" className="text-xs">
                Lead: {cycle.leadDecision}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent>
          {isLoading ? (
            <div className="space-y-2" data-testid="cycle-packets-loading">
              <div className="h-16 animate-pulse rounded bg-muted" />
              <div className="h-16 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="space-y-4">
              {packets?.packets.map((packet) => (
                <PacketViewer
                  key={packet.packetId}
                  taskId={taskId}
                  packetId={packet.packetId}
                  label={`${packet.reviewerType} Review`}
                  verdict={packet.verdict}
                  preview={packet.content}
                />
              ))}

              {packets?.leadDecision && (
                <div className="rounded-md border bg-muted/30 p-3" data-testid="lead-decision">
                  <h5 className="mb-2 text-sm font-medium">Lead Review Decision</h5>
                  <JsonViewer data={packets.leadDecision} />
                </div>
              )}

              {(!packets?.packets || packets.packets.length === 0) && !packets?.leadDecision && (
                <p className="text-sm text-muted-foreground">No packets in this cycle yet.</p>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Displays a packet with expandable full JSON content.
 *
 * Shows a summary with verdict and an expand button to load
 * and display the full packet content with syntax highlighting.
 */
function PacketViewer({
  taskId,
  packetId,
  label,
  verdict,
  preview,
}: {
  readonly taskId: string;
  readonly packetId: string;
  readonly label: string;
  readonly verdict: string;
  readonly preview: unknown;
}) {
  const [showFull, setShowFull] = useState(false);
  const { data: fullContent, isLoading } = usePacketContent(
    showFull ? taskId : undefined,
    showFull ? packetId : undefined,
  );

  const verdictStyle = getVerdictStyle(verdict);

  return (
    <div className="rounded-md border p-3" data-testid={`packet-${packetId}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileJson className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{label}</span>
          <Badge variant="outline" className={verdictStyle}>
            {verdict}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowFull(!showFull)}
          data-testid={`expand-packet-${packetId}`}
        >
          {showFull ? "Collapse" : "Expand"}
        </Button>
      </div>

      {showFull && (
        <div className="mt-2">
          {isLoading ? (
            <div className="h-16 animate-pulse rounded bg-muted" />
          ) : (
            <JsonViewer data={fullContent?.content ?? preview} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Renders a JSON value with syntax highlighting.
 *
 * Uses a pre/code block with indented JSON formatting.
 * Handles large objects by limiting initial display.
 */
function JsonViewer({ data }: { readonly data: unknown }) {
  const jsonStr = JSON.stringify(data, null, 2);

  return (
    <pre
      className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed"
      data-testid="json-viewer"
    >
      <code>{jsonStr}</code>
    </pre>
  );
}

/** Returns badge styling for review cycle statuses. */
function getReviewStatusStyle(status: string): string {
  if (status.includes("complete") || status === "consolidated") {
    return "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300";
  }
  if (status.includes("fail") || status === "rejected") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300";
  }
  return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300";
}

/** Returns badge styling for review verdicts. */
function getVerdictStyle(verdict: string): string {
  if (verdict === "approved") {
    return "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300";
  }
  if (verdict === "changes_requested") {
    return "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300";
  }
  if (verdict === "escalated") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300";
  }
  return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300";
}
