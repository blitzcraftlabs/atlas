/**
 * Generic OIDC start handler
 *
 * Same flow as /api/auth/google/start against any OpenID Connect issuer configured with
 * AUTH_OIDC_ISSUER and AUTH_OIDC_CLIENT_ID: PKCE (S256) verifier + CSRF state stored in the
 * temporary OAuth cookie, then a redirect to the issuer's authorization endpoint.
 *
 * @route GET /api/auth/oidc/start
 */

import { NextResponse } from "next/server";

import { getOidcConfig } from "@/config/oidc";
import { getServerConfig } from "@/config/server";
import { generateChallenge, generateVerifier } from "@/lib/auth/pkce";
import { buildOidcAuthUrl, discoverOidcProvider } from "@/lib/auth/providers/oidc";
import { setOAuthTempCookie } from "@/lib/auth/session";
import { generateState } from "@/lib/auth/state";

import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const config = getServerConfig();
  const appUrl = config.app.url || "http://localhost:3000";
  const oidc = getOidcConfig();

  if (!oidc.issuer || !oidc.clientId) {
    const errorUrl = new URL("/login", appUrl);
    errorUrl.searchParams.set("error", "oauth_not_configured");
    return NextResponse.redirect(errorUrl);
  }

  try {
    const returnTo = request.nextUrl.searchParams.get("returnTo");
    let validatedReturnTo: string | undefined;
    if (returnTo) {
      try {
        const returnToUrl = new URL(returnTo, appUrl);
        if (returnToUrl.origin === new URL(appUrl).origin) {
          validatedReturnTo = returnToUrl.pathname + returnToUrl.search;
        }
      } catch {
        // Invalid URL - ignore returnTo
      }
    }

    const discovery = await discoverOidcProvider(oidc.issuer);
    const verifier = generateVerifier();
    const challenge = await generateChallenge(verifier);
    const state = generateState();
    await setOAuthTempCookie({ verifier, state, returnTo: validatedReturnTo });

    return NextResponse.redirect(
      buildOidcAuthUrl(discovery, {
        clientId: oidc.clientId,
        redirectUri: `${appUrl}/api/auth/oidc/callback`,
        codeChallenge: challenge,
        state,
        scopes: oidc.scopes,
      })
    );
  } catch {
    const errorUrl = new URL("/login", appUrl);
    errorUrl.searchParams.set("error", "oauth_start_failed");
    return NextResponse.redirect(errorUrl);
  }
}
