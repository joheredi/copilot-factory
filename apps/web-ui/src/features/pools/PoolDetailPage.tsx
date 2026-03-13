/**
 * Pool detail page.
 *
 * Shows comprehensive information about a single worker pool including
 * its configuration, list of registered workers, and attached agent
 * profiles. Accessed via `/workers/:id` route.
 *
 * Includes operator controls for enable/disable toggle and inline
 * concurrency editing, with confirmation dialogs for disruptive actions.
 *
 * Data is fetched with TanStack Query hooks and refreshed in real-time
 * via WebSocket cache invalidation (Workers channel).
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Worker Pools screen
 * @see T096 — Build worker pool monitoring panel
 * @see T105 — Integrate operator controls into pool and merge queue UI
 */

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { usePool, usePoolWorkers, useAgentProfiles } from "../../api/hooks/use-pools.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Badge } from "../../components/ui/badge.js";
import { PoolStatusBadge } from "./components/pool-status-badge.js";
import { PoolTypeBadge } from "./components/pool-type-badge.js";
import { PoolToggle } from "./components/pool-toggle.js";
import { ConcurrencyEditor } from "./components/concurrency-editor.js";
import { WorkerTable } from "./components/worker-table.js";
import type { WorkerRecord } from "./components/worker-table.js";
import type { AgentProfile } from "../../api/types.js";
import { ActionFeedbackBanner } from "../task-detail/components/operator-actions/ActionFeedbackBanner.js";
import { useActionFeedback } from "../task-detail/components/operator-actions/use-action-feedback.js";
import { CreateProfileDialog } from "./components/CreateProfileDialog.js";

