import { Badge } from "../../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

/**
 * Audit Explorer page.
 *
 * Displays the audit trail with filterable event log and detail views.
 * Data integration and full feature implementation will be added in T100.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Audit Explorer screen
 */
export default function AuditPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audit Explorer</h1>
        <p className="text-muted-foreground">Browse system events and audit trail</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Audit Log</CardTitle>
          <CardDescription>Event timeline and filtering coming in T100</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">Placeholder</Badge>
            <span>Full audit explorer will be implemented in T100.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
