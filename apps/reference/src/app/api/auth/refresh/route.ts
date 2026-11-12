/**
 * Session Refresh Handler
 *
 * Forces a token refresh on the server side.
 * Updates the session cookie with new tokens.
 *
 * @route POST /api/auth/refresh
 */

import { NextResponse } from "next/server";

import { refreshGoogleSession } from "@/lib/auth/providers/google/session-refresh";
import { refreshOidcSession } from "@/lib/auth/providers/oidc/session-refresh";
import { refreshReferenceSession } from "@/lib/auth/providers/reference/session-refresh";
import { readSession } from "@/lib/auth/session";

export async function POST() {
  try {
    const session = await readSession();

    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (session.user.provider === "reference") {
      await refreshReferenceSession(session);
      return NextResponse.json({ success: true }, { status: 200 });
    }

    if (!session.refreshToken) {
      return NextResponse.json({ error: "No refresh token available" }, { status: 400 });
    }

    if (session.user.provider === "oidc") {
      await refreshOidcSession(session);
    } else {
      await refreshGoogleSession(session);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  }
}
