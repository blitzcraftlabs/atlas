/**
 * Generic OIDC route and session-refresh tests.
 *
 * @jest-environment node
 */

import { cookies } from "next/headers";

import { GET as oidcCallback } from "@/app/api/auth/oidc/callback/route";
import { GET as oidcStart } from "@/app/api/auth/oidc/start/route";
import { POST as refresh } from "@/app/api/auth/refresh/route";
import { refreshOidcSession } from "@/lib/auth/providers/oidc/session-refresh";
import { createSessionCookie, readSession, setOAuthTempCookie } from "@/lib/auth/session";
import { generateState } from "@/lib/auth/state";

import type { SessionData } from "@/lib/auth/types";

const { URL: NodeURL } = require("node:url") as { URL: typeof URL };

jest.mock("next/server", () => ({
  NextResponse: {
    redirect(url: URL | string) {
      const location = typeof url === "string" ? url : url.toString();
      return {
        status: 307,
        headers: { get: (name: string) => (name.toLowerCase() === "location" ? location : null) },
      };
    },
    json(body: unknown, init?: { status?: number }) {
      return { status: init?.status ?? 200, json: async () => body, body };
    },
  },
}));

const ISSUER = "https://id.example.com";
const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
};

jest.mock("@/lib/auth/providers/oidc", () => {
  const actual = jest.requireActual("@/lib/auth/providers/oidc");
  return {
    ...actual,
    discoverOidcProvider: jest.fn(),
    exchangeOidcCode: jest.fn(),
    fetchOidcUserInfo: jest.fn(),
    refreshOidcTokens: jest.fn(),
  };
});

const oidc = jest.requireMock("@/lib/auth/providers/oidc") as {
  discoverOidcProvider: jest.Mock;
  exchangeOidcCode: jest.Mock;
  fetchOidcUserInfo: jest.Mock;
  refreshOidcTokens: jest.Mock;
};

function request(url: string) {
  return { nextUrl: new NodeURL(url) } as never;
}

function location(response: { headers: { get: (name: string) => string | null } }) {
  return String(response.headers.get("location"));
}

function oidcSession(overrides: Partial<SessionData> = {}): SessionData {
  const now = Math.floor(Date.now() / 1000);
  return {
    user: {
      provider: "oidc",
      providerAccountId: "sub-1",
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
    },
    accessToken: "old-access",
    refreshToken: "old-refresh",
    accessTokenExpiresAt: now + 60,
    createdAt: now,
    expiresAt: now + 86_400,
    ...overrides,
  };
}

const originalURL = global.URL;

beforeEach(() => {
  global.URL = NodeURL;
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  process.env.AUTH_SESSION_SECRET = "test-session-secret-32-chars-min";
  process.env.AUTH_OIDC_ISSUER = ISSUER;
  process.env.AUTH_OIDC_CLIENT_ID = "oidc-client";
  process.env.AUTH_OIDC_CLIENT_SECRET = "oidc-secret";
  process.env.AUTH_OIDC_SCOPES = "openid email";
  oidc.discoverOidcProvider.mockReset();
  oidc.exchangeOidcCode.mockReset();
  oidc.fetchOidcUserInfo.mockReset();
  oidc.refreshOidcTokens.mockReset();
  oidc.discoverOidcProvider.mockResolvedValue(DISCOVERY);
});

afterAll(() => {
  global.URL = originalURL;
});

describe("/api/auth/oidc/start", () => {
  it("redirects to the issuer with PKCE, configured scopes, and a temp cookie", async () => {
    const response = await oidcStart(
      request("http://localhost:3000/api/auth/oidc/start?returnTo=/dashboard")
    );
    const url = new NodeURL(location(response));
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/oidc/callback"
    );
    const temp = JSON.parse(String((await cookies()).get("atlas_oauth_tmp")?.value)) as {
      returnTo?: string;
    };
    expect(temp.returnTo).toBe("/dashboard");
  });

  it("drops an external returnTo and ignores a malformed one", async () => {
    await oidcStart(
      request("http://localhost:3000/api/auth/oidc/start?returnTo=https://evil.example/x")
    );
    let temp = JSON.parse(String((await cookies()).get("atlas_oauth_tmp")?.value)) as {
      returnTo?: string;
    };
    expect(temp.returnTo).toBeUndefined();
    await oidcStart(request("http://localhost:3000/api/auth/oidc/start?returnTo=http://%zz"));
    temp = JSON.parse(String((await cookies()).get("atlas_oauth_tmp")?.value)) as {
      returnTo?: string;
    };
    expect(temp.returnTo).toBeUndefined();
  });

  it("reports missing configuration and discovery failures", async () => {
    oidc.discoverOidcProvider.mockRejectedValue(new Error("down"));
    expect(
      location(await oidcStart(request("http://localhost:3000/api/auth/oidc/start")))
    ).toContain("error=oauth_start_failed");
    delete process.env.AUTH_OIDC_ISSUER;
    expect(
      location(await oidcStart(request("http://localhost:3000/api/auth/oidc/start")))
    ).toContain("error=oauth_not_configured");
  });
});

