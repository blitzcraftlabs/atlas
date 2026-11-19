jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock("@/lib/logging/logger.server", () => ({
  log: {
    warn: jest.fn(),
  },
}));

import { resolveAuthorizationContext } from "@/lib/authz/context";
import { PermissionDeniedError } from "@/lib/authz/errors";
import { permissions } from "@/lib/authz/permissions";
import { hasRegisteredResourcePolicy, registerResourcePolicy } from "@/lib/authz/policy";
import { registerPermissionResolver } from "@/lib/authz/resolvers";
import {
  ensureApplicationAuthzConfigured,
  requireResourcePermission,
  resetApplicationAuthzConfiguration,
} from "@/lib/application/authz";

jest.mock("@/lib/auth/server", () => ({
  getServerSession: jest.fn(),
}));

import { getServerSession } from "@/lib/auth/server";

import type { OAuthUser, SessionData } from "@/lib/auth/types";

const mockedGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;

const APP_USER: OAuthUser = {
  provider: "google",
  providerAccountId: "google-user-1",
  principalId: "google-user-1",
  email: "user@example.com",
  name: "App User",
  avatarUrl: null,
};

function buildAppSession(user: OAuthUser): SessionData {
  const now = 1_700_000_000;

  return {
    user,
    accessToken: "app-access-token",
    refreshToken: "app-refresh-token",
    accessTokenExpiresAt: now + 60_000,
    createdAt: now,
    expiresAt: now + 3_600_000,
  };
}

function registerApplicationUpdatePermission(): void {
  registerPermissionResolver("application", () => [permissions.users.update]);
}

describe("application authz composition", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetApplicationAuthzConfiguration();
  });

  it("does not register resource policies by default", () => {
    ensureApplicationAuthzConfigured();

    expect(hasRegisteredResourcePolicy()).toBe(false);
    expect(resolveAuthorizationContext(APP_USER).permissions).toEqual([]);
  });

  it("applies consumer resource policies when registered", async () => {
    registerResourcePolicy("consumer", ({ resourceId }) => resourceId !== "blocked-user");
    registerApplicationUpdatePermission();
    ensureApplicationAuthzConfigured();

    mockedGetServerSession.mockResolvedValue(buildAppSession(APP_USER));

    await expect(
      requireResourcePermission(permissions.users.update, {
        resourceType: "users",
        resourceId: "blocked-user",
      })
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      requireResourcePermission(permissions.users.update, {
        resourceType: "users",
        resourceId: "allowed-user",
      })
    ).resolves.toMatchObject({
      permissions: expect.arrayContaining([permissions.users.update]),
    });
  });

  it("is idempotent when called multiple times", () => {
    registerApplicationUpdatePermission();
    ensureApplicationAuthzConfigured();
    const first = resolveAuthorizationContext(APP_USER).permissions;

    ensureApplicationAuthzConfigured();
    const second = resolveAuthorizationContext(APP_USER).permissions;

    expect(first).toEqual(second);
  });
});
