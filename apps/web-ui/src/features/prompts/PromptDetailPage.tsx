/**
 * Prompt Template detail / editor page.
 *
 * Displays a single prompt template with editable fields for name, role,
 * version, and the prompt text. Supports saving changes and deletion
 * with confirmation.
 *
 * @see docs/prd/007-technical-architecture.md §7.16
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import {
  usePromptTemplate,
  useUpdatePromptTemplate,
  useDeletePromptTemplate,
} from "../../api/hooks/use-prompt-templates.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Badge } from "../../components/ui/badge.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";
import { Textarea } from "../../components/ui/textarea.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";

/** All agent roles. */
const ROLES = [
  { label: "Planner", value: "planner" },
  { label: "Developer", value: "developer" },
  { label: "Reviewer", value: "reviewer" },
  { label: "Lead Reviewer", value: "lead-reviewer" },
  { label: "Merge Assist", value: "merge-assist" },
  { label: "Validator", value: "validator" },
];

/** Formats an ISO timestamp to a readable date string. */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PromptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: template, isLoading, isError } = usePromptTemplate(id);
  const updateMutation = useUpdatePromptTemplate(id ?? "");
  const deleteMutation = useDeletePromptTemplate();

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [version, setVersion] = useState("");
  const [templateText, setTemplateText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Populate form when template loads
  useEffect(() => {
    if (template) {
      setName(template.name);
      setRole(template.role);
      setVersion(template.version);
      setTemplateText(template.templateText);
      setDirty(false);
      setSaveError(null);
      setSaveSuccess(false);
    }
  }, [template]);

  const markDirty = useCallback(() => {
    setDirty(true);
    setSaveSuccess(false);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(() => {
    if (!id || updateMutation.isPending) return;
    updateMutation.mutate(
      { name, role, version, templateText },
      {
        onSuccess: () => {
          setDirty(false);
          setSaveSuccess(true);
          setSaveError(null);
        },
        onError: (err) => {
          setSaveError(err instanceof Error ? err.message : "Failed to save. Please try again.");
        },
      },
    );
  }, [id, name, role, version, templateText, updateMutation]);

  const handleDelete = useCallback(() => {
    if (!id || deleteMutation.isPending) return;
    deleteMutation.mutate(id, {
      onSuccess: () => {
        navigate("/prompts");
      },
      onError: (err) => {
        setSaveError(err instanceof Error ? err.message : "Failed to delete. Please try again.");
        setDeleteDialogOpen(false);
      },
    });
  }, [id, deleteMutation, navigate]);

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6" data-testid="prompt-detail-skeleton">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-muted" />
        <Card>
          <CardContent className="p-6">
            <div className="h-64 animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error / not found
  if (isError || !template) {
    return (
      <div className="space-y-4" data-testid="prompt-detail-error">
        <Link to="/prompts">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to templates
          </Button>
        </Link>
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <strong>Template not found.</strong> The template may have been deleted or the ID is
          invalid.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <Link to="/prompts">
        <Button variant="ghost" size="sm" className="gap-2" data-testid="back-to-templates">
          <ArrowLeft className="h-4 w-4" />
          Back to templates
        </Button>
      </Link>

      {/* Header with actions */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight" data-testid="template-name-heading">
            {template.name}
          </h1>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{template.role}</Badge>
            <span className="text-sm text-muted-foreground font-mono">v{template.version}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-2 text-destructive hover:text-destructive"
            onClick={() => setDeleteDialogOpen(true)}
            data-testid="delete-template-button"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
          <Button
            size="sm"
            className="gap-2"
            disabled={!dirty || updateMutation.isPending}
            onClick={handleSave}
            data-testid="save-template-button"
          >
            <Save className="h-4 w-4" />
            {updateMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Feedback banners */}
      {saveSuccess && (
        <div
          className="rounded-md border border-green-500/50 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400"
          data-testid="save-success"
        >
          Template saved successfully.
        </div>
      )}
      {saveError && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
          data-testid="save-error"
        >
          {saveError}
        </div>
      )}

      {/* Metadata */}
      <div className="text-sm text-muted-foreground">Created {formatDate(template.createdAt)}</div>

      {/* Editable fields */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Template Settings</CardTitle>
          <CardDescription>Name, role, and version metadata</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="template-name">Name</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  markDirty();
                }}
                data-testid="edit-template-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-role">Role</Label>
              <Select
                value={role}
                onValueChange={(v) => {
                  setRole(v);
                  markDirty();
                }}
              >
                <SelectTrigger id="template-role" data-testid="edit-template-role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-version">Version</Label>
              <Input
                id="template-version"
                value={version}
                onChange={(e) => {
                  setVersion(e.target.value);
                  markDirty();
                }}
                data-testid="edit-template-version"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Prompt text editor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Prompt Text</CardTitle>
          <CardDescription>
            The template text sent to the AI agent. Supports variable placeholders.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={templateText}
            onChange={(e) => {
              setTemplateText(e.target.value);
              markDirty();
            }}
            className="min-h-[400px] font-mono text-sm"
            placeholder="Enter the prompt template text…"
            data-testid="edit-template-text"
          />
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent data-testid="delete-template-dialog">
          <DialogHeader>
            <DialogTitle>Delete Prompt Template</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{template.name}&rdquo;? This action cannot be
              undone. Any agent profiles referencing this template will lose their prompt
              configuration.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              data-testid="confirm-delete-template"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
