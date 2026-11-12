/**
 * Generic OIDC provider tests.
 *
 * @jest-environment node
 */

import {
  buildOidcAuthUrl,
  clearOidcDiscoveryCache,
  discoverOidcProvider,
  exchangeOidcCode,
  fetchOidcUserInfo,
  refreshOidcTokens,
} from "@/lib/auth/providers/oidc";

// jest.setup.js replaces global URL with a minimal browser mock; use Node's URL like the
// existing OAuth tests do.
const { URL: NodeURL } = require("node:url") as { URL: typeof URL };
const originalURL = global.URL;
beforeAll(() => {
  global.URL = NodeURL;
});
afterAll(() => {
  global.URL = originalURL;
});

const ISSUER = "https://id.example.com";
const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/oauth/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  code_challenge_methods_supported: ["S256"],
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function fetchReturning(...bodies: [unknown, number?][]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const [body, status] = bodies[Math.min(calls.length - 1, bodies.length - 1)] ?? [{}, 200];
    return jsonResponse(body, status);
  }) as typeof fetch;
  return { impl, calls };
}

beforeEach(() => clearOidcDiscoveryCache());

describe("discoverOidcProvider", () => {
  it("loads, validates, and caches the discovery document", async () => {
    const { impl, calls } = fetchReturning([DISCOVERY]);
    await expect(discoverOidcProvider(`${ISSUER}/`, impl)).resolves.toMatchObject(DISCOVERY);
    await discoverOidcProvider(ISSUER, impl);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${ISSUER}/.well-known/openid-configuration`);
  });

  it("rejects issuer mismatch, missing endpoints, no S256, and plain http", async () => {
    await expect(
      discoverOidcProvider(
        ISSUER,
        fetchReturning([{ ...DISCOVERY, issuer: "https://evil.example" }]).impl
      )
    ).rejects.toThrow("does not match");
    await expect(
      discoverOidcProvider(ISSUER, fetchReturning([{ ...DISCOVERY, userinfo_endpoint: "" }]).impl)
    ).rejects.toThrow("userinfo_endpoint");
    await expect(
      discoverOidcProvider(
        ISSUER,
        fetchReturning([{ ...DISCOVERY, code_challenge_methods_supported: ["plain"] }]).impl
      )
    ).rejects.toThrow("S256");
    await expect(discoverOidcProvider("http://id.example.com")).rejects.toThrow("https");
  });
});

describe("authorization and tokens", () => {
  it("builds a PKCE S256 authorization URL", () => {
    const url = new URL(
      buildOidcAuthUrl(DISCOVERY, {
        clientId: "client",
        redirectUri: "https://app.example/api/auth/oidc/callback",
        codeChallenge: "challenge",
        state: "state",
      })
    );
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile offline_access");
  });

  it("exchanges the code with the verifier and omits a secret for public clients", async () => {
    const { impl, calls } = fetchReturning([
      { access_token: "at", refresh_token: "rt", expires_in: 60, token_type: "Bearer" },
    ]);
    const tokens = await exchangeOidcCode(
      DISCOVERY,
      { issuer: ISSUER, clientId: "public-client" },
      { code: "c", codeVerifier: "v", redirectUri: "https://app/cb" },
      impl
    );
    expect(tokens).toMatchObject({ accessToken: "at", refreshToken: "rt" });
    const body = new URLSearchParams(String(calls[0]?.init?.body));
    expect(body.get("code_verifier")).toBe("v");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.has("client_secret")).toBe(false);
  });

  it("keeps the previous refresh token when the issuer does not rotate it", async () => {
    const { impl } = fetchReturning([{ access_token: "new" }]);
    const tokens = await refreshOidcTokens(
      DISCOVERY,
      { issuer: ISSUER, clientId: "c", clientSecret: "s" },
      "old-refresh",
      impl
    );
    expect(tokens).toMatchObject({ accessToken: "new", refreshToken: "old-refresh" });
  });

  it("does not leak the provider error body", async () => {
    const { impl } = fetchReturning([{ error: "invalid_grant", code: "secret-code" }, 400]);
    await expect(
      exchangeOidcCode(
        DISCOVERY,
        { issuer: ISSUER, clientId: "c" },
        { code: "c", codeVerifier: "v", redirectUri: "r" },
        impl
      )
    ).rejects.toThrow("OIDC token request failed with status 400");
  });
});

describe("fetchOidcUserInfo", () => {
  it("normalizes claims to OAuthUser", async () => {
    const { impl, calls } = fetchReturning([
      { sub: "abc", email: "a@example.com", preferred_username: "alice", picture: "https://p" },
    ]);
    await expect(fetchOidcUserInfo(DISCOVERY, "at", impl)).resolves.toEqual({
      provider: "oidc",
      providerAccountId: "abc",
      email: "a@example.com",
      name: "alice",
      avatarUrl: "https://p",
    });
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer at");
  });

  it("requires sub", async () => {
    await expect(
      fetchOidcUserInfo(DISCOVERY, "at", fetchReturning([{ email: "x" }]).impl)
    ).rejects.toThrow("sub");
  });
});
