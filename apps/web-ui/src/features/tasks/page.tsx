import { Badge } from "../../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

/**
 * Task Board page.
 *
 * Displays a filterable, paginated list of tasks with status indicators.
 * Data integration and full feature implementation will be added in T094.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Task Board screen
 */
export default function TasksPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Task Board</h1>
        <p className="text-muted-foreground">View and manage tasks across all projects</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
          <CardDescription>
            Task filtering, status columns, and pagination coming in T094
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">Placeholder</Badge>
            <span>Full task board will be implemented in T094.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
