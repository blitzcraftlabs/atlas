/**
 * Principal — normalized authenticated identity.
 *
 * Authentication answers "who is this?". Authorization is resolved separately.
 *
 * @module lib/authz/principal
 */

import type { OAuthProvider, OAuthUser } from "@/lib/auth/types";

/**
 * Normalized principal derived from an authenticated user.
 * Intentionally minimal — provider-specific claims stay on OAuthUser.
 */
export interface Principal {
  /** Stable principal identifier for authorization and audit. */
  id: string;
  email?: string;
  provider?: OAuthProvider;
}

/**
 * Derive a Principal from the standard OAuthUser session contract.
 */
export function principalFromUser(user: OAuthUser): Principal {
  return {
    id: user.principalId ?? user.providerAccountId,
    email: user.email,
    provider: user.provider,
  };
}
