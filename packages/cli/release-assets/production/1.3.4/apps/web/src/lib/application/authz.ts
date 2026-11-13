/**
 * Application authorization composition boundary.
 *
 * Connects core authz with consumer integrations. Register application-specific
 * permission resolvers and resource policies here.
 *
 * @module lib/application/authz
 */

import "server-only";

import { resetResourcePolicy } from "@/lib/authz/policy";
import { resetPermissionResolvers } from "@/lib/authz/resolvers";
import {
  authorizationErrorResponse as coreAuthorizationErrorResponse,
  authorize as coreAuthorize,
  authorizeResource as coreAuthorizeResource,
  canOnResource as coreCanOnResource,
  requireAuthorizationContext as coreRequireAuthorizationContext,
  requirePermission as coreRequirePermission,
  requirePrincipal as coreRequirePrincipal,
  requireResourcePermission as coreRequireResourcePermission,
} from "@/lib/authz/server";
import { enrichSessionResponse as coreEnrichSessionResponse } from "@/lib/authz/session-response";

import type { SessionData, SessionResponse } from "@/lib/auth/types";
import type { Permission } from "@/lib/authz/permissions";
import type { GlobalAuthorizationOptions, ResourceAuthorizationOptions } from "@/lib/authz/server";

let initialized = false;

/**
 * Idempotent bootstrap for permission resolver and resource policy registration.
 * Safe to call from any server entry point that resolves authorization context.
 */
export function ensureApplicationAuthzConfigured(): void {
  if (initialized) {
    return;
  }

  initialized = true;
}

/** Reset bootstrap and registry state (for tests). */
export function resetApplicationAuthzConfiguration(): void {
  initialized = false;
  resetPermissionResolvers();
  resetResourcePolicy();
}

export async function requirePrincipal() {
  ensureApplicationAuthzConfigured();
  return coreRequirePrincipal();
}

export async function requireAuthorizationContext() {
  ensureApplicationAuthzConfigured();
  return coreRequireAuthorizationContext();
}

export async function requirePermission(
  permission: Permission,
  options?: GlobalAuthorizationOptions
) {
  ensureApplicationAuthzConfigured();
  return coreRequirePermission(permission, options);
}

export async function requireResourcePermission(
  permission: Permission,
  options: ResourceAuthorizationOptions
) {
  ensureApplicationAuthzConfigured();
  return coreRequireResourcePermission(permission, options);
}

export function enrichSessionResponse(session: SessionData): SessionResponse {
  ensureApplicationAuthzConfigured();
  return coreEnrichSessionResponse(session);
}

export {
  coreAuthorizationErrorResponse as authorizationErrorResponse,
  coreAuthorize as authorize,
  coreAuthorizeResource as authorizeResource,
  coreCanOnResource as canOnResource,
};

export type { GlobalAuthorizationOptions, ResourceAuthorizationOptions } from "@/lib/authz/server";
