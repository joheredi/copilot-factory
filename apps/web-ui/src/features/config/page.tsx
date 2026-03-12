import { Badge } from "../../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

/**
 * Configuration Editor page.
 *
 * Displays hierarchical policy configuration for projects, pools, and tasks.
 * Data integration and full feature implementation will be added in T099.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Configuration screen
 */
export default function ConfigPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
        <p className="text-muted-foreground">Manage factory policies and project settings</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>
            Policy editor and configuration management coming in T099
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">Placeholder</Badge>
            <span>Full configuration editor will be implemented in T099.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
