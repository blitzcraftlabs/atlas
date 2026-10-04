import { z } from "zod";

import { ClientEnvSchema } from "../public-runtime-config";

const clientSchema = z.object(ClientEnvSchema);

describe("ClientEnvSchema consent variables", () => {
  it("accepts valid consent env vars", () => {
    const result = clientSchema.parse({
      NEXT_PUBLIC_API_URL: "/api",
      NEXT_PUBLIC_CONSENT_ENABLED: "true",
      NEXT_PUBLIC_CONSENT_MODE: "opt-in",
      NEXT_PUBLIC_CONSENT_REVISION: "2",
      NEXT_PUBLIC_PRIVACY_POLICY_URL: "/privacy",
      NEXT_PUBLIC_COOKIE_POLICY_URL: "/cookies",
      NEXT_PUBLIC_CONTACT_URL: "/contact",
    });

    expect(result.NEXT_PUBLIC_CONSENT_ENABLED).toBe(true);
    expect(result.NEXT_PUBLIC_CONSENT_MODE).toBe("opt-in");
    expect(result.NEXT_PUBLIC_CONSENT_REVISION).toBe(2);
    expect(result.NEXT_PUBLIC_PRIVACY_POLICY_URL).toBe("/privacy");
  });

  it("rejects invalid consent mode", () => {
    expect(() =>
      clientSchema.parse({
        NEXT_PUBLIC_API_URL: "/api",
        NEXT_PUBLIC_CONSENT_MODE: "invalid-mode",
      })
    ).toThrow();
  });
});
