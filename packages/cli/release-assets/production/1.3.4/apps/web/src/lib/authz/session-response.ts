/**
 * Enrich session responses with resolved authorization context.
 *
 * @module lib/authz/session-response
 */

import "server-only";

import { resolveAuthorizationContext, serializeAuthorizationContext } from "./context";

import type { SessionData, SessionResponse } from "@/lib/auth/types";

/**
 * Build a client-safe session response including resolved permissions.
 */
export function enrichSessionResponse(session: SessionData): SessionResponse {
  const authz = resolveAuthorizationContext(session.user);
  const serialized = serializeAuthorizationContext(authz);

  return {
    authenticated: true,
    user: {
      email: session.user.email,
      name: session.user.name,
      avatarUrl: session.user.avatarUrl,
    },
    provider: session.user.provider,
    principalId: serialized.principalId,
    permissions: serialized.permissions,
  };
}
