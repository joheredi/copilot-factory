import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Controller, Get, Module } from "@nestjs/common";

import { configureStaticServing } from "./configure-static-serving.js";

// ── Test fixtures ──────────────────────────────────────────────────────

const TEST_INDEX_HTML = `<!DOCTYPE html>
<html><head><title>Test SPA</title></head>
<body><div id="root"></div></body></html>`;

const TEST_JS_CONTENT = `console.log("hello");`;
const TEST_CSS_CONTENT = `body { margin: 0; }`;

/**
 * Minimal NestJS controller that simulates real API routes.
 * Used to verify that NestJS controller routes take precedence
 * over the static file wildcard route.
 */
@Controller()
class TestApiController {
  @Get("health")
  getHealth() {
    return { status: "ok" };
  }

  @Get("tasks")
  getTasks() {
    return [{ id: 1, title: "test task" }];
  }

  @Get("tasks/:id")
  getTask() {
    return { id: "1", title: "test task" };
  }
}

@Module({
  controllers: [TestApiController],
})
class TestApiModule {}

// ── Validation tests ───────────────────────────────────────────────────

/**
 * Tests for dist path validation logic in configureStaticServing.
 *
 * These tests verify that the function fails fast with clear error messages
 * when the dist directory is missing or doesn't contain index.html, which
 * prevents confusing runtime errors when the web-ui hasn't been built.
 */
describe("configureStaticServing – validation", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestApiModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Validates that a missing dist directory produces a clear error
   * pointing the user to run the web-ui build command.
   */
  it("throws when dist directory does not exist", async () => {
    await expect(configureStaticServing(app, "/nonexistent/path/to/dist")).rejects.toThrow(
      "Web UI dist directory not found",
    );
  });

  /**
   * Validates that a dist directory without index.html produces
   * a clear error. This catches cases where the build output
   * is incomplete or the path points to the wrong directory.
   */
  it("throws when index.html is missing from dist directory", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "static-serve-test-"));
    try {
      await expect(configureStaticServing(app, tmpDir)).rejects.toThrow("index.html not found");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Integration tests ──────────────────────────────────────────────────

/**
 * Integration tests that verify the full static serving behavior:
 * - Static files (JS, CSS, images) are served with correct content
 * - SPA fallback returns index.html for unknown client-side routes
 * - NestJS API routes are unaffected and still return JSON
 * - Subdirectory files are served correctly
 *
 * These tests create a temporary dist directory with realistic file
 * structure, configure a NestJS test application with static serving,
 * and make HTTP requests via Fastify's inject() method.
 */
describe("configureStaticServing – integration", () => {
  let app: NestFastifyApplication;
  let tmpDir: string;

  beforeAll(async () => {
    // Create a temporary dist directory with test files
    tmpDir = mkdtempSync(join(tmpdir(), "static-serve-integration-"));
    writeFileSync(join(tmpDir, "index.html"), TEST_INDEX_HTML);

    // Create assets subdirectory with bundled files (mimics Vite output)
    mkdirSync(join(tmpDir, "assets"), { recursive: true });
    writeFileSync(join(tmpDir, "assets", "index-abc123.js"), TEST_JS_CONTENT);
    writeFileSync(join(tmpDir, "assets", "index-abc123.css"), TEST_CSS_CONTENT);

    // Create a favicon at root level
    writeFileSync(join(tmpDir, "favicon.ico"), "fake-icon-data");

    // Build NestJS test application with API routes
    const moduleRef = await Test.createTestingModule({
      imports: [TestApiModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

    // Configure static serving before init (mirrors bootstrap order)
    await configureStaticServing(app, tmpDir);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Static file serving ────────────────────────────────────────────

  /**
   * Verifies that GET / returns the SPA index.html.
   * This is the primary entry point for the web application.
   */
  it("serves index.html for GET /", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toBe(TEST_INDEX_HTML);
  });

  /**
   * Verifies that JavaScript bundle files from the assets directory
   * are served correctly. These are the compiled React application
   * chunks produced by Vite's build.
   */
  it("serves JS files from assets directory", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/assets/index-abc123.js",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(TEST_JS_CONTENT);
  });

  /**
   * Verifies that CSS files from the assets directory are served.
   */
  it("serves CSS files from assets directory", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/assets/index-abc123.css",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(TEST_CSS_CONTENT);
  });

  /**
   * Verifies that root-level static files (like favicon.ico) are
   * served correctly.
   */
  it("serves root-level static files", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/favicon.ico",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("fake-icon-data");
  });

  // ── SPA fallback ──────────────────────────────────────────────────

  /**
   * Verifies that unknown GET paths return index.html for client-side
   * routing. When a user navigates to /dashboard in the browser, the
   * server should return the SPA shell and let React Router handle
   * the route on the client side.
   */
  it("returns index.html for unknown client-side routes (SPA fallback)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/dashboard",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toBe(TEST_INDEX_HTML);
  });

  /**
   * Verifies SPA fallback works for deeply nested routes.
   * React Router commonly uses nested paths like /projects/123/tasks.
   */
  it("returns index.html for deeply nested client-side routes", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/projects/123/tasks",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toBe(TEST_INDEX_HTML);
  });

  // ── API route precedence ──────────────────────────────────────────

  /**
   * Verifies that NestJS controller routes are NOT affected by static
   * file serving. The /health endpoint must return JSON, not index.html.
   * This is critical: if API routes break, the application is unusable.
   */
  it("does not interfere with GET /health API route", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  /**
   * Verifies that collection API routes still return JSON data.
   */
  it("does not interfere with GET /tasks API route", async () => {
    const response = await app.inject({ method: "GET", url: "/tasks" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ id: 1, title: "test task" }]);
  });

  /**
   * Verifies that parametric API routes (with path parameters) still
   * work correctly. Fastify matches parametric routes before wildcards.
   */
  it("does not interfere with GET /tasks/:id API route", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/tasks/1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: "1", title: "test task" });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  /**
   * Verifies that URL-encoded paths are handled correctly.
   * File paths with special characters should be decoded before
   * filesystem lookup.
   */
  it("handles URL-encoded paths", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/assets/index-abc123.js?v=12345",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(TEST_JS_CONTENT);
  });
});
