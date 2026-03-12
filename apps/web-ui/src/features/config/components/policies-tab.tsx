import { useState, useCallback, useEffect } from "react";
import { usePolicies, usePolicy, useUpdatePolicy } from "../../../api/hooks/use-policies.js";
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
import { JsonEditor, validateJson } from "./json-editor.js";
import { SaveConfirmationDialog } from "./save-confirmation-dialog.js";
import type { UpdatePolicySetInput } from "../../../api/types.js";

/** Names of the JSON policy fields on a PolicySet entity. */
const POLICY_FIELDS = [
  { key: "schedulingPolicyJson" as const, label: "Scheduling Policy" },
  { key: "reviewPolicyJson" as const, label: "Review Policy" },
  { key: "mergePolicyJson" as const, label: "Merge Policy" },
  { key: "securityPolicyJson" as const, label: "Security Policy" },
  { key: "validationPolicyJson" as const, label: "Validation Policy" },
  { key: "budgetPolicyJson" as const, label: "Budget Policy" },
];

type PolicyJsonKey = (typeof POLICY_FIELDS)[number]["key"];

/**
 * Serializes a policy value to a JSON string for editing.
 *
 * Handles null, undefined, and object values, returning a
 * formatted JSON string suitable for the JSON editor.
 */
function toJsonString(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  return JSON.stringify(value, null, 2);
}

/**
 * Policies tab content for the configuration editor.
 *
 * Provides a two-panel layout: a list of policy sets on the left and
 * a multi-field JSON editor on the right. Operators can select a policy
 * set, modify its JSON policy fields, and save with confirmation.
 *
 * @see T099 — Build configuration editor view
 */
