import type { AtlasConsentConfig } from "@atlas/consent";

import { getClientConfig } from "@/config/client";

export function getConsentConfig(): AtlasConsentConfig {
  const config = getClientConfig();

  return {
    enabled: config.consent.enabled,
    mode: config.consent.mode,
    revision: config.consent.revision,
    appName: "Atlas",
    privacyPolicyUrl: config.consent.privacyPolicyUrl,
    cookiePolicyUrl: config.consent.cookiePolicyUrl,
    contactUrl: config.consent.contactUrl,
    categories: {
      analytics: {
        enabled: Boolean(config.analytics.posthogKey || config.analytics.gaMeasurementId),
        services: {
          googleAnalytics: Boolean(config.analytics.gaMeasurementId),
          postHog: Boolean(config.analytics.posthogKey),
        },
      },
    },
  };
}

/** @deprecated Use getConsentConfig() for fresh values in tests */
export const consentConfig = getConsentConfig();
