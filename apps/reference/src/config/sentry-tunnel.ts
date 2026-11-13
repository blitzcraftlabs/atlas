/**
 * Sentry Tunnel Targets
 *
 * Resolves the Sentry ingest endpoints the `/monitoring` tunnel route is allowed to forward to.
 * Targets come only from the app's own configured DSNs (`NEXT_PUBLIC_SENTRY_DSN` used by the
 * browser SDK, and `SENTRY_DSN` used on the server). The tunnel never builds an upstream URL
 * from request input, so it cannot be used as an open proxy.
 *
 * Server-only: do not import in client components.
 *
 * @module config/sentry-tunnel
 */
import { clientEnv, serverEnv } from "@/env";

/**
 * A Sentry project the tunnel may forward envelopes to.
 */
export interface SentryTunnelTarget {
  /** Numeric organization ID from an `o<id>.ingest...` DSN host, or null for other hosts. */
  orgId: string | null;
  /** Numeric Sentry project ID from the DSN path. */
  projectId: string;
  /** Fixed envelope endpoint derived from the DSN. */
  upstreamUrl: string;
}

const ORG_HOST_PATTERN = /^o(\d+)\./;
const PROJECT_ID_PATTERN = /^\d+$/;

/**
 * Parse a Sentry DSN into a tunnel target. Returns null for malformed DSNs.
 *
 * @example
 * parseSentryDsn("https://key@o123.ingest.us.sentry.io/456")
 * // { orgId: "123", projectId: "456", upstreamUrl: "https://o123.ingest.us.sentry.io/api/456/envelope/" }
 */
export function parseSentryDsn(dsn: string): SentryTunnelTarget | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  const lastSlash = url.pathname.lastIndexOf("/");
  const projectId = url.pathname.slice(lastSlash + 1);
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    return null;
  }

  // Self-hosted DSNs may carry a path prefix before the project ID.
  const pathPrefix = url.pathname.slice(0, lastSlash);

  return {
    orgId: ORG_HOST_PATTERN.exec(url.hostname)?.[1] ?? null,
    projectId,
    upstreamUrl: `${url.protocol}//${url.host}${pathPrefix}/api/${projectId}/envelope/`,
  };
}

/**
 * All tunnel targets derived from the configured Sentry DSNs (deduplicated).
 * Empty when Sentry is not configured.
 */
export function getSentryTunnelTargets(): SentryTunnelTarget[] {
  const targets = new Map<string, SentryTunnelTarget>();

  for (const dsn of [clientEnv.NEXT_PUBLIC_SENTRY_DSN, serverEnv.SENTRY_DSN]) {
    if (!dsn) continue;
    const target = parseSentryDsn(dsn);
    if (target) {
      targets.set(target.upstreamUrl, target);
    }
  }

  return [...targets.values()];
}

/**
 * Find the configured target matching the tunnel request's `o` (org) and `p` (project) query
 * parameters. Returns null when the request does not address a configured project.
 */
export function resolveSentryTunnelTarget(
  orgId: string | null,
  projectId: string | null
): SentryTunnelTarget | null {
  if (!projectId) {
    return null;
  }

  return (
    getSentryTunnelTargets().find(
      (target) =>
        target.projectId === projectId && (target.orgId === null || target.orgId === orgId)
    ) ?? null
  );
}
