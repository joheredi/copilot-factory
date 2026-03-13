/**
 * Prompt Templates list page.
 *
 * Displays all prompt templates in a table with columns for name, role,
 * version, and creation date. Supports filtering by role and creating
 * new templates via a dialog.
 *
 * @see docs/prd/007-technical-architecture.md §7.16
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { usePromptTemplates } from "../../api/hooks/use-prompt-templates.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Badge } from "../../components/ui/badge.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.js";
import { CreatePromptDialog } from "./components/CreatePromptDialog.js";

/** All agent roles for filtering. */
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
  });
}

export default function PromptsPage() {
  const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const navigate = useNavigate();

  const { data: templates, isLoading, isError } = usePromptTemplates(roleFilter);

  const templateList = templates ?? [];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Prompt Templates</h1>
          <p className="text-muted-foreground">Manage prompt templates for agent roles</p>
        </div>
        <Button
          size="sm"
          className="gap-2"
          onClick={() => setCreateDialogOpen(true)}
          data-testid="create-template-button"
        >
          <Plus className="h-4 w-4" />
          Create Template
        </Button>
      </div>

      {/* Create dialog */}
      <CreatePromptDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />

      {/* Error state */}
      {isError && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
          data-testid="templates-error"
        >
          <strong>Unable to load prompt templates.</strong> Check that the control-plane API is
          running.
        </div>
      )}

      {/* Role filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Role:</span>
        <Button
          variant={roleFilter === undefined ? "default" : "outline"}
          size="sm"
          onClick={() => setRoleFilter(undefined)}
        >
          All
        </Button>
        {ROLES.map(({ label, value }) => (
          <Button
            key={value}
            variant={roleFilter === value ? "default" : "outline"}
            size="sm"
            onClick={() => setRoleFilter(roleFilter === value ? undefined : value)}
            data-testid={`filter-role-${value}`}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* Count */}
      {!isLoading && !isError && (
        <p className="text-sm text-muted-foreground" data-testid="template-count">
          {templateList.length} template{templateList.length !== 1 ? "s" : ""}
          {roleFilter ? ` for ${roleFilter}` : ""}
        </p>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <Card data-testid="templates-skeleton">
          <CardContent className="p-6">
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {!isLoading && templateList.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table data-testid="templates-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templateList.map((template) => (
                  <TableRow
                    key={template.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/prompts/${template.id}`)}
                    data-testid={`template-row-${template.id}`}
                  >
                    <TableCell className="font-medium">{template.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{template.role}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{template.version}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(template.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !isError && templateList.length === 0 && (
        <div
          className="flex flex-col items-center justify-center rounded-md border border-dashed p-12 text-center"
          data-testid="templates-empty"
        >
          <p className="text-lg font-medium text-muted-foreground">No prompt templates found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {roleFilter
              ? "Try adjusting your role filter."
              : "Create a prompt template to get started."}
          </p>
        </div>
      )}
    </div>
  );
}
