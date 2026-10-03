/**
 * Consumer-supplied resource policy seam.
 *
 * Global capability checks are typed centrally; resource ownership and domain
 * policy can further restrict already-granted permissions via this extension point.
 *
 * @module lib/authz/policy
 */

import { hasPermission } from "./check";

import type { AuthorizationContext } from "./context";
import type { Permission } from "./permissions";
import type { Principal } from "./principal";

export interface ResourcePolicyContext {
  principal: Principal;
  resourceType: string;
  resourceId?: string;
  action: Permission;
}

export type ResourcePolicyFn = (ctx: ResourcePolicyContext) => boolean | Promise<boolean>;

const resourcePolicies = new Map<string, ResourcePolicyFn>();

/**
 * Register a named consumer resource policy function.
 * Repeated registration with the same id replaces the previous policy — no duplicates.
 */
export function registerResourcePolicy(id: string, fn: ResourcePolicyFn): void {
  resourcePolicies.set(id, fn);
}

/**
 * Reset all resource policies (for tests).
 */
export function resetResourcePolicy(): void {
  resourcePolicies.clear();
}

/**
 * Whether any consumer resource policy is registered.
 */
export function hasRegisteredResourcePolicy(): boolean {
  return resourcePolicies.size > 0;
}

/**
 * Evaluate all registered consumer resource policies.
 * All applicable policies must allow — returns false when none are registered.
 */
export async function evaluateResourcePolicy(ctx: ResourcePolicyContext): Promise<boolean> {
  if (resourcePolicies.size === 0) {
    return false;
  }

  for (const policy of resourcePolicies.values()) {
    const allowed = await policy(ctx);
    if (!allowed) {
      return false;
    }
  }

  return true;
}

/**
 * Complete authorization decision for an action on a specific resource:
 * global typed permission first, then optional consumer resource policy.
 *
 * When no resource policy is registered, a granted global permission is sufficient.
 */
export async function canOnResource(
  ctx: AuthorizationContext,
  action: Permission,
  resourceType: string,
  resourceId?: string
): Promise<boolean> {
  if (!hasPermission(ctx, action)) {
    return false;
  }

  if (resourcePolicies.size === 0) {
    return true;
  }

  return evaluateResourcePolicy({
    principal: ctx.principal,
    action,
    resourceType,
    resourceId,
  });
}
