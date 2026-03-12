/**
 * Public API for the data-fetching layer.
 *
 * All feature views should import from `../api` rather than
 * reaching into internal modules.
 *
 * @module
 */

// Client utilities
export {
  apiFetch,
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  ApiClientError,
  getApiBaseUrl,
  buildQueryString,
} from "./client";

// Provider
export { ApiProvider, createQueryClient, getDefaultQueryClient } from "./provider";
export type { ApiProviderProps } from "./provider";

// Query keys
export { queryKeys } from "./query-keys";

// All hooks
export * from "./hooks/index";

// Types
export type * from "./types";
