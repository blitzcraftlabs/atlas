jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockLogWarn = jest.fn();

jest.mock("@/lib/logging/logger.server", () => ({
  log: {
    warn: (...args: unknown[]) => mockLogWarn(...args),
  },
}));

import { resolveAuthorizationContext } from "@/lib/authz/context";
import { AuthenticationRequiredError, PermissionDeniedError } from "@/lib/authz/errors";
import { permissions } from "@/lib/authz/permissions";
import {
  registerResourcePolicy,
  hasRegisteredResourcePolicy,
  resetResourcePolicy,
} from "@/lib/authz/policy";
import { registerPermissionResolver, resetPermissionResolvers } from "@/lib/authz/resolvers";
import {
  authorizationErrorResponse,
  authorizeResource,
  requirePermission,
  requireResourcePermission,
} from "@/lib/authz/server";

jest.mock("@/lib/auth/session", () => ({
  readSession: jest.fn(),
}));

jest.mock("@/lib/auth/server", () => ({
  getServerSession: jest.fn(),
}));

import { getServerSession } from "@/lib/auth/server";

import type { SessionData } from "@/lib/auth/types";

const mockedGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;

function buildTestSession(providerAccountId: "reference-user" | "reference-admin"): SessionData {
  const now = 1_700_000_000;
  const profiles = {
    "reference-user": {
      email: "reference.user@atlas.local",
      name: "Reference User",
      principalId: "reference-user",
    },
    "reference-admin": {
      email: "reference.admin@atlas.local",
      name: "Reference Admin",
      principalId: "reference-admin",
    },
  } as const;
  const profile = profiles[providerAccountId];

  return {
    user: {
      provider: "reference",
      providerAccountId,
      principalId: profile.principalId,
      email: profile.email,
      name: profile.name,
      avatarUrl: null,
    },
    accessToken: "test-token",
    refreshToken: null,
    accessTokenExpiresAt: now + 3_600,
    createdAt: now,
    expiresAt: now + 86_400,
  };
}

function registerTestAdminResolver(): void {
  registerPermissionResolver("test", ({ user }) => {
    if (user.providerAccountId === "reference-admin") {
      return [
        permissions.users.read,
        permissions.users.create,
        permissions.users.update,
        permissions.users.delete,
      ];
    }

    if (user.providerAccountId === "reference-user") {
      return [permissions.users.read];
    }

    return [];
  });
}

describe("resource authorization composition", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPermissionResolvers();
    resetResourcePolicy();
    registerTestAdminResolver();
  });

  it("requireResourcePermission throws AuthenticationRequiredError for anonymous requests", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    await expect(
      requireResourcePermission(permissions.users.update, { resourceType: "users" })
    ).rejects.toBeInstanceOf(AuthenticationRequiredError);
  });

  it("denies when global permission is missing even if resource policy allows", async () => {
    const session = buildTestSession("reference-user");
    mockedGetServerSession.mockResolvedValue(session);

    registerResourcePolicy("test", () => true);

    await expect(
      requireResourcePermission(permissions.users.delete, {
        resourceType: "users",
        resourceId: "any-user",
      })
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("allows global permission when no resource policy is registered", async () => {
    expect(hasRegisteredResourcePolicy()).toBe(false);
    const session = buildTestSession("reference-admin");
    mockedGetServerSession.mockResolvedValue(session);

    const ctx = await requireResourcePermission(permissions.users.delete, {
      resourceType: "users",
      resourceId: "any-user",
    });

    expect(ctx.permissions).toContain(permissions.users.delete);
  });

  it("allows global permission when resource policy returns true", async () => {
    const session = buildTestSession("reference-admin");
    mockedGetServerSession.mockResolvedValue(session);

    registerResourcePolicy("test", () => true);

    await expect(
      requireResourcePermission(permissions.users.update, {
        resourceType: "users",
        resourceId: "reference-user",
      })
    ).resolves.toMatchObject({
      permissions: expect.arrayContaining([permissions.users.update]),
    });
  });

  it("denies when global permission is present but resource policy rejects", async () => {
    const session = buildTestSession("reference-admin");
    mockedGetServerSession.mockResolvedValue(session);

    registerResourcePolicy("test", () => false);

    await expect(
      requireResourcePermission(permissions.users.update, {
        resourceType: "users",
        resourceId: "reference-admin",
        correlationId: "corr-policy-deny",
      })
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("audits resource-policy denials with safe metadata", async () => {
    const session = buildTestSession("reference-admin");
    mockedGetServerSession.mockResolvedValue(session);
    const ctx = resolveAuthorizationContext(session!.user);

    registerResourcePolicy("test", () => false);

    await expect(
      authorizeResource(ctx, permissions.users.update, {
        resourceType: "users",
        resourceId: "secret-resource",
        correlationId: "corr-audit",
      })
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "authorization.denied",
        principalId: "reference-admin",
        permission: permissions.users.update,
        resourceType: "users",
        resourceId: "secret-resource",
        result: "denied",
        correlationId: "corr-audit",
      }),
      "Authorization denied"
    );

    const payload = mockLogWarn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("accessToken");
    expect(payload).not.toHaveProperty("cookie");
  });

  it("returns 403 response for resource-policy denial via authorizationErrorResponse", async () => {
    const response = authorizationErrorResponse(
      new PermissionDeniedError(permissions.users.update),
      "corr-403"
    );

    expect(response?.status).toBe(403);
  });
});

describe("global permission enforcement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPermissionResolvers();
    resetResourcePolicy();
    registerTestAdminResolver();
  });

  it("throws AuthenticationRequiredError for anonymous requirePermission", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    await expect(requirePermission(permissions.users.read)).rejects.toBeInstanceOf(
      AuthenticationRequiredError
    );
  });

  it("denies reference-user protected delete permission", async () => {
    const session = buildTestSession("reference-user");
    mockedGetServerSession.mockResolvedValue(session);

    await expect(requirePermission(permissions.users.delete)).rejects.toBeInstanceOf(
      PermissionDeniedError
    );
  });

  it("allows reference-admin protected delete permission", async () => {
    const session = buildTestSession("reference-admin");
    mockedGetServerSession.mockResolvedValue(session);

    const ctx = await requirePermission(permissions.users.delete);
    expect(ctx.permissions).toContain(permissions.users.delete);
  });

  it("produces materially different contexts for user vs admin", () => {
    const userSession = buildTestSession("reference-user");
    const adminSession = buildTestSession("reference-admin");

    const userCtx = resolveAuthorizationContext(userSession!.user);
    const adminCtx = resolveAuthorizationContext(adminSession!.user);

    expect(userCtx.permissions).toEqual([permissions.users.read]);
    expect(adminCtx.permissions).toContain(permissions.users.delete);
    expect(adminCtx.permissions.length).toBeGreaterThan(userCtx.permissions.length);
  });
});