export function PoliciesTab() {
  const { data: policiesData, isLoading: isLoadingList, isError: isListError } = usePolicies();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const { data: selectedPolicy, isLoading: isLoadingDetail } = usePolicy(selectedId);

  // Editable state for each JSON field
  const [editedFields, setEditedFields] = useState<Record<PolicyJsonKey, string>>({
    schedulingPolicyJson: "null",
    reviewPolicyJson: "null",
    mergePolicyJson: "null",
    securityPolicyJson: "null",
    validationPolicyJson: "null",
    budgetPolicyJson: "null",
  });
  const [editedName, setEditedName] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Sync editable state when a policy is loaded
  useEffect(() => {
    if (selectedPolicy) {
      const fields: Record<PolicyJsonKey, string> = {
        schedulingPolicyJson: toJsonString(selectedPolicy.schedulingPolicyJson),
        reviewPolicyJson: toJsonString(selectedPolicy.reviewPolicyJson),
        mergePolicyJson: toJsonString(selectedPolicy.mergePolicyJson),
        securityPolicyJson: toJsonString(selectedPolicy.securityPolicyJson),
        validationPolicyJson: toJsonString(selectedPolicy.validationPolicyJson),
        budgetPolicyJson: toJsonString(selectedPolicy.budgetPolicyJson),
      };
      setEditedFields(fields);
      setEditedName(selectedPolicy.name);
      setIsDirty(false);
      setSaveSuccess(false);
    }
  }, [selectedPolicy]);

  const updateMutation = useUpdatePolicy(selectedId ?? "");

  const handleFieldChange = useCallback((key: PolicyJsonKey, value: string) => {
    setEditedFields((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
    setSaveSuccess(false);
  }, []);

  const handleNameChange = useCallback((value: string) => {
    setEditedName(value);
    setIsDirty(true);
    setSaveSuccess(false);
  }, []);

  /** Returns true when all edited JSON fields are valid. */
  const allFieldsValid = POLICY_FIELDS.every((f) => validateJson(editedFields[f.key]).valid);

  const handleSave = useCallback(() => {
    if (!selectedId || !allFieldsValid) return;

    const input: UpdatePolicySetInput = { name: editedName };
    for (const field of POLICY_FIELDS) {
      const text = editedFields[field.key];
      const parsed = text.trim() === "null" ? null : JSON.parse(text);
      (input as Record<string, unknown>)[field.key] = parsed;
    }

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
  }, [selectedId, editedFields, editedName, allFieldsValid, updateMutation]);

  const policies = policiesData?.data ?? [];

  // --- Loading state ---
  if (isLoadingList) {
    return (
      <div className="space-y-4" data-testid="policies-tab-loading">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  // --- Error state ---
  if (isListError) {
    return (
      <div
        className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
        data-testid="policies-tab-error"
      >
        Failed to load policy sets. Please try again.
      </div>
    );
  }

  // --- Empty state ---
  if (policies.length === 0) {
    return (
      <Card data-testid="policies-tab-empty">
        <CardContent className="py-8 text-center text-muted-foreground">
          No policy sets found. Create a policy set to get started.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3" data-testid="policies-tab">
      {/* Left panel — policy set list */}
      <div className="space-y-3 lg:col-span-1">
        <h3 className="text-sm font-medium text-muted-foreground">Policy Sets</h3>
        {policies.map((policy) => (
          <Card
            key={policy.id}
            className={`cursor-pointer transition-colors hover:bg-accent/50 ${
              selectedId === policy.id ? "border-primary bg-accent/30" : ""
            }`}
            onClick={() => setSelectedId(policy.id)}
            data-testid={`policy-card-${policy.id}`}
          >
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{policy.name}</p>
                <p className="text-xs text-muted-foreground">v{policy.version}</p>
              </div>
              <Badge variant="secondary">
                {
                  POLICY_FIELDS.filter((f) => policy[f.key] !== null && policy[f.key] !== undefined)
                    .length
                }{" "}
                policies
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
              Select a policy set from the list to view and edit its configuration.
            </CardContent>
          </Card>
        ) : isLoadingDetail ? (
          <div className="space-y-4" data-testid="policy-detail-loading">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : selectedPolicy ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Edit Policy Set</span>
                  {saveSuccess && (
                    <Badge
                      variant="default"
                      className="bg-green-600"
                      data-testid="save-success-badge"
                    >
                      Saved
                    </Badge>
                  )}
                  {updateMutation.isError && (
                    <Badge variant="destructive" data-testid="save-error-badge">
                      Save failed
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  ID: {selectedPolicy.id} · Version: {selectedPolicy.version}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Name field */}
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Name</label>
                  <Input
                    value={editedName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    data-testid="policy-name-input"
                  />
                </div>

                {/* JSON policy fields */}
                {POLICY_FIELDS.map((field) => (
                  <JsonEditor
                    key={field.key}
                    label={field.label}
                    value={editedFields[field.key]}
                    onChange={(v) => handleFieldChange(field.key, v)}
                    minHeight={150}
                    data-testid={`policy-${field.key}`}
                  />
                ))}

                {/* Action buttons */}
                <div className="flex items-center justify-end gap-3 border-t pt-4">
                  <Button
                    variant="outline"
                    disabled={!isDirty}
                    onClick={() => {
                      // Reset to original values
                      if (selectedPolicy) {
                        const fields: Record<PolicyJsonKey, string> = {
                          schedulingPolicyJson: toJsonString(selectedPolicy.schedulingPolicyJson),
                          reviewPolicyJson: toJsonString(selectedPolicy.reviewPolicyJson),
                          mergePolicyJson: toJsonString(selectedPolicy.mergePolicyJson),
                          securityPolicyJson: toJsonString(selectedPolicy.securityPolicyJson),
                          validationPolicyJson: toJsonString(selectedPolicy.validationPolicyJson),
                          budgetPolicyJson: toJsonString(selectedPolicy.budgetPolicyJson),
                        };
                        setEditedFields(fields);
                        setEditedName(selectedPolicy.name);
                        setIsDirty(false);
                      }
                    }}
                    data-testid="policy-reset-btn"
                  >
                    Reset
                  </Button>
                  <Button
                    disabled={!isDirty || !allFieldsValid}
                    onClick={() => setShowConfirm(true)}
                    data-testid="policy-save-btn"
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
              entityName={editedName}
              changeDescription="This will update the policy set configuration. Changes take effect immediately."
              isSaving={updateMutation.isPending}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
