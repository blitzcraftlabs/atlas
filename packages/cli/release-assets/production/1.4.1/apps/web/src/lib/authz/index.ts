/**
 * Authorization module — public API.
 *
 * Import permissions and client helpers from here.
 * Server enforcement: import from `@/lib/authz/server` directly.
 *
 * @module lib/authz
 */

export { can, hasClientPermission, hasPermission } from "./check";
export type { AuthorizationContext } from "./context";
export { resolveAuthorizationContext, serializeAuthorizationContext } from "./context";
export { AuthenticationRequiredError, PermissionDeniedError } from "./errors";
export type { Permission } from "./permissions";
export { ALL_PERMISSIONS, isPermission, permissions } from "./permissions";
export type { ResourcePolicyContext, ResourcePolicyFn } from "./policy";
export {
  canOnResource,
  evaluateResourcePolicy,
  hasRegisteredResourcePolicy,
  registerResourcePolicy,
  resetResourcePolicy,
} from "./policy";
export type { Principal } from "./principal";
export { principalFromUser } from "./principal";
export type { PermissionResolver, PermissionResolverContext } from "./resolvers";
export {
  registerPermissionResolver,
  resetPermissionResolvers,
  resolveAllPermissions,
} from "./resolvers";

// Client presentation helpers (not a security boundary)
export { Can } from "./client/Can";
export { usePermission } from "./client/usePermission";
