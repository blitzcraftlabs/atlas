/**
 * Structured audit logging for denied authorization attempts.
 *
 * Records safe metadata only — never tokens, cookies, or sensitive payloads.
 *
 * @module lib/authz/audit
 */

import "server-only";

import { log } from "@/lib/logging/logger.server";

import type { Permission } from "./permissions";

export interface AuthorizationDeniedEvent {
  principalId: string;
  permission: Permission;
  resourceType?: string;
  resourceId?: string;
  result: "denied";
  correlationId?: string;
}

/**
 * Record a denied authorization attempt for observability and audit trails.
 */
export function logAuthorizationDenied(event: AuthorizationDeniedEvent): void {
  log.warn(
    {
      event: "authorization.denied",
      principalId: event.principalId,
      permission: event.permission,
      ...(event.resourceType && { resourceType: event.resourceType }),
      ...(event.resourceId && { resourceId: event.resourceId }),
      result: event.result,
      ...(event.correlationId && { correlationId: event.correlationId }),
    },
    "Authorization denied"
  );
}
