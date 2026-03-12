import { Badge } from "../../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

/**
 * Merge Queue page.
 *
 * Displays the merge queue with pending, in-progress, and completed merges.
 * Data integration and full feature implementation will be added in T098.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Merge Queue screen
 */
export default function MergeQueuePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Merge Queue</h1>
        <p className="text-muted-foreground">Monitor merge operations and conflict resolution</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Queue</CardTitle>
          <CardDescription>Merge queue status and conflict tracking coming in T098</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">Placeholder</Badge>
            <span>Full merge queue view will be implemented in T098.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
