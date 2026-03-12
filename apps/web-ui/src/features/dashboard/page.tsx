import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";

/**
 * Dashboard overview page.
 *
 * Displays system health summary cards for the Factory operator.
 * This is the landing page after login. Data integration will
 * be added in T090 (API client with TanStack Query).
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Dashboard screen
 */
export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">System overview and health status</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatusCard title="Tasks" value="—" description="Active tasks" />
        <StatusCard title="Workers" value="—" description="Online workers" />
        <StatusCard title="Reviews" value="—" description="Pending reviews" />
        <StatusCard title="Merge Queue" value="—" description="Queued merges" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest task transitions and system events</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">Waiting for data</Badge>
            <span>Connect the API client (T090) to see live data.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Summary status card showing a metric with label.
 * Displays placeholder values until API integration is complete.
 */
function StatusCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
