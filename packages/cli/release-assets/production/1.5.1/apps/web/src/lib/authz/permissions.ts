/**
 * Canonical typed permission registry.
 *
 * Application code should import permissions from here — never scatter string literals.
 *
 * @module lib/authz/permissions
 */

/**
 * Domain-oriented capability identifiers for the reference users resource.
 * Extend this registry as product domains grow; keep names stable and comprehensible.
 */
export const permissions = {
  users: {
    read: "users.read",
    create: "users.create",
    update: "users.update",
    delete: "users.delete",
  },
} as const;

/** Union of all registered permission identifiers. */
export type Permission =
  (typeof permissions)[keyof typeof permissions][keyof (typeof permissions)[keyof typeof permissions]];

/** All registered permissions as a flat readonly array (useful for tests and introspection). */
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(permissions).flatMap((group) =>
  Object.values(group)
) as Permission[];

/**
 * Type guard for permission strings at runtime boundaries.
 */
export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}
