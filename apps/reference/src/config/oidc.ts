/**
 * Generic OIDC configuration
 *
 * Reads `AUTH_OIDC_*` server environment variables for the generic OpenID Connect provider.
 * This module is self-contained on purpose: it does not extend the shared env schema or the
 * application config facade, so consumers who upgrade Atlas do not need to edit their own
 * `src/env/**` or `src/config/{schema,server}.ts` to keep typechecking.
 *
 * Server-only: do not import in client components.
 *
 * @module config/oidc
 */
import { z } from "zod";

const oidcEnvSchema = z.object({
  AUTH_OIDC_ISSUER: z.string().url().optional(),
  AUTH_OIDC_CLIENT_ID: z.string().min(1).optional(),
  AUTH_OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  AUTH_OIDC_SCOPES: z.string().optional(),
});

export interface OidcConfig {
  /** Issuer URL; enables `/api/auth/oidc/*` together with `clientId`. */
  issuer?: string;
  clientId?: string;
  /** @security Server-only - never expose to client */
  clientSecret?: string;
  /** Requested scopes; provider default when undefined. */
  scopes?: string[];
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

/**
 * Current OIDC settings. Invalid values (for example a malformed issuer URL) are treated as
 * "not configured" so the routes fail closed with `oauth_not_configured`.
 */
export function getOidcConfig(env: Record<string, string | undefined> = process.env): OidcConfig {
  const parsed = oidcEnvSchema.safeParse({
    AUTH_OIDC_ISSUER: emptyToUndefined(env.AUTH_OIDC_ISSUER),
    AUTH_OIDC_CLIENT_ID: emptyToUndefined(env.AUTH_OIDC_CLIENT_ID),
    AUTH_OIDC_CLIENT_SECRET: emptyToUndefined(env.AUTH_OIDC_CLIENT_SECRET),
    AUTH_OIDC_SCOPES: emptyToUndefined(env.AUTH_OIDC_SCOPES),
  });
  if (!parsed.success) {
    return {};
  }
  const values = parsed.data;
  return {
    issuer: values.AUTH_OIDC_ISSUER,
    clientId: values.AUTH_OIDC_CLIENT_ID,
    clientSecret: values.AUTH_OIDC_CLIENT_SECRET,
    scopes: values.AUTH_OIDC_SCOPES?.split(/\s+/).filter(Boolean),
  };
}
