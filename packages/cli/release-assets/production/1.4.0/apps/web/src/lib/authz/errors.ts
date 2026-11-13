/**
 * Authorization error types.
 *
 * Distinguishes unauthenticated (401) from forbidden (403).
 *
 * @module lib/authz/errors
 */

import type { Permission } from "./permissions";

/**
 * Thrown when an operation requires authentication but no session exists.
 */
export class AuthenticationRequiredError extends Error {
  readonly code = "UNAUTHORIZED" as const;

  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

/**
 * Thrown when the principal is authenticated but lacks the required permission.
 */
export class PermissionDeniedError extends Error {
  readonly code = "FORBIDDEN" as const;
  readonly permission: Permission;

  constructor(permission: Permission, message?: string) {
    super(message ?? `Permission denied: ${permission}`);
    this.name = "PermissionDeniedError";
    this.permission = permission;
  }
}
