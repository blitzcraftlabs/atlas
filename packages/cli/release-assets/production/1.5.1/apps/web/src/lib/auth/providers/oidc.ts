/**
 * Generic OpenID Connect provider
 *
 * Authorization Code flow with PKCE (S256) against any standards-compliant OIDC issuer
 * (Auth0, Okta, Microsoft Entra ID, Keycloak, Zitadel, Clerk, Cognito, ...). Endpoints come
 * from the issuer's discovery document, so no vendor-specific code is needed.
 *
 * User identity is read from the UserInfo endpoint with the access token over TLS, which
 * matches the Google provider and avoids local ID-token signature handling.
 *
 * @see https://openid.net/specs/openid-connect-discovery-1_0.html
 * @module lib/auth/providers/oidc
 */

import "server-only";

import type { OAuthTokens, OAuthUser } from "../types";

export const DEFAULT_OIDC_SCOPES = ["openid", "email", "profile", "offline_access"];

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  code_challenge_methods_supported?: string[];
}

export interface OidcClientConfig {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
}

type FetchLike = typeof fetch;

const discoveryCache = new Map<string, { document: OidcDiscoveryDocument; expiresAt: number }>();
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

function normalizeIssuer(issuer: string): string {
  return issuer.replace(/\/+$/, "");
}

function assertSecureIssuer(issuer: string): void {
  const url = new URL(issuer);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !isLocal) {
    throw new Error("OIDC issuer must use https");
  }
}

/** Test helper: clear cached discovery documents. */
export function clearOidcDiscoveryCache(): void {
  discoveryCache.clear();
}

/**
 * Fetch and validate the issuer's discovery document. The document's `issuer` must equal the
 * configured issuer (OIDC Discovery §4.3), which prevents a mix-up with another issuer.
 */
export async function discoverOidcProvider(
  issuer: string,
  fetchImpl: FetchLike = fetch
): Promise<OidcDiscoveryDocument> {
  const normalized = normalizeIssuer(issuer);
  assertSecureIssuer(normalized);
  const cached = discoveryCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.document;
  }

  const response = await fetchImpl(`${normalized}/.well-known/openid-configuration`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`OIDC discovery failed with status ${response.status}`);
  }
  const document = (await response.json()) as Partial<OidcDiscoveryDocument>;
  if (normalizeIssuer(document.issuer ?? "") !== normalized) {
    throw new Error("OIDC discovery issuer does not match the configured issuer");
  }
  for (const key of ["authorization_endpoint", "token_endpoint", "userinfo_endpoint"] as const) {
    if (typeof document[key] !== "string" || document[key].length === 0) {
      throw new Error(`OIDC discovery document is missing ${key}`);
    }
  }
  if (
    document.code_challenge_methods_supported &&
    !document.code_challenge_methods_supported.includes("S256")
  ) {
    throw new Error("OIDC issuer does not support PKCE S256");
  }

  const validated = document as OidcDiscoveryDocument;
  discoveryCache.set(normalized, { document: validated, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return validated;
}

export function buildOidcAuthUrl(
  discovery: OidcDiscoveryDocument,
  params: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state: string;
    scopes?: string[];
  }
): string {
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (params.scopes ?? DEFAULT_OIDC_SCOPES).join(" "));
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  return url.toString();
}

function toTokens(
  data: Record<string, unknown>,
  previousRefreshToken?: string | null
): OAuthTokens {
  if (typeof data.access_token !== "string" || data.access_token.length === 0) {
    throw new Error("OIDC token response is missing access_token");
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    accessToken: data.access_token,
    refreshToken:
      typeof data.refresh_token === "string" ? data.refresh_token : (previousRefreshToken ?? null),
    idToken: typeof data.id_token === "string" ? data.id_token : null,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    tokenType: typeof data.token_type === "string" ? data.token_type : "Bearer",
  };
}

async function postToken(
  discovery: OidcDiscoveryDocument,
  body: Record<string, string>,
  fetchImpl: FetchLike
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
  });
  if (!response.ok) {
    // Do not include the provider's body: it can echo codes or client details into logs.
    throw new Error(`OIDC token request failed with status ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

function clientCredentials(config: OidcClientConfig): Record<string, string> {
  return config.clientSecret
    ? { client_id: config.clientId, client_secret: config.clientSecret }
    : { client_id: config.clientId };
}

export async function exchangeOidcCode(
  discovery: OidcDiscoveryDocument,
  config: OidcClientConfig,
  params: { code: string; codeVerifier: string; redirectUri: string },
  fetchImpl: FetchLike = fetch
): Promise<OAuthTokens> {
  const data = await postToken(
    discovery,
    {
      ...clientCredentials(config),
      grant_type: "authorization_code",
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
    },
    fetchImpl
  );
  return toTokens(data);
}

export async function refreshOidcTokens(
  discovery: OidcDiscoveryDocument,
  config: OidcClientConfig,
  refreshToken: string,
  fetchImpl: FetchLike = fetch
): Promise<OAuthTokens> {
  const data = await postToken(
    discovery,
    { ...clientCredentials(config), grant_type: "refresh_token", refresh_token: refreshToken },
    fetchImpl
  );
  return toTokens(data, refreshToken);
}

export async function fetchOidcUserInfo(
  discovery: OidcDiscoveryDocument,
  accessToken: string,
  fetchImpl: FetchLike = fetch
): Promise<OAuthUser> {
  const response = await fetchImpl(discovery.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`OIDC userinfo request failed with status ${response.status}`);
  }
  const data = (await response.json()) as Record<string, unknown>;
  if (typeof data.sub !== "string" || data.sub.length === 0) {
    throw new Error("OIDC userinfo response is missing sub");
  }
  const email = typeof data.email === "string" ? data.email : "";
  let name: string | null = null;
  if (typeof data.name === "string") {
    name = data.name;
  } else if (typeof data.preferred_username === "string") {
    name = data.preferred_username;
  }
  return {
    provider: "oidc",
    providerAccountId: data.sub,
    email,
    name,
    avatarUrl: typeof data.picture === "string" ? data.picture : null,
  };
}
