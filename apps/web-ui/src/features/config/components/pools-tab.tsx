import { useState, useCallback, useEffect } from "react";
import { usePools, usePool, useUpdatePool } from "../../../api/hooks/use-pools.js";
import { Button } from "../../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../components/ui/card.js";
import { Badge } from "../../../components/ui/badge.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";
import { JsonEditor, validateJson } from "./json-editor.js";
import { SaveConfirmationDialog } from "./save-confirmation-dialog.js";
import type { UpdatePoolInput, PoolType } from "../../../api/types.js";

/** Pool type display labels for the pool list. */
const POOL_TYPE_LABELS: Record<PoolType, string> = {
  developer: "Developer",
  reviewer: "Reviewer",
  "lead-reviewer": "Lead Reviewer",
  "merge-assist": "Merge Assist",
  planner: "Planner",
};

/**
 * Converts a pool's capabilities array to a JSON string for editing.
 */
function capabilitiesToJson(capabilities: string[] | null): string {
  if (capabilities === null || capabilities === undefined) return "null";
  return JSON.stringify(capabilities, null, 2);
}

/**
 * Converts a pool's repoScopeRules to a JSON string for editing.
 */
function scopeRulesToJson(rules: Record<string, unknown> | null): string {
  if (rules === null || rules === undefined) return "null";
  return JSON.stringify(rules, null, 2);
}

/** Editable form state for a pool's configuration. */
interface PoolFormState {
  name: string;
  maxConcurrency: string;
  enabled: boolean;
  provider: string;
  runtime: string;
  model: string;
  defaultTimeoutSec: string;
  defaultTokenBudget: string;
  costProfile: string;
  capabilities: string;
  repoScopeRules: string;
}

/**
 * Initializes form state from a WorkerPool entity.
 */
function poolToFormState(pool: {
  name: string;
  maxConcurrency: number;
  enabled: boolean;
  provider: string | null;
  runtime: string | null;
  model: string | null;
  defaultTimeoutSec: number | null;
  defaultTokenBudget: number | null;
  costProfile: string | null;
  capabilities: string[] | null;
  repoScopeRules: Record<string, unknown> | null;
}): PoolFormState {
  return {
    name: pool.name,
    maxConcurrency: String(pool.maxConcurrency),
    enabled: pool.enabled,
    provider: pool.provider ?? "",
    runtime: pool.runtime ?? "",
    model: pool.model ?? "",
    defaultTimeoutSec: pool.defaultTimeoutSec !== null ? String(pool.defaultTimeoutSec) : "",
    defaultTokenBudget: pool.defaultTokenBudget !== null ? String(pool.defaultTokenBudget) : "",
    costProfile: pool.costProfile ?? "",
    capabilities: capabilitiesToJson(pool.capabilities),
    repoScopeRules: scopeRulesToJson(pool.repoScopeRules),
  };
}

/**
 * Pools configuration tab for the configuration editor.
 *
 * Displays a two-panel layout with pool list on the left and an
 * editable form for pool configuration on the right. Supports editing
 * all pool fields including JSON-based capabilities and scope rules.
 *
 * @see T099 — Build configuration editor view
 */
