/**
 * Authorization context — resolved capabilities for a principal.
 *
 * @module lib/authz/context
 */

import { principalFromUser } from "./principal";
import { resolveAllPermissions } from "./resolvers";

import type { Permission } from "./permissions";
import type { Principal } from "./principal";
import type { OAuthUser } from "@/lib/auth/types";

/**
 * Resolved authorization state for a principal.
 * Permissions are derived at runtime — not persisted in the session cookie.
 */
export interface AuthorizationContext {
  principal: Principal;
  permissions: readonly Permission[];
}

/**
 * Resolve authorization context from an authenticated user.
 * Provider-specific adapters map identity into permissions; unknown providers get none.
 */
export function resolveAuthorizationContext(user: OAuthUser): AuthorizationContext {
  const principal = principalFromUser(user);
  const permissions = resolvePermissionsForUser(principal, user);

  return { principal, permissions };
}

function resolvePermissionsForUser(principal: Principal, user: OAuthUser): readonly Permission[] {
  return resolveAllPermissions({ principal, user });
}

/**
 * Serialize permissions for client-safe session responses.
 */
export function serializeAuthorizationContext(
  ctx: AuthorizationContext
): Pick<AuthorizationContext, "permissions"> & { principalId: string } {
  return {
    principalId: ctx.principal.id,
    permissions: ctx.permissions,
  };
}
