import { Badge } from "../../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

/**
 * Review Center page.
 *
 * Displays pending reviews, review history, and review assignment status.
 * Data integration and full feature implementation will be added in T097.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Review Center screen
 */
export default function ReviewsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Review Center</h1>
        <p className="text-muted-foreground">Track code reviews and approval status</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Reviews</CardTitle>
          <CardDescription>Review queues and assignment tracking coming in T097</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">Placeholder</Badge>
            <span>Full review center will be implemented in T097.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
