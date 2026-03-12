import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { PoliciesTab } from "./components/policies-tab.js";
import { PoolsTab } from "./components/pools-tab.js";
import { EffectiveConfigTab } from "./components/effective-config-tab.js";

/**
 * Configuration Editor page.
 *
 * Provides a tabbed interface for viewing and modifying factory configuration:
 * - **Policies**: View and edit policy sets (scheduling, review, merge, security,
 *   validation, budget) with JSON editors and save-with-confirmation workflow.
 * - **Pools**: Edit worker pool settings (concurrency, provider, runtime, model,
 *   capabilities, scope rules) with form fields and JSON editors.
 * - **Effective Config**: Read-only view of the fully resolved configuration
 *   produced by merging all active layers.
 *
 * Each tab uses existing API hooks for data fetching and mutations with
 * TanStack Query, receiving real-time updates via WebSocket cache invalidation.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Configuration screen
 * @see T099 — Build configuration editor view
 */
export default function ConfigPage() {
  return (
    <div className="space-y-6" data-testid="config-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
        <p className="text-muted-foreground">
          Manage factory policies, pool settings, and view effective configuration
        </p>
      </div>

      <Tabs defaultValue="policies" data-testid="config-tabs">
        <TabsList>
          <TabsTrigger value="policies" data-testid="tab-policies">
            Policies
          </TabsTrigger>
          <TabsTrigger value="pools" data-testid="tab-pools">
            Pools
          </TabsTrigger>
          <TabsTrigger value="effective" data-testid="tab-effective">
            Effective Config
          </TabsTrigger>
        </TabsList>

        <TabsContent value="policies">
          <PoliciesTab />
        </TabsContent>

        <TabsContent value="pools">
          <PoolsTab />
        </TabsContent>

        <TabsContent value="effective">
          <EffectiveConfigTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
