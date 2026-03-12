/**
 * Overview tab for task detail page.
 *
 * Displays all task metadata fields in a structured layout including
 * status, priority, type, source, size estimate, risk level,
 * acceptance criteria, definition of done, and current lease/review info.
 *
 * @see T095 — Build task detail timeline view
 */

import type { TaskDetail } from "../../../api/types.js";
import { Badge } from "../../../components/ui/badge.js";
import { Card, CardContent, CardHeader } from "../../../components/ui/card.js";
import { TaskPriorityBadge } from "../../tasks/components/task-priority-badge.js";
import { TaskStatusBadge } from "../../tasks/components/task-status-badge.js";
import type { TaskPriority } from "../../../api/types.js";

/** Display labels for task types. */
const TYPE_LABELS: Record<string, string> = {
  feature: "Feature",
  bug_fix: "Bug Fix",
  refactor: "Refactor",
  chore: "Chore",
  documentation: "Documentation",
  test: "Test",
  spike: "Spike",
};

/** Display labels for task sources. */
const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  automated: "Automated",
  follow_up: "Follow-up",
  decomposition: "Decomposition",
};

/** Display labels for estimated sizes. */
const SIZE_LABELS: Record<string, string> = {
  xs: "XS",
  s: "S",
  m: "M",
  l: "L",
  xl: "XL",
};

/** Display labels for risk levels. */
const RISK_LABELS: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Risk level styling classes. */
const RISK_STYLES: Record<string, string> = {
  high: "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
  medium:
    "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  low: "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
};

/**
 * Formats a Unix timestamp or ISO date string into a readable date/time.
 */
function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface TaskOverviewTabProps {
  /** The enriched task detail object. */
  readonly detail: TaskDetail;
}

/**
 * Renders the Overview tab content showing all task metadata.
 *
 * Organized into sections: basic info, classification, criteria,
 * and current runtime state (lease/review).
 */
export function TaskOverviewTab({ detail }: TaskOverviewTabProps) {
  const { task, currentLease, currentReviewCycle } = detail;

  return (
    <div className="space-y-6" data-testid="task-overview-tab">
      {/* Basic Information */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Basic Information</h3>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MetadataField label="Status">
              <TaskStatusBadge status={task.status} />
            </MetadataField>
            <MetadataField label="Priority">
              <TaskPriorityBadge priority={task.priority as TaskPriority} />
            </MetadataField>
            <MetadataField label="Type">
              <span>{TYPE_LABELS[task.taskType] ?? task.taskType}</span>
            </MetadataField>
            <MetadataField label="Source">
              <span>{SOURCE_LABELS[task.source] ?? task.source}</span>
            </MetadataField>
            <MetadataField label="Repository ID">
              <code className="text-xs">{task.repositoryId}</code>
            </MetadataField>
            <MetadataField label="Version">
              <span>{task.version}</span>
            </MetadataField>
            <MetadataField label="Created">
              <span>{formatDateTime(task.createdAt)}</span>
            </MetadataField>
            <MetadataField label="Updated">
              <span>{formatDateTime(task.updatedAt)}</span>
            </MetadataField>
            {task.externalRef && (
              <MetadataField label="External Reference">
                <span>{task.externalRef}</span>
              </MetadataField>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Classification */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Classification</h3>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MetadataField label="Estimated Size">
              <span>
                {task.estimatedSize ? (SIZE_LABELS[task.estimatedSize] ?? task.estimatedSize) : "—"}
              </span>
            </MetadataField>
            <MetadataField label="Risk Level">
              {task.riskLevel ? (
                <Badge variant="outline" className={RISK_STYLES[task.riskLevel] ?? ""}>
                  {RISK_LABELS[task.riskLevel] ?? task.riskLevel}
                </Badge>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </MetadataField>
            {task.severity && (
              <MetadataField label="Severity">
                <span>{task.severity}</span>
              </MetadataField>
            )}
            {task.requiredCapabilities && task.requiredCapabilities.length > 0 && (
              <MetadataField label="Required Capabilities" fullWidth>
                <div className="flex flex-wrap gap-1">
                  {task.requiredCapabilities.map((cap) => (
                    <Badge key={cap} variant="secondary" className="text-xs">
                      {cap}
                    </Badge>
                  ))}
                </div>
              </MetadataField>
            )}
            {task.suggestedFileScope && task.suggestedFileScope.length > 0 && (
              <MetadataField label="Suggested File Scope" fullWidth>
                <div className="space-y-1">
                  {task.suggestedFileScope.map((path) => (
                    <code key={path} className="block text-xs text-muted-foreground">
                      {path}
                    </code>
                  ))}
                </div>
              </MetadataField>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Description */}
      {task.description && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Description</h3>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm" data-testid="task-description">
              {task.description}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Acceptance Criteria */}
      {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Acceptance Criteria</h3>
          </CardHeader>
          <CardContent>
            <ul
              className="list-inside list-disc space-y-1 text-sm"
              data-testid="acceptance-criteria"
            >
              {task.acceptanceCriteria.map((criterion, i) => (
                <li key={i}>{criterion}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Definition of Done */}
      {task.definitionOfDone && task.definitionOfDone.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Definition of Done</h3>
          </CardHeader>
          <CardContent>
            <ul
              className="list-inside list-disc space-y-1 text-sm"
              data-testid="definition-of-done"
            >
              {task.definitionOfDone.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Current Lease */}
      {currentLease && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Current Lease</h3>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="current-lease">
              <MetadataField label="Lease ID">
                <code className="text-xs">{currentLease.leaseId}</code>
              </MetadataField>
              <MetadataField label="Worker ID">
                <code className="text-xs">{currentLease.workerId}</code>
              </MetadataField>
              <MetadataField label="Pool ID">
                <code className="text-xs">{currentLease.poolId}</code>
              </MetadataField>
              <MetadataField label="Status">
                <Badge variant="outline">{currentLease.status}</Badge>
              </MetadataField>
              <MetadataField label="Leased At">
                <span>{formatDateTime(currentLease.leasedAt)}</span>
              </MetadataField>
              <MetadataField label="Expires At">
                <span>{formatDateTime(currentLease.expiresAt)}</span>
              </MetadataField>
              {currentLease.lastHeartbeatAt && (
                <MetadataField label="Last Heartbeat">
                  <span>{formatDateTime(currentLease.lastHeartbeatAt)}</span>
                </MetadataField>
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Current Review Cycle */}
      {currentReviewCycle && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Current Review Cycle</h3>
          </CardHeader>
          <CardContent>
            <dl
              className="grid grid-cols-1 gap-4 sm:grid-cols-2"
              data-testid="current-review-cycle"
            >
              <MetadataField label="Cycle ID">
                <code className="text-xs">{currentReviewCycle.cycleId}</code>
              </MetadataField>
              <MetadataField label="Status">
                <Badge variant="outline">{currentReviewCycle.status}</Badge>
              </MetadataField>
              <MetadataField label="Specialist Count">
                <span>{currentReviewCycle.specialistCount}</span>
              </MetadataField>
              {currentReviewCycle.leadDecision && (
                <MetadataField label="Lead Decision">
                  <Badge variant="outline">{currentReviewCycle.leadDecision}</Badge>
                </MetadataField>
              )}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Renders a labeled metadata field in a definition list. */
function MetadataField({
  label,
  children,
  fullWidth,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "sm:col-span-2" : ""}>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
