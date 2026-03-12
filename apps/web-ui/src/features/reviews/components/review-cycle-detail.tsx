/**
 * Review cycle detail panel showing specialist packets and lead decision.
 *
 * Displays the full review cycle breakdown for a selected task:
 * - Review cycle status and metadata
 * - Individual specialist review packets with verdict, reviewer type,
 *   and issue counts (blocking vs non-blocking)
 * - Lead review decision with summary and blocking issues
 *
 * Data is fetched on-demand when a review cycle is expanded, using
 * the `useReviewCyclePackets` hook to load packet details.
 *
 * @see T097 — Build review center view
 * @see packages/schemas/src/review-packet.ts — ReviewPacket schema
 * @see packages/schemas/src/lead-review-decision-packet.ts — LeadReviewDecisionPacket
 */

import { AlertTriangle, CheckCircle2, FileText, Loader2, Shield, XCircle } from "lucide-react";
import { useReviewCyclePackets } from "../../../api/hooks";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { ReviewVerdictBadge } from "./review-verdict-badge";
import type { ReviewPacket } from "../../../api/types";

/** Extract the lead decision packet content if it's a structured object. */
function extractLeadDecisionFields(decision: unknown): {
  summary: string;
  blockingIssues: unknown[];
  nonBlockingSuggestions: string[];
  decision: string;
} | null {
  if (!decision || typeof decision !== "object") return null;
  const d = decision as Record<string, unknown>;
  return {
    summary: typeof d["summary"] === "string" ? d["summary"] : "",
    blockingIssues: Array.isArray(d["blocking_issues"]) ? d["blocking_issues"] : [],
    nonBlockingSuggestions: Array.isArray(d["non_blocking_suggestions"])
      ? (d["non_blocking_suggestions"] as string[])
      : [],
    decision: typeof d["decision"] === "string" ? d["decision"] : "unknown",
  };
}

/** Extract structured fields from a review packet's content. */
function extractPacketFields(content: unknown): {
  summary: string;
  blockingIssues: unknown[];
  nonBlockingIssues: unknown[];
  confidence: string;
  risks: string[];
} | null {
  if (!content || typeof content !== "object") return null;
  const c = content as Record<string, unknown>;
  return {
    summary: typeof c["summary"] === "string" ? c["summary"] : "",
    blockingIssues: Array.isArray(c["blocking_issues"]) ? c["blocking_issues"] : [],
    nonBlockingIssues: Array.isArray(c["non_blocking_issues"]) ? c["non_blocking_issues"] : [],
    confidence: typeof c["confidence"] === "string" ? c["confidence"] : "unknown",
    risks: Array.isArray(c["risks"]) ? (c["risks"] as string[]) : [],
  };
}

/** Format an ISO timestamp to a locale-aware string. */
function formatTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export interface ReviewCycleDetailProps {
  /** Task UUID that owns the review cycle. */
  readonly taskId: string;
  /** Review cycle identifier to load packets for. */
  readonly cycleId: string;
}

/**
 * Expandable detail panel for a single review cycle.
 *
 * Fetches and displays specialist review packets and the lead reviewer's
 * decision, including issue breakdowns and risk indicators. Used in the
 * review center to allow click-through inspection of review quality.
 */
export function ReviewCycleDetail({ taskId, cycleId }: ReviewCycleDetailProps) {
  const { data, isLoading, isError } = useReviewCyclePackets(taskId, cycleId);

  if (isLoading) {
    return (
      <div
        className="flex items-center gap-2 py-4 text-sm text-muted-foreground"
        data-testid="cycle-detail-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading review packets…
      </div>
    );
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        data-testid="cycle-detail-error"
      >
        Failed to load review cycle packets.
      </div>
    );
  }

  const packets = data?.packets ?? [];
  const leadDecision = extractLeadDecisionFields(data?.leadDecision);

  return (
    <div className="space-y-4" data-testid={`cycle-detail-${cycleId}`}>
      {/* Specialist review packets */}
      {packets.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-muted-foreground">
            Specialist Reviews ({packets.length})
          </h4>
          {packets.map((packet: ReviewPacket) => {
            const fields = extractPacketFields(packet.content);
            return (
              <Card
                key={packet.packetId}
                className="border-l-4 border-l-slate-300"
                data-testid={`packet-${packet.packetId}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <FileText className="h-4 w-4" />
                      {packet.reviewerType}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <ReviewVerdictBadge verdict={packet.verdict} />
                      <span className="text-xs text-muted-foreground">
                        {formatTime(packet.createdAt)}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                {fields && (
                  <CardContent className="space-y-2 pt-0">
                    {fields.summary && <p className="text-sm">{fields.summary}</p>}
                    <div className="flex flex-wrap gap-3 text-xs">
                      {fields.blockingIssues.length > 0 && (
                        <span
                          className="flex items-center gap-1 text-red-600"
                          data-testid="blocking-count"
                        >
                          <XCircle className="h-3 w-3" />
                          {fields.blockingIssues.length} blocking
                        </span>
                      )}
                      {fields.nonBlockingIssues.length > 0 && (
                        <span
                          className="flex items-center gap-1 text-amber-600"
                          data-testid="non-blocking-count"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {fields.nonBlockingIssues.length} non-blocking
                        </span>
                      )}
                      {fields.confidence && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Shield className="h-3 w-3" />
                          {fields.confidence} confidence
                        </span>
                      )}
                    </div>
                    {fields.risks.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium">Risks:</span> {fields.risks.join(", ")}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {packets.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="no-packets">
          No specialist review packets for this cycle.
        </p>
      )}

      {/* Lead review decision */}
      {leadDecision && (
        <Card className="border-l-4 border-l-violet-400" data-testid="lead-decision">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4" />
                Lead Review Decision
              </CardTitle>
              <ReviewVerdictBadge verdict={leadDecision.decision} />
            </div>
            <CardDescription>{leadDecision.summary}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {leadDecision.blockingIssues.length > 0 && (
              <div className="text-xs text-red-600" data-testid="lead-blocking-count">
                <XCircle className="mr-1 inline h-3 w-3" />
                {leadDecision.blockingIssues.length} blocking issue
                {leadDecision.blockingIssues.length !== 1 ? "s" : ""}
              </div>
            )}
            {leadDecision.nonBlockingSuggestions.length > 0 && (
              <div className="text-xs text-amber-600" data-testid="lead-suggestions-count">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                {leadDecision.nonBlockingSuggestions.length} suggestion
                {leadDecision.nonBlockingSuggestions.length !== 1 ? "s" : ""}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
