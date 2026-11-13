/**
 * Verifies the shared MSW v2 server intercepts requests in the Jest environment.
 */

import { http, HttpResponse } from "msw";

import { fixtures } from "../../fixtures";
import { server } from "../msw";

const API = "http://api.test";

describe("MSW test server", () => {
  it("serves the default health handler", async () => {
    const response = await fetch(`${API}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(fixtures.api.healthSuccess);
  });

  it("passes query parameters to the users list handler", async () => {
    const response = await fetch(`${API}/users?page=2&pageSize=5`);

    await expect(response.json()).resolves.toEqual(
      fixtures.api.userListSuccess({ page: 2, pageSize: 5 })
    );
  });

  it("reads JSON bodies and route params for mutations", async () => {
    const created = await fetch(`${API}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", name: "New User" }),
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      email: "new@example.com",
      name: "New User",
    });

    const updated = await fetch(`${API}/users/user-42`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    await expect(updated.json()).resolves.toMatchObject({ id: "user-42", name: "Renamed" });

    const deleted = await fetch(`${API}/users/user-42`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
  });

  it("supports per-test overrides with server.use", async () => {
    server.use(
      http.get("*/health", () => HttpResponse.json({ status: "degraded" }, { status: 503 }))
    );

    const response = await fetch(`${API}/health`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "degraded" });
  });
});
