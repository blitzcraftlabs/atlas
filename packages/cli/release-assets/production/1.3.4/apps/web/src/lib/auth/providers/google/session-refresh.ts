/**
 * Google OAuth Session Refresh (Reference Implementation)
 *
 * Provider-specific token refresh orchestration. The core session module
 * (`lib/auth/session.ts`) handles encrypted cookie storage only — this module
 * composes Google refresh with those primitives.
 *
 * @module lib/auth/providers/google/session-refresh
 */

import "server-only";

import { getServerConfig } from "@/config/server";
import { enrichSessionResponse } from "@/lib/application/authz";

import {
  createSessionCookie,
  destroySessionCookie,
  needsRefresh,
  readSession,
} from "../../session";
import { refreshAccessToken } from "../google";

import type { SessionData, SessionResponse } from "../../types";

/**
 * Refresh a Google OAuth session using the stored refresh token.
 *
 * Updates the encrypted session cookie with new token data.
 *
 * @param session - Current session data (must have refreshToken)
 * @returns Updated session data
 * @throws Error if refresh fails or provider is not Google
 */
export async function refreshGoogleSession(session: SessionData): Promise<SessionData> {
  if (!session.refreshToken) {
    throw new Error("No refresh token available");
  }

  if (session.user.provider !== "google") {
    throw new Error(`Refresh not implemented for provider: ${session.user.provider}`);
  }

  const config = getServerConfig();

  if (!config.auth.googleClientId || !config.auth.googleClientSecret) {
    throw new Error("Google OAuth is not configured");
  }

  const tokens = await refreshAccessToken(
    session.refreshToken,
    config.auth.googleClientId,
    config.auth.googleClientSecret
  );

  const updatedSession: SessionData = {
    ...session,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || session.refreshToken,
    accessTokenExpiresAt: tokens.expiresAt,
  };

  await createSessionCookie(updatedSession);

  return updatedSession;
}

/**
 * Read session and refresh Google access token when expiring soon.
 *
 * Reference integration behavior — not part of the provider-neutral session core.
 */
export async function readGoogleSessionWithRefresh(): Promise<SessionData | null> {
  const session = await readSession();

  if (!session) {
    return null;
  }

  if (needsRefresh(session) && session.refreshToken) {
    try {
      return await refreshGoogleSession(session);
    } catch {
      const now = Math.floor(Date.now() / 1000);
      if (session.accessTokenExpiresAt <= now) {
        await destroySessionCookie();
        return null;
      }
      return session;
    }
  }

  return session;
}

/**
 * Session response for `/api/auth/me` using Google refresh when needed.
 *
 * Returns only safe user information — no tokens.
 */
export async function getGoogleSessionResponse(): Promise<SessionResponse> {
  const session = await readGoogleSessionWithRefresh();

  if (!session) {
    return { authenticated: false };
  }

  return enrichSessionResponse(session);
}
