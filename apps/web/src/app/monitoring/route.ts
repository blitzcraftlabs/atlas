/**
 * Sentry Tunnel API Route
 *
 * Proxies Sentry envelope requests from the browser to the Sentry ingest
 * endpoint. This avoids CORS issues and ad-blocker interference.
 *
 * The @sentry/nextjs SDK's `tunnelRoute` option creates Next.js rewrites,
 * but these don't work reliably with Turbopack's dev server. This explicit
 * API route handles the same traffic pattern.
 *
 * The SDK sends envelopes to: /monitoring?o=<orgId>&p=<projectId>&r=<region>
 *
 * Security: the upstream URL is never built from request input. The `o`/`p`
 * parameters only select one of the app's configured DSNs (see
 * `@/config/sentry-tunnel`); requests for any other project are rejected, and
 * the request body is capped. This keeps the route from acting as an open
 * proxy (SSRF).
 *
 * @module app/monitoring/route
 */

import { NextResponse } from "next/server";

import { resolveSentryTunnelTarget } from "@/config/sentry-tunnel";
import { log } from "@/lib/logging/logger.server";

import type { NextRequest } from "next/server";

/**
 * Maximum envelope size accepted by the tunnel (2 MiB). Browser envelopes,
 * including compressed replay segments, are well under this.
 */
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;

/**
 * Read the request body as bytes, enforcing `maxBytes` on the bytes actually received
 * (Content-Length is optional, so it cannot be the only cap). Returns null when too large.
 * Bytes, not text: replay envelopes contain binary (compressed) payloads.
 */
async function readBodyWithLimit(
  request: NextRequest,
  maxBytes: number
): Promise<Uint8Array | null> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return null;
  }

  if (!request.body) {
    return new Uint8Array(0);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const orgId = searchParams.get("o");
  const projectId = searchParams.get("p");

  if (!projectId) {
    return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
  }

  const target = resolveSentryTunnelTarget(orgId, projectId);
  if (!target) {
    return NextResponse.json({ error: "Unknown Sentry project" }, { status: 403 });
  }

  const body = await readBodyWithLimit(request, MAX_ENVELOPE_BYTES);
  if (body === null) {
    log.warn(
      { event: "sentry_tunnel_envelope_rejected", projectId, maxBytes: MAX_ENVELOPE_BYTES },
      "Sentry envelope dropped: exceeds tunnel size limit"
    );
    return NextResponse.json({ error: "Envelope too large" }, { status: 413 });
  }

  let response: Response;
  try {
    response = await fetch(target.upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
      },
      body,
      redirect: "manual",
    });
  } catch (error) {
    log.warn(
      {
        event: "sentry_tunnel_upstream_failed",
        projectId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Sentry envelope dropped: upstream request failed"
    );
    return NextResponse.json({ error: "Sentry upstream unavailable" }, { status: 502 });
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "text/plain",
    },
  });
}
