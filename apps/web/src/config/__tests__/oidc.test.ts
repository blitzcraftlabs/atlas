/**
 * @jest-environment node
 */
import { getOidcConfig } from "@/config/oidc";

describe("getOidcConfig", () => {
  it("reads and normalizes AUTH_OIDC_* values", () => {
    expect(
      getOidcConfig({
        AUTH_OIDC_ISSUER: "https://id.example.com",
        AUTH_OIDC_CLIENT_ID: " client ",
        AUTH_OIDC_CLIENT_SECRET: "secret",
        AUTH_OIDC_SCOPES: "openid  email profile",
      })
    ).toEqual({
      issuer: "https://id.example.com",
      clientId: "client",
      clientSecret: "secret",
      scopes: ["openid", "email", "profile"],
    });
  });

  it("treats empty values as unset", () => {
    expect(getOidcConfig({ AUTH_OIDC_ISSUER: "", AUTH_OIDC_CLIENT_ID: "  " })).toEqual({
      issuer: undefined,
      clientId: undefined,
      clientSecret: undefined,
      scopes: undefined,
    });
  });

  it("fails closed on a malformed issuer", () => {
    expect(
      getOidcConfig({
        AUTH_OIDC_ISSUER: "not a url",
        AUTH_OIDC_CLIENT_ID: "c",
      })
    ).toEqual({});
  });
});