/**
 * Formats an ISO timestamp to a readable date string.
 */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PoolDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: pool, isLoading: poolLoading, isError: poolError } = usePool(id);
  const { data: rawWorkers, isLoading: workersLoading } = usePoolWorkers(id);
  const { data: profiles, isLoading: profilesLoading } = useAgentProfiles(id);
  const { feedback, showSuccess, showError, clearFeedback } = useActionFeedback();
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  const workers = (rawWorkers ?? []) as WorkerRecord[];
  const profileList = (profiles ?? []) as AgentProfile[];

  const busyCount = workers.filter((w) => w.status === "busy").length;
  const onlineCount = workers.filter((w) => w.status === "online" || w.status === "busy").length;

  /** Callback for operator action feedback from child components. */
  function handleFeedback(type: "success" | "error", message: string) {
    if (type === "success") showSuccess(message);
    else showError(message);
  }

  // Loading state
  if (poolLoading) {
    return (
      <div className="space-y-6" data-testid="pool-detail-skeleton">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-muted" />
        <Card>
          <CardContent className="p-6">
            <div className="h-32 animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error / not found
  if (poolError || !pool) {
    return (
      <div className="space-y-4" data-testid="pool-detail-error">
        <Link to="/workers">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to pools
          </Button>
        </Link>
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <strong>Pool not found.</strong> The pool may have been deleted or the ID is invalid.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <Link to="/workers">
        <Button variant="ghost" size="sm" className="gap-2" data-testid="back-to-pools">
          <ArrowLeft className="h-4 w-4" />
          Back to pools
        </Button>
      </Link>

      {/* Operator action feedback */}
      <ActionFeedbackBanner feedback={feedback} onDismiss={clearFeedback} />

      {/* Pool header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight" data-testid="pool-name">
            {pool.name}
          </h1>
          <div className="flex items-center gap-2">
            <PoolTypeBadge poolType={pool.poolType} />
            <PoolStatusBadge enabled={pool.enabled} />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <PoolToggle poolId={pool.id} enabled={pool.enabled} onFeedback={handleFeedback} />
          <div className="text-right text-sm text-muted-foreground">
            <div>Created {formatDate(pool.createdAt)}</div>
            <div>Updated {formatDate(pool.updatedAt)}</div>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-3" data-testid="pool-stats">
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-6">
            <span className="text-2xl font-bold" data-testid="stat-workers-online">
              {onlineCount}
            </span>
            <span className="text-sm text-muted-foreground">Workers Online</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-6">
            <span className="text-2xl font-bold" data-testid="stat-workers-busy">
              {busyCount}
            </span>
            <span className="text-sm text-muted-foreground">Active Tasks</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-6">
            <ConcurrencyEditor
              poolId={pool.id}
              currentValue={pool.maxConcurrency}
              onFeedback={handleFeedback}
            />
            <span className="text-sm text-muted-foreground">Max Concurrency</span>
          </CardContent>
        </Card>
      </div>

      {/* Configuration details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configuration</CardTitle>
          <CardDescription>Pool settings and capabilities</CardDescription>
        </CardHeader>
        <CardContent>
          <dl
            className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 text-sm"
            data-testid="pool-config"
          >
            <div>
              <dt className="font-medium text-muted-foreground">Provider</dt>
              <dd>{pool.provider ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Model</dt>
              <dd>{pool.model ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Runtime</dt>
              <dd>{pool.runtime ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Cost Profile</dt>
              <dd>{pool.costProfile ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Default Timeout</dt>
              <dd>{pool.defaultTimeoutSec ? `${pool.defaultTimeoutSec}s` : "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Token Budget</dt>
              <dd>{pool.defaultTokenBudget ? pool.defaultTokenBudget.toLocaleString() : "—"}</dd>
            </div>
            {pool.capabilities && pool.capabilities.length > 0 && (
              <div className="sm:col-span-2">
                <dt className="mb-1 font-medium text-muted-foreground">Capabilities</dt>
                <dd className="flex flex-wrap gap-1">
                  {pool.capabilities.map((cap) => (
                    <Badge key={cap} variant="secondary" className="text-xs">
                      {cap}
                    </Badge>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Workers section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Workers
            <Badge variant="secondary" className="ml-2">
              {workers.length}
            </Badge>
          </CardTitle>
          <CardDescription>Registered workers and their current status</CardDescription>
        </CardHeader>
        <CardContent>
          <WorkerTable workers={workers} isLoading={workersLoading} />
        </CardContent>
      </Card>

      {/* Agent profiles section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              Agent Profiles
              <Badge variant="secondary" className="ml-2">
                {profileList.length}
              </Badge>
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => setProfileDialogOpen(true)}
              data-testid="add-profile-button"
            >
              <Plus className="h-4 w-4" />
              Add Agent Profile
            </Button>
          </div>
          <CardDescription>Configured agent profiles for this pool</CardDescription>
        </CardHeader>
        <CardContent>
          {profilesLoading ? (
            <div data-testid="profiles-skeleton">
              <div className="h-16 animate-pulse rounded bg-muted" />
            </div>
          ) : profileList.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center rounded-md border border-dashed p-8 text-center"
              data-testid="profiles-empty"
            >
              <p className="text-sm font-medium text-muted-foreground">No profiles configured</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Agent profiles define the policies and prompts used by workers in this pool.
              </p>
            </div>
          ) : (
            <div className="space-y-3" data-testid="profiles-list">
              {profileList.map((profile) => (
                <div
                  key={profile.id}
                  className="rounded-md border p-3 text-sm"
                  data-testid={`profile-${profile.id}`}
                >
                  <div className="flex items-center justify-between">
                    <code className="text-xs font-mono text-muted-foreground">
                      {profile.id.slice(0, 8)}…
                    </code>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(profile.createdAt)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {profile.promptTemplateId && (
                      <Badge variant="outline" className="text-xs">
                        prompt
                      </Badge>
                    )}
                    {profile.toolPolicyId && (
                      <Badge variant="outline" className="text-xs">
                        tool-policy
                      </Badge>
                    )}
                    {profile.commandPolicyId && (
                      <Badge variant="outline" className="text-xs">
                        command-policy
                      </Badge>
                    )}
                    {profile.fileScopePolicyId && (
                      <Badge variant="outline" className="text-xs">
                        file-scope
                      </Badge>
                    )}
                    {profile.validationPolicyId && (
                      <Badge variant="outline" className="text-xs">
                        validation
                      </Badge>
                    )}
                    {profile.reviewPolicyId && (
                      <Badge variant="outline" className="text-xs">
                        review
                      </Badge>
                    )}
                    {profile.budgetPolicyId && (
                      <Badge variant="outline" className="text-xs">
                        budget
                      </Badge>
                    )}
                    {profile.retryPolicyId && (
                      <Badge variant="outline" className="text-xs">
                        retry
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Agent Profile dialog */}
      <CreateProfileDialog
        poolId={pool.id}
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
      />
    </div>
  );
}
