/**
 * Typed HTTP client for the Factory control-plane REST API.
 *
 * Provides a thin fetch wrapper that handles JSON serialization,
 * query-string encoding, and structured error extraction. Every
 * request returns a typed promise or throws an {@link ApiClientError}.
 *
 * The base URL defaults to `/api` so that the Vite dev proxy
 * forwards requests to the control-plane backend at localhost:3000.
 * Override by setting the `VITE_API_BASE_URL` environment variable.
 *
 * @module
 */

import type { ApiError } from "./types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Resolves the API base URL.
 *
 * In development, Vite's proxy rewrites `/api` to the backend.
 * In production the SPA is served from the same origin so `/api` works
 * directly. An env var override is supported for flexibility.
 */
export function getApiBaseUrl(): string {
  // Vite exposes env vars prefixed with VITE_ on `import.meta.env`

  const envUrl = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) as
    | string
    | undefined;
  return envUrl ?? "/api";
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Error thrown when an API request returns a non-2xx status.
 *
 * Wraps the structured error body returned by the control-plane
 * exception filter so callers can inspect status codes, messages,
 * and validation details programmatically.
 */
export class ApiClientError extends Error {
  /** HTTP status code from the response. */
  public readonly statusCode: number;
  /** Structured error body from the API, when available. */
  public readonly body: ApiError | null;

  constructor(statusCode: number, body: ApiError | null, message?: string) {
    super(message ?? body?.message ?? `API request failed with status ${statusCode}`);
    this.name = "ApiClientError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Query-string helper
// ---------------------------------------------------------------------------

/**
 * Builds a URL query string from a flat params object.
 *
 * Skips `undefined` and `null` values so callers can pass optional
 * filter params without pre-filtering.
 */
export function buildQueryString(params?: Record<string, unknown>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return "";
  const qs = new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
  return `?${qs}`;
}

// ---------------------------------------------------------------------------
// Core fetch helpers
// ---------------------------------------------------------------------------

/**
 * Performs a typed JSON fetch against the control-plane API.
 *
 * Handles response parsing, error extraction, and 204 No Content.
 * All higher-level request methods delegate to this function.
 *
 * @typeParam T - Expected response body type.
 * @param path   - API path relative to the base URL (e.g. `/projects`).
 * @param init   - Standard fetch RequestInit overrides.
 * @returns Parsed response body (or `undefined` for 204).
 * @throws {ApiClientError} When the response status is outside 200–299.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let body: ApiError | null = null;
    try {
      body = (await response.json()) as ApiError;
    } catch {
      // Response body is not JSON — leave body null
    }
    throw new ApiClientError(response.status, body);
  }

  // 204 No Content — return undefined cast to T (callers type T as void)
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Convenience methods
// ---------------------------------------------------------------------------

/**
 * Sends a GET request and returns the parsed JSON response.
 *
 * @typeParam T - Expected response body type.
 * @param path   - API path (e.g. `/projects`).
 * @param params - Optional query parameters appended to the URL.
 */
export function apiGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  return apiFetch<T>(`${path}${buildQueryString(params)}`, { method: "GET" });
}

/**
 * Sends a POST request with a JSON body.
 *
 * @typeParam T - Expected response body type.
 * @param path - API path (e.g. `/projects`).
 * @param body - Request payload serialized as JSON.
 */
export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}

/**
 * Sends a PUT request with a JSON body.
 *
 * @typeParam T - Expected response body type.
 * @param path - API path (e.g. `/projects/abc`).
 * @param body - Request payload serialized as JSON.
 */
export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

/**
 * Sends a DELETE request. Returns void (expects 204 No Content).
 *
 * @param path - API path (e.g. `/projects/abc`).
 */
export function apiDelete(path: string): Promise<void> {
  return apiFetch<void>(path, { method: "DELETE" });
}
