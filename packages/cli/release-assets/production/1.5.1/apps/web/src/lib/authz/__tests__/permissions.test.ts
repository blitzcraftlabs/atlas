import { can, hasClientPermission, hasPermission } from "@/lib/authz/check";
import { resolveAuthorizationContext } from "@/lib/authz/context";
import { permissions } from "@/lib/authz/permissions";
import { principalFromUser } from "@/lib/authz/principal";
import {
  registerPermissionResolver,
  resetPermissionResolvers,
  resolveAllPermissions,
} from "@/lib/authz/resolvers";

import type { OAuthUser } from "@/lib/auth/types";
import type { Permission } from "@/lib/authz/permissions";

function rolesToPermissions(roles: readonly string[]): readonly Permission[] {
  const granted = new Set<Permission>();

  for (const role of roles) {
    if (role === "user") {
      granted.add(permissions.users.read);
    }
    if (role === "admin") {
      granted.add(permissions.users.read);
      granted.add(permissions.users.create);
      granted.add(permissions.users.update);
      granted.add(permissions.users.delete);
    }
  }

  return [...granted];
}

const REFERENCE_USER: OAuthUser = {
  provider: "reference",
  providerAccountId: "reference-user",
  principalId: "reference-user",
  email: "reference.user@atlas.local",
  name: "Reference User",
  avatarUrl: null,
};

const REFERENCE_ADMIN: OAuthUser = {
  provider: "reference",
  providerAccountId: "reference-admin",
  principalId: "reference-admin",
  email: "reference.admin@atlas.local",
  name: "Reference Admin",
  avatarUrl: null,
};

function registerTestReferenceResolver(): void {
  registerPermissionResolver("reference-test", ({ principal, user }) => {
    if (user.provider !== "reference") {
      return [];
    }

    const personaRoles =
      principal.id === "reference-admin" ? (["user", "admin"] as const) : (["user"] as const);

    return rolesToPermissions([...personaRoles]);
  });
}

beforeEach(() => {
  resetPermissionResolvers();
  registerTestReferenceResolver();
});

describe("permission model", () => {
  it("uses centralized type-safe permission identifiers", () => {
    expect(permissions.users.read).toBe("users.read");
    expect(permissions.users.delete).toBe("users.delete");
  });

  it("resolves different permissions for reference-user vs reference-admin", () => {
    const userCtx = resolveAuthorizationContext(REFERENCE_USER);
    const adminCtx = resolveAuthorizationContext(REFERENCE_ADMIN);

    expect(hasPermission(userCtx, permissions.users.read)).toBe(true);
    expect(hasPermission(userCtx, permissions.users.delete)).toBe(false);
    expect(can(adminCtx, permissions.users.delete)).toBe(true);
  });

  it("derives principal id from OAuthUser", () => {
    const principal = principalFromUser(REFERENCE_USER);
    expect(principal.id).toBe("reference-user");
  });
});

describe("permission resolver registration", () => {
  it("returns empty permissions when no resolver is registered", () => {
    resetPermissionResolvers();

    const resolved = resolveAllPermissions({
      principal: principalFromUser(REFERENCE_USER),
      user: REFERENCE_USER,
    });

    expect(resolved).toEqual([]);
  });

  it("does not duplicate permissions when the same resolver is registered twice", () => {
    resetPermissionResolvers();

    const resolver = () => [permissions.users.read, permissions.users.read] as const;
    registerPermissionResolver("duplicate-test", resolver);
    registerPermissionResolver("duplicate-test", resolver);

    const resolved = resolveAllPermissions({
      principal: principalFromUser(REFERENCE_USER),
      user: REFERENCE_USER,
    });

    expect(resolved).toEqual([permissions.users.read]);
  });
});

describe("client permission helper", () => {
  it("grants when permission is present", () => {
    expect(hasClientPermission([permissions.users.read], permissions.users.read)).toBe(true);
  });

  it("denies when permission is absent or permissions are null", () => {
    expect(hasClientPermission([permissions.users.read], permissions.users.delete)).toBe(false);
    expect(hasClientPermission(null, permissions.users.read)).toBe(false);
  });
});
