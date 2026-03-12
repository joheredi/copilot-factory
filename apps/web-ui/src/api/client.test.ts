// @vitest-environment jsdom
/**
 * Tests for the API fetch client.
 *
 * Validates the core HTTP wrapper that all hooks depend on:
 * - Correct URL construction from base URL + path
 * - JSON serialization and Content-Type headers
 * - Structured error extraction from non-2xx responses
 * - 204 No Content handling for DELETE operations
 * - Query string building from optional params
 *
 * Uses a stub fetch implementation to avoid real network calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  apiFetch,
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  ApiClientError,
  buildQueryString,
} from "./client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a factory that returns a fresh Response for each call. */
function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Creates a 204 No Content response. */
function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

/** Creates a non-JSON error response. */
function textErrorResponse(status: number, text: string): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain" } });
}

/** Creates a mock implementation that returns a fresh Response per call. */
function mockJsonResponse(body: unknown, status = 200) {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// buildQueryString
// ---------------------------------------------------------------------------

describe("buildQueryString", () => {
  /**
   * Validates that undefined/null params produce an empty string
   * so URLs are clean when no filters are applied.
   */
  it("returns empty string for undefined params", () => {
    expect(buildQueryString(undefined)).toBe("");
    expect(buildQueryString({})).toBe("");
  });

  /**
   * Validates that params are correctly encoded into a query string
   * and undefined values are excluded.
   */
  it("builds query string from params, skipping undefined/null", () => {
    const qs = buildQueryString({ page: 1, limit: 20, status: undefined, name: null });
    expect(qs).toBe("?page=1&limit=20");
  });

  it("encodes special characters", () => {
    const qs = buildQueryString({ q: "hello world" });
    expect(qs).toBe("?q=hello+world");
  });
});

// ---------------------------------------------------------------------------
// apiFetch
// ---------------------------------------------------------------------------

describe("apiFetch", () => {
  /**
   * Validates that the fetch wrapper correctly constructs the URL
   * using the default /api base URL and the provided path.
   */
  it("sends request to /api + path", async () => {
    fetchSpy.mockResolvedValue(fakeResponse({ id: "1" }));
    const result = await apiFetch<{ id: string }>("/projects");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/projects");
    expect(result).toEqual({ id: "1" });
  });

  /**
   * Validates that JSON Content-Type and Accept headers are set by
   * default so the backend receives and returns JSON.
   */
  it("sets Content-Type and Accept JSON headers", async () => {
    fetchSpy.mockResolvedValue(fakeResponse({}));
    await apiFetch("/test");
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.headers).toEqual(
      expect.objectContaining({
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
    );
  });

  /**
   * Validates that 204 responses (DELETE) return undefined
   * without trying to parse the empty body as JSON.
   */
  it("returns undefined for 204 No Content", async () => {
    fetchSpy.mockResolvedValue(noContentResponse());
    const result = await apiFetch<void>("/projects/1", { method: "DELETE" });
    expect(result).toBeUndefined();
  });

  /**
   * Validates that non-2xx responses throw ApiClientError with the
   * structured error body from the backend exception filter.
   */
  it("throws ApiClientError with structured body on 4xx", async () => {
    const errorBody = {
      statusCode: 404,
      error: "Not Found",
      message: "Project not found",
      timestamp: "2025-01-01T00:00:00.000Z",
      path: "/api/projects/xyz",
    };
    // Must return a fresh Response per call (body can only be read once)
    fetchSpy.mockImplementation(mockJsonResponse(errorBody, 404));

    await expect(apiFetch("/projects/xyz")).rejects.toThrow(ApiClientError);

    try {
      await apiFetch("/projects/xyz");
    } catch (err) {
      const apiErr = err as ApiClientError;
      expect(apiErr.statusCode).toBe(404);
      expect(apiErr.body).toEqual(errorBody);
      expect(apiErr.message).toBe("Project not found");
    }
  });

  /**
   * Validates that non-JSON error responses still produce an
   * ApiClientError (with null body) rather than crashing.
   */
  it("throws ApiClientError with null body for non-JSON error responses", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(textErrorResponse(500, "Internal Server Error")),
    );

    try {
      await apiFetch("/test");
    } catch (err) {
      const apiErr = err as ApiClientError;
      expect(apiErr).toBeInstanceOf(ApiClientError);
      expect(apiErr.statusCode).toBe(500);
      expect(apiErr.body).toBeNull();
      expect(apiErr.message).toBe("API request failed with status 500");
    }
  });
});

// ---------------------------------------------------------------------------
// Convenience methods
// ---------------------------------------------------------------------------

describe("apiGet", () => {
  /**
   * Validates that apiGet sends a GET request and appends query params.
   */
  it("sends GET with query parameters", async () => {
    fetchSpy.mockResolvedValue(fakeResponse({ data: [] }));
    await apiGet("/tasks", { page: 2, limit: 10 });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/tasks?page=2&limit=10");
    expect(init?.method).toBe("GET");
  });
});

describe("apiPost", () => {
  /**
   * Validates that apiPost sends a POST with a JSON-serialized body.
   */
  it("sends POST with JSON body", async () => {
    fetchSpy.mockResolvedValue(fakeResponse({ id: "new" }, 201));
    const result = await apiPost<{ id: string }>("/projects", { name: "test" });
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ name: "test" }));
    expect(result).toEqual({ id: "new" });
  });
});

describe("apiPut", () => {
  /**
   * Validates that apiPut sends a PUT with a JSON-serialized body.
   */
  it("sends PUT with JSON body", async () => {
    fetchSpy.mockResolvedValue(fakeResponse({ id: "1", name: "updated" }));
    await apiPut("/projects/1", { name: "updated" });
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JSON.stringify({ name: "updated" }));
  });
});

describe("apiDelete", () => {
  /**
   * Validates that apiDelete sends a DELETE and handles 204 correctly.
   */
  it("sends DELETE and returns void", async () => {
    fetchSpy.mockResolvedValue(noContentResponse());
    const result = await apiDelete("/projects/1");
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.method).toBe("DELETE");
    expect(result).toBeUndefined();
  });
});
