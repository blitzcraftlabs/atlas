/**
 * Generic OIDC session refresh.
 *
 * Mirrors the Google refresh module: provider-specific token refresh composed with the
 * provider-neutral encrypted session primitives in `lib/auth/session.ts`.
 *
 * @module lib/auth/providers/oidc/session-refresh
 */

import "server-only";

import { getServerConfig } from "@/config/server";

import { createSessionCookie } from "../../session";
import { discoverOidcProvider, refreshOidcTokens } from "../oidc";

import type { SessionData } from "../../types";

export async function refreshOidcSession(session: SessionData): Promise<SessionData> {
  if (!session.refreshToken) {
    throw new Error("No refresh token available");
  }
  if (session.user.provider !== "oidc") {
    throw new Error(`Refresh not implemented for provider: ${session.user.provider}`);
  }

  const { oidc } = getServerConfig().auth;
  if (!oidc.issuer || !oidc.clientId) {
    throw new Error("OIDC is not configured");
  }

  const discovery = await discoverOidcProvider(oidc.issuer);
  const tokens = await refreshOidcTokens(
    discovery,
    { issuer: oidc.issuer, clientId: oidc.clientId, clientSecret: oidc.clientSecret },
    session.refreshToken
  );

  const updated: SessionData = {
    ...session,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || session.refreshToken,
    accessTokenExpiresAt: tokens.expiresAt,
  };
  await createSessionCookie(updated);
  return updated;
}