export function PoolsTab() {
  const { data: poolsData, isLoading: isLoadingList, isError: isListError } = usePools();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const { data: selectedPool, isLoading: isLoadingDetail } = usePool(selectedId);

  const [form, setForm] = useState<PoolFormState>({
    name: "",
    maxConcurrency: "1",
    enabled: true,
    provider: "",
    runtime: "",
    model: "",
    defaultTimeoutSec: "",
    defaultTokenBudget: "",
    costProfile: "",
    capabilities: "null",
    repoScopeRules: "null",
  });
  const [isDirty, setIsDirty] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const updateMutation = useUpdatePool(selectedId ?? "");

  // Sync form when pool loads
  useEffect(() => {
    if (selectedPool) {
      setForm(poolToFormState(selectedPool));
      setIsDirty(false);
      setSaveSuccess(false);
    }
  }, [selectedPool]);

  const updateField = useCallback(
    <K extends keyof PoolFormState>(key: K, value: PoolFormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setIsDirty(true);
      setSaveSuccess(false);
    },
    [],
  );

  const capabilitiesValid = validateJson(form.capabilities).valid;
  const scopeRulesValid = validateJson(form.repoScopeRules).valid;
  const concurrencyValid =
    /^\d+$/.test(form.maxConcurrency) && parseInt(form.maxConcurrency, 10) >= 1;
  const allValid = capabilitiesValid && scopeRulesValid && concurrencyValid;

  const handleSave = useCallback(() => {
    if (!selectedId || !allValid) return;

    const input: UpdatePoolInput = {
      name: form.name || undefined,
      maxConcurrency: parseInt(form.maxConcurrency, 10),
      enabled: form.enabled,
      provider: form.provider || undefined,
      runtime: form.runtime || undefined,
      model: form.model || undefined,
      defaultTimeoutSec: form.defaultTimeoutSec ? parseInt(form.defaultTimeoutSec, 10) : undefined,
      defaultTokenBudget: form.defaultTokenBudget
        ? parseInt(form.defaultTokenBudget, 10)
        : undefined,
      costProfile: form.costProfile || undefined,
      capabilities: form.capabilities.trim() === "null" ? undefined : JSON.parse(form.capabilities),
      repoScopeRules:
        form.repoScopeRules.trim() === "null" ? undefined : JSON.parse(form.repoScopeRules),
    };

    updateMutation.mutate(input, {
      onSuccess: () => {
        setIsDirty(false);
        setShowConfirm(false);
        setSaveSuccess(true);
      },
      onError: () => {
        setShowConfirm(false);
      },
    });
  }, [selectedId, form, allValid, updateMutation]);

  const pools = poolsData?.data ?? [];

  // --- Loading ---
  if (isLoadingList) {
    return (
      <div className="space-y-4" data-testid="pools-tab-loading">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  // --- Error ---
  if (isListError) {
    return (
      <div
        className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
        data-testid="pools-tab-error"
      >
        Failed to load worker pools. Please try again.
      </div>
    );
  }

  // --- Empty ---
  if (pools.length === 0) {
    return (
      <Card data-testid="pools-tab-empty">
        <CardContent className="py-8 text-center text-muted-foreground">
          No worker pools found. Create a pool to get started.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3" data-testid="pools-tab">
      {/* Left panel — pool list */}
      <div className="space-y-3 lg:col-span-1">
        <h3 className="text-sm font-medium text-muted-foreground">Worker Pools</h3>
        {pools.map((pool) => (
          <Card
            key={pool.id}
            className={`cursor-pointer transition-colors hover:bg-accent/50 ${
              selectedId === pool.id ? "border-primary bg-accent/30" : ""
            }`}
            onClick={() => setSelectedId(pool.id)}
            data-testid={`pool-config-card-${pool.id}`}
          >
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{pool.name}</p>
                <p className="text-xs text-muted-foreground">
                  {POOL_TYPE_LABELS[pool.poolType]} · Max {pool.maxConcurrency}
                </p>
              </div>
              <Badge variant={pool.enabled ? "default" : "secondary"}>
                {pool.enabled ? "Enabled" : "Disabled"}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Right panel — editor */}
      <div className="lg:col-span-2">
        {!selectedId ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Select a worker pool from the list to edit its configuration.
            </CardContent>
          </Card>
        ) : isLoadingDetail ? (
          <div className="space-y-4" data-testid="pool-detail-loading">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : selectedPool ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Edit Pool Configuration</span>
                  {saveSuccess && (
                    <Badge
                      variant="default"
                      className="bg-green-600"
                      data-testid="pool-save-success"
                    >
                      Saved
                    </Badge>
                  )}
                  {updateMutation.isError && (
                    <Badge variant="destructive" data-testid="pool-save-error">
                      Save failed
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  ID: {selectedPool.id} · Type: {POOL_TYPE_LABELS[selectedPool.poolType]}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Basic fields */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pool-name">Name</Label>
                    <Input
                      id="pool-name"
                      value={form.name}
                      onChange={(e) => updateField("name", e.target.value)}
                      data-testid="pool-name-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pool-concurrency">Max Concurrency</Label>
                    <Input
                      id="pool-concurrency"
                      type="number"
                      min={1}
                      max={100}
                      value={form.maxConcurrency}
                      onChange={(e) => updateField("maxConcurrency", e.target.value)}
                      data-testid="pool-concurrency-input"
                    />
                    {!concurrencyValid && (
                      <p className="text-xs text-destructive">Must be a positive integer</p>
                    )}
                  </div>
                </div>

                {/* Enabled toggle */}
                <div className="flex items-center gap-3">
                  <Label htmlFor="pool-enabled">Enabled</Label>
                  <button
                    id="pool-enabled"
                    type="button"
                    role="switch"
                    aria-checked={form.enabled}
                    onClick={() => updateField("enabled", !form.enabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      form.enabled ? "bg-primary" : "bg-muted"
                    }`}
                    data-testid="pool-enabled-toggle"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                        form.enabled ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {form.enabled ? "Pool is active" : "Pool is disabled"}
                  </span>
                </div>

                {/* AI Configuration */}
                <div>
                  <h4 className="mb-3 text-sm font-medium">AI Configuration</h4>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="pool-provider">Provider</Label>
                      <Input
                        id="pool-provider"
                        value={form.provider}
                        onChange={(e) => updateField("provider", e.target.value)}
                        placeholder="e.g., copilot"
                        data-testid="pool-provider-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pool-runtime">Runtime</Label>
                      <Input
                        id="pool-runtime"
                        value={form.runtime}
                        onChange={(e) => updateField("runtime", e.target.value)}
                        placeholder="e.g., copilot-cli"
                        data-testid="pool-runtime-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pool-model">Model</Label>
                      <Input
                        id="pool-model"
                        value={form.model}
                        onChange={(e) => updateField("model", e.target.value)}
                        placeholder="e.g., gpt-4"
                        data-testid="pool-model-input"
                      />
                    </div>
                  </div>
                </div>

                {/* Resource Limits */}
                <div>
                  <h4 className="mb-3 text-sm font-medium">Resource Limits</h4>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="pool-timeout">Timeout (sec)</Label>
                      <Input
                        id="pool-timeout"
                        type="number"
                        min={0}
                        value={form.defaultTimeoutSec}
                        onChange={(e) => updateField("defaultTimeoutSec", e.target.value)}
                        placeholder="No limit"
                        data-testid="pool-timeout-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pool-token-budget">Token Budget</Label>
                      <Input
                        id="pool-token-budget"
                        type="number"
                        min={0}
                        value={form.defaultTokenBudget}
                        onChange={(e) => updateField("defaultTokenBudget", e.target.value)}
                        placeholder="No limit"
                        data-testid="pool-token-budget-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pool-cost-profile">Cost Profile</Label>
                      <Input
                        id="pool-cost-profile"
                        value={form.costProfile}
                        onChange={(e) => updateField("costProfile", e.target.value)}
                        placeholder="e.g., standard"
                        data-testid="pool-cost-profile-input"
                      />
                    </div>
                  </div>
                </div>

                {/* JSON fields */}
                <JsonEditor
                  label="Capabilities"
                  value={form.capabilities}
                  onChange={(v) => updateField("capabilities", v)}
                  minHeight={100}
                  data-testid="pool-capabilities"
                />

                <JsonEditor
                  label="Repository Scope Rules"
                  value={form.repoScopeRules}
                  onChange={(v) => updateField("repoScopeRules", v)}
                  minHeight={100}
                  data-testid="pool-scope-rules"
                />

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 border-t pt-4">
                  <Button
                    variant="outline"
                    disabled={!isDirty}
                    onClick={() => {
                      if (selectedPool) {
                        setForm(poolToFormState(selectedPool));
                        setIsDirty(false);
                      }
                    }}
                    data-testid="pool-reset-btn"
                  >
                    Reset
                  </Button>
                  <Button
                    disabled={!isDirty || !allValid}
                    onClick={() => setShowConfirm(true)}
                    data-testid="pool-save-btn"
                  >
                    Save Changes
                  </Button>
                </div>
              </CardContent>
            </Card>

            <SaveConfirmationDialog
              open={showConfirm}
              onOpenChange={setShowConfirm}
              onConfirm={handleSave}
              entityName={form.name}
              changeDescription="This will update the worker pool configuration. Changes may affect active task scheduling."
              isSaving={updateMutation.isPending}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
