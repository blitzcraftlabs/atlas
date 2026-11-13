/**
 * MSW (Mock Service Worker) Setup for Tests
 *
 * Provides a configured MSW server for intercepting HTTP requests during tests.
 * This allows testing components and hooks that make API calls without hitting real endpoints.
 *
 * Uses the MSW v2 API (`http` handlers returning `HttpResponse`).
 */

import { URL as NodeURL } from "node:url";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { fixtures } from "../fixtures";

/**
 * Default MSW handlers for common API endpoints.
 *
 * These can be overridden per-test using `server.use(...)`.
 */
export const defaultHandlers = [
  // Health check endpoint
  http.get("*/health", () => {
    return HttpResponse.json(fixtures.api.healthSuccess);
  }),

  // Users list endpoint
  http.get("*/users", ({ request }) => {
    // Node's URL: jest.setup.js replaces the global URL with a partial mock without searchParams.
    const url = new NodeURL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const pageSize = parseInt(url.searchParams.get("pageSize") || "20");

    return HttpResponse.json(fixtures.api.userListSuccess({ page, pageSize }));
  }),

  // User detail endpoint
  http.get("*/users/:userId", ({ params }) => {
    const { userId } = params;
    return HttpResponse.json(fixtures.api.userDetailSuccess({ userId: userId as string }));
  }),

  // User create endpoint
  http.post("*/users", async ({ request }) => {
    const body = (await request.json()) as { email: string; name: string };
    return HttpResponse.json(fixtures.api.userCreateSuccess(body), { status: 201 });
  }),

  // User update endpoint
  http.patch("*/users/:userId", async ({ params, request }) => {
    const { userId } = params;
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      fixtures.api.userUpdateSuccess({
        userId: userId as string,
        updates: body,
      })
    );
  }),

  // User delete endpoint
  http.delete("*/users/:userId", () => {
    return new HttpResponse(null, { status: 204 });
  }),
];

/**
 * MSW server instance.
 * Use this to override handlers per-test.
 */
export const server = setupServer(...defaultHandlers);

/**
 * Setup MSW lifecycle hooks.
 * Call this in your global test setup file (jest.setup.js).
 */
export function setupMSW() {
  // Start server before all tests
  beforeAll(() => {
    server.listen({
      onUnhandledRequest: "warn",
    });
  });

  // Reset handlers after each test
  afterEach(() => {
    server.resetHandlers();
  });

  // Clean up after all tests
  afterAll(() => {
    server.close();
  });
}
