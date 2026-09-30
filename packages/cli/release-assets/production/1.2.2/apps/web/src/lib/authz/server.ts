/**
 * Server-side authorization enforcement.
 *
 * The authoritative security boundary for Atlas frontend routes and API handlers.
 *
 * @module lib/authz/server
 */

import "server-only";

import { NextResponse } from "next/server";

import { getServerSession } from "@/lib/auth/server";

import { logAuthorizationDenied } from "./audit";
import { can } from "./check";
import { resolveAuthorizationContext } from "./context";
import { AuthenticationRequiredError, PermissionDeniedError } from "./errors";
import { canOnResource, evaluateResourcePolicy, hasRegisteredResourcePolicy } from "./policy";
import { principalFromUser } from "./principal";

import type { AuthorizationContext } from "./context";
import type { Permission } from "./permissions";
import type { Principal } from "./principal";
import type { components } from "@/lib/api/contracts";

type ApiError = components["schemas"]["ApiError"];

export interface ResourceAuthorizationOptions {
  resourceType: string;
  resourceId?: string;
  correlationId?: string;
}

export interface GlobalAuthorizationOptions {
  /** Optional audit metadata — does not evaluate resource policy. */
  resourceType?: string;
  resourceId?: string;
  correlationId?: string;
}

/**
 * Require an authenticated principal or throw AuthenticationRequiredError.
 */
export async function requirePrincipal(): Promise<Principal> {
  const session = await getServerSession();

  if (!session) {
    throw new AuthenticationRequiredError();
  }

  return principalFromUser(session.user);
}

/**
 * Require an authenticated authorization context or throw AuthenticationRequiredError.
 */
export async function requireAuthorizationContext(): Promise<AuthorizationContext> {
  const session = await getServerSession();

  if (!session) {
    throw new AuthenticationRequiredError();
  }

  return resolveAuthorizationContext(session.user);
}

/**
 * Authorize a global typed permission against an existing context.
 * Does not evaluate consumer resource policy.
 */
export function authorize(
  ctx: AuthorizationContext,
  permission: Permission,
  options?: GlobalAuthorizationOptions
): void {
  if (can(ctx, permission)) {
    return;
  }

  logAuthorizationDenied({
    principalId: ctx.principal.id,
    permission,
    resourceType: options?.resourceType,
    resourceId: options?.resourceId,
    result: "denied",
    correlationId: options?.correlationId,
  });

  throw new PermissionDeniedError(permission);
}

/**
 * Authorize a global permission plus optional consumer resource policy.
 */
export async function authorizeResource(
  ctx: AuthorizationContext,
  permission: Permission,
  options: ResourceAuthorizationOptions
): Promise<void> {
  if (!can(ctx, permission)) {
    logAuthorizationDenied({
      principalId: ctx.principal.id,
      permission,
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      result: "denied",
      correlationId: options.correlationId,
    });

    throw new PermissionDeniedError(permission);
  }

  if (!hasRegisteredResourcePolicy()) {
    return;
  }

  const allowed = await evaluateResourcePolicy({
    principal: ctx.principal,
    action: permission,
    resourceType: options.resourceType,
    resourceId: options.resourceId,
  });

  if (allowed) {
    return;
  }

  logAuthorizationDenied({
    principalId: ctx.principal.id,
    permission,
    resourceType: options.resourceType,
    resourceId: options.resourceId,
    result: "denied",
    correlationId: options.correlationId,
  });

  throw new PermissionDeniedError(permission);
}

/**
 * Require authentication and a global typed permission.
 * Optional resourceType/resourceId are audit metadata only.
 */
export async function requirePermission(
  permission: Permission,
  options?: GlobalAuthorizationOptions
): Promise<AuthorizationContext> {
  const ctx = await requireAuthorizationContext();
  authorize(ctx, permission, options);
  return ctx;
}

/**
 * Require authentication, a global typed permission, and optional consumer resource policy.
 * Resource policy may further restrict an already-granted global permission.
 */
export async function requireResourcePermission(
  permission: Permission,
  options: ResourceAuthorizationOptions
): Promise<AuthorizationContext> {
  const ctx = await requireAuthorizationContext();
  await authorizeResource(ctx, permission, options);
  return ctx;
}

/**
 * Map authorization errors to standard API responses.
 * Returns null when the error is not an authz error.
 */
export function authorizationErrorResponse(
  error: unknown,
  correlationId: string
): NextResponse<ApiError> | null {
  if (error instanceof AuthenticationRequiredError) {
    return NextResponse.json<ApiError>(
      {
        code: "UNAUTHORIZED",
        message: error.message,
        userMessage: "Please log in to continue.",
        correlationId,
      },
      { status: 401 }
    );
  }

  if (error instanceof PermissionDeniedError) {
    return NextResponse.json<ApiError>(
      {
        code: "FORBIDDEN",
        message: error.message,
        userMessage: "You don't have permission to perform this action.",
        correlationId,
      },
      { status: 403 }
    );
  }

  return null;
}

export { canOnResource };
