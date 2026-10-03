/**
 * Permission resolver registry.
 *
 * Provider-specific adapters (e.g. reference harness) register here.
 * Core authz does not import reference modules directly.
 *
 * @module lib/authz/resolvers
 */

import type { Permission } from "./permissions";
import type { Principal } from "./principal";
import type { OAuthUser } from "@/lib/auth/types";

export interface PermissionResolverContext {
  principal: Principal;
  user: OAuthUser;
}

export type PermissionResolver = (ctx: PermissionResolverContext) => readonly Permission[];

const resolvers = new Map<string, PermissionResolver>();

/**
 * Register a named permission resolver (reference adapter, consumer mapping, etc.).
 * Repeated registration with the same id replaces the previous resolver — no duplicates.
 */
export function registerPermissionResolver(id: string, resolver: PermissionResolver): void {
  resolvers.set(id, resolver);
}

/** Reset resolvers (for tests). */
export function resetPermissionResolvers(): void {
  resolvers.clear();
}

/**
 * Resolve all permissions from registered resolvers.
 * When no resolver is registered, returns an empty list.
 */
export function resolveAllPermissions(ctx: PermissionResolverContext): readonly Permission[] {
  const granted = new Set<Permission>();

  for (const resolver of resolvers.values()) {
    for (const permission of resolver(ctx)) {
      granted.add(permission);
    }
  }

  return [...granted];
}
