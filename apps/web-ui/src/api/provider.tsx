/**
 * TanStack Query provider component for the Factory web UI.
 *
 * Wraps the application with a `QueryClientProvider` that supplies
 * a pre-configured `QueryClient` with sensible defaults for the
 * Factory operator dashboard:
 *
 * - **staleTime 30 s** — avoids refetching on every mount while still
 *   keeping data reasonably fresh for a monitoring dashboard.
 * - **retry 1** — retries once on transient failures; the operator
 *   dashboard should surface errors quickly rather than blocking the UI.
 * - **refetchOnWindowFocus true** — re-syncs when the operator returns
 *   to the browser tab.
 *
 * @module
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * Creates a `QueryClient` with the Factory default options.
 *
 * Exported so that tests and Storybook can create isolated instances.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

/** Singleton query client used by the production app. */
let defaultClient: QueryClient | undefined;

/**
 * Returns the singleton `QueryClient`.
 *
 * Lazily created on first access to avoid side-effects at import time.
 */
export function getDefaultQueryClient(): QueryClient {
  if (!defaultClient) {
    defaultClient = createQueryClient();
  }
  return defaultClient;
}

/**
 * Props for the {@link ApiProvider} component.
 */
export interface ApiProviderProps {
  /** Override the query client (useful for tests). */
  readonly client?: QueryClient;
  readonly children: ReactNode;
}

/**
 * Provides TanStack Query context to the component tree.
 *
 * Wraps children with `QueryClientProvider`. Pass a custom `client`
 * prop for tests; otherwise the singleton production client is used.
 *
 * @example
 * ```tsx
 * <ApiProvider>
 *   <App />
 * </ApiProvider>
 * ```
 */
export function ApiProvider({ client, children }: ApiProviderProps) {
  return (
    <QueryClientProvider client={client ?? getDefaultQueryClient()}>{children}</QueryClientProvider>
  );
}