describe("/api/auth/oidc/callback", () => {
  const base = "http://localhost:3000/api/auth/oidc/callback";

  it("rejects missing configuration, provider errors, missing params, cookie, and bad state", async () => {
    expect(location(await oidcCallback(request(`${base}?error=access_denied`)))).toContain(
      "error=oauth_denied"
    );
    expect(location(await oidcCallback(request(`${base}?code=c`)))).toContain(
      "error=missing_params"
    );
    expect(location(await oidcCallback(request(`${base}?code=c&state=s`)))).toContain(
      "error=missing_state"
    );
    await setOAuthTempCookie({ verifier: "v", state: generateState() });
    expect(
      location(await oidcCallback(request(`${base}?code=c&state=${generateState()}`)))
    ).toContain("error=invalid_state");
    delete process.env.AUTH_OIDC_CLIENT_ID;
    expect(location(await oidcCallback(request(`${base}?code=c&state=s`)))).toContain(
      "error=oauth_not_configured"
    );
  });

  it("creates a session with the PKCE verifier and redirects to returnTo", async () => {
    const state = generateState();
    await setOAuthTempCookie({ verifier: "the-verifier", state, returnTo: "/after" });
    oidc.exchangeOidcCode.mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      idToken: null,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      tokenType: "Bearer",
    });
    oidc.fetchOidcUserInfo.mockResolvedValue(oidcSession().user);

    const response = await oidcCallback(request(`${base}?code=the-code&state=${state}`));
    expect(location(response)).toBe("http://localhost:3000/after");
    expect(oidc.exchangeOidcCode).toHaveBeenCalledWith(
      DISCOVERY,
      { issuer: ISSUER, clientId: "oidc-client", clientSecret: "oidc-secret" },
      {
        code: "the-code",
        codeVerifier: "the-verifier",
        redirectUri: "http://localhost:3000/api/auth/oidc/callback",
      }
    );
    const session = await readSession();
    expect(session?.user.provider).toBe("oidc");
    expect(session?.refreshToken).toBe("rt");
  });

  it("redirects to the app root when there is no returnTo, and fails closed on exchange errors", async () => {
    let state = generateState();
    await setOAuthTempCookie({ verifier: "v", state });
    oidc.exchangeOidcCode.mockResolvedValue({
      accessToken: "at",
      refreshToken: null,
      idToken: null,
      expiresAt: 0,
      tokenType: "Bearer",
    });
    oidc.fetchOidcUserInfo.mockResolvedValue(oidcSession().user);
    expect(location(await oidcCallback(request(`${base}?code=c&state=${state}`)))).toBe(
      "http://localhost:3000/"
    );

    state = generateState();
    await setOAuthTempCookie({ verifier: "v", state });
    oidc.exchangeOidcCode.mockRejectedValue(new Error("bad code"));
    expect(location(await oidcCallback(request(`${base}?code=c&state=${state}`)))).toContain(
      "error=oauth_failed"
    );
  });
});

describe("OIDC session refresh", () => {
  it("refreshes through /api/auth/refresh and keeps the refresh token when not rotated", async () => {
    await createSessionCookie(oidcSession());
    oidc.refreshOidcTokens.mockResolvedValue({
      accessToken: "new-access",
      refreshToken: null,
      idToken: null,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      tokenType: "Bearer",
    });
    const response = (await refresh()) as unknown as { status: number };
    expect(response.status).toBe(200);
    const session = await readSession();
    expect(session?.accessToken).toBe("new-access");
    expect(session?.refreshToken).toBe("old-refresh");
  });

  it("refuses other providers, missing refresh tokens, and missing configuration", async () => {
    await expect(
      refreshOidcSession(oidcSession({ user: { ...oidcSession().user, provider: "google" } }))
    ).rejects.toThrow("Refresh not implemented");
    await expect(refreshOidcSession(oidcSession({ refreshToken: null }))).rejects.toThrow(
      "No refresh token"
    );
    delete process.env.AUTH_OIDC_ISSUER;
    await expect(refreshOidcSession(oidcSession())).rejects.toThrow("OIDC is not configured");
  });
});
