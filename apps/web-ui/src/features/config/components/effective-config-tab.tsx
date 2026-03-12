import { useEffectiveConfig } from "../../../api/hooks/use-policies.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../components/ui/card.js";
import { Badge } from "../../../components/ui/badge.js";
import { JsonEditor } from "./json-editor.js";

/**
 * Effective configuration tab for the configuration editor.
 *
 * Displays the fully resolved factory configuration produced by merging
 * all configuration layers (system defaults → environment → organization →
 * pool → task type → operator overrides). Read-only view intended for
 * operators to verify what configuration is actually in effect.
 *
 * The effective config endpoint resolves the hierarchical 8-layer
 * configuration model and returns both the merged result and the
 * individual layers that contributed to it.
 *
 * @see T099 — Build configuration editor view
 */
export function EffectiveConfigTab() {
  const { data, isLoading, isError } = useEffectiveConfig();

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="effective-config-loading">
        {[1, 2].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
        data-testid="effective-config-error"
      >
        Failed to load effective configuration. Please try again.
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const effectiveJson = JSON.stringify(data.effective, null, 2);
  const layerCount = data.layers.length;

  return (
    <div className="space-y-6" data-testid="effective-config-tab">
      {/* Resolved configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Effective Configuration
            <Badge variant="secondary">{layerCount} layers</Badge>
          </CardTitle>
          <CardDescription>
            The fully resolved configuration produced by merging all active configuration layers.
            This is what the factory uses at runtime.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JsonEditor
            value={effectiveJson}
            onChange={() => {}}
            readOnly
            minHeight={300}
            data-testid="effective-config-json"
          />
        </CardContent>
      </Card>

      {/* Individual layers */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration Layers</CardTitle>
          <CardDescription>
            Each layer in the configuration hierarchy, from lowest priority (system defaults) to
            highest (operator overrides). Higher layers override values from lower layers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.layers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No configuration layers found.</p>
          ) : (
            data.layers.map((layer, index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">Layer {index + 1}</Badge>
                  {index === data.layers.length - 1 && (
                    <Badge variant="default">Highest Priority</Badge>
                  )}
                  {index === 0 && layerCount > 1 && <Badge variant="secondary">Base</Badge>}
                </div>
                <JsonEditor
                  value={JSON.stringify(layer, null, 2)}
                  onChange={() => {}}
                  readOnly
                  minHeight={100}
                  data-testid={`config-layer-${index}`}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
