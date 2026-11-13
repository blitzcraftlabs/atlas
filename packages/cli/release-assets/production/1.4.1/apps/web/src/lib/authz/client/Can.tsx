"use client";

/**
 * Presentation-only permission gate.
 *
 * **Client-side authorization controls presentation only. It is not a security boundary.**
 * Protected routes, API handlers, and mutations must enforce permissions on the server.
 *
 * @module lib/authz/client/Can
 */

import { hasClientPermission } from "../check";

import { usePermission } from "./usePermission";

import type { Permission } from "../permissions";
import type { ReactNode } from "react";

export interface CanProps {
  permission: Permission;
  children: ReactNode;
  /** Rendered when permission is denied (default: nothing). */
  fallback?: ReactNode;
  /** Pre-resolved permissions from a parent session source. */
  grantedPermissions?: readonly Permission[] | null;
}

function CanWithSession({ permission, children, fallback }: Omit<CanProps, "grantedPermissions">) {
  const allowed = usePermission(permission);

  if (!allowed) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

function CanWithGranted({
  permission,
  grantedPermissions,
  children,
  fallback,
}: Required<Pick<CanProps, "grantedPermissions">> & Omit<CanProps, "grantedPermissions">) {
  const allowed = hasClientPermission(grantedPermissions, permission);

  if (!allowed) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

/**
 * Renders children when the current session grants the permission.
 */
export function Can({ permission, children, fallback = null, grantedPermissions }: CanProps) {
  if (grantedPermissions !== undefined) {
    return (
      <CanWithGranted
        permission={permission}
        grantedPermissions={grantedPermissions}
        fallback={fallback}
      >
        {children}
      </CanWithGranted>
    );
  }

  return (
    <CanWithSession permission={permission} fallback={fallback}>
      {children}
    </CanWithSession>
  );
}
