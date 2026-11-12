/**
 * Generic OIDC callback handler
 *
 * Validates CSRF state, exchanges the code with the PKCE verifier, reads the user from the
 * issuer's UserInfo endpoint, and creates the encrypted session cookie.
 *
 * @route GET /api/auth/oidc/callback
 */

import { NextResponse } from "next/server";

import { getServerConfig } from "@/config/server";
import {
  discoverOidcProvider,
  exchangeOidcCode,
  fetchOidcUserInfo,
} from "@/lib/auth/providers/oidc";
import { consumeOAuthTempCookie, createSessionCookie } from "@/lib/auth/session";
import { verifyState } from "@/lib/auth/state";

import type { SessionData } from "@/lib/auth/types";
import type { NextRequest } from "next/server";

function loginError(appUrl: string, code: string) {
  const errorUrl = new URL("/login", appUrl);
  errorUrl.searchParams.set("error", code);
  return NextResponse.redirect(errorUrl);
}

export async function GET(request: NextRequest) {
  const config = getServerConfig();
  const appUrl = config.app.url || "http://localhost:3000";
  const { oidc } = config.auth;

  if (!oidc.issuer || !oidc.clientId) {
    return loginError(appUrl, "oauth_not_configured");
  }

  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    if (request.nextUrl.searchParams.get("error")) {
      return loginError(appUrl, "oauth_denied");
    }
    if (!code || !state) {
      return loginError(appUrl, "missing_params");
    }

    const tempState = await consumeOAuthTempCookie();
    if (!tempState) {
      return loginError(appUrl, "missing_state");
    }
    if (!verifyState(state, tempState.state)) {
      return loginError(appUrl, "invalid_state");
    }

    const discovery = await discoverOidcProvider(oidc.issuer);
    const tokens = await exchangeOidcCode(
      discovery,
      { issuer: oidc.issuer, clientId: oidc.clientId, clientSecret: oidc.clientSecret },
      {
        code,
        codeVerifier: tempState.verifier,
        redirectUri: `${appUrl}/api/auth/oidc/callback`,
      }
    );
    const user = await fetchOidcUserInfo(discovery, tokens.accessToken);

    const now = Math.floor(Date.now() / 1000);
    const sessionData: SessionData = {
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.expiresAt,
      createdAt: now,
      expiresAt: now + config.auth.sessionTtlSeconds,
    };
    await createSessionCookie(sessionData);

    return NextResponse.redirect(new URL(tempState.returnTo || "/", appUrl));
  } catch {
    return loginError(appUrl, "oauth_failed");
  }
}
