"use client";

/**
 * Client hook for permission-based UI gating.
 *
 * **Client-side authorization controls presentation only. It is not a security boundary.**
 * Server enforcement via `@/lib/authz/server` is required for all protected actions.
 *
 * When session permissions are already available from a parent `useSession()` call, prefer
 * `hasClientPermission(sessionPermissions, permission)` to avoid duplicate session consumers.
 *
 * @module lib/authz/client/usePermission
 */

import { useSession } from "@/lib/auth";

import { hasClientPermission } from "../check";

import type { Permission } from "../permissions";

/**
 * Returns whether the current session grants a permission (for UI gating only).
 */
export function usePermission(permission: Permission): boolean {
  const { status, permissions } = useSession();

  if (status !== "authenticated") {
    return false;
  }

  return hasClientPermission(permissions, permission);
}
