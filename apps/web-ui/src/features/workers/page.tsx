import { Badge } from "../../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

/**
 * Worker Pools monitoring page.
 *
 * Displays worker pool status, capacity, and health metrics.
 * Data integration and full feature implementation will be added in T096.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Worker Pools screen
 */
export default function WorkersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Worker Pools</h1>
        <p className="text-muted-foreground">Monitor worker capacity and health across pools</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Pools</CardTitle>
          <CardDescription>
            Pool status cards and worker health monitoring coming in T096
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">Placeholder</Badge>
            <span>Full worker pool monitoring will be implemented in T096.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
