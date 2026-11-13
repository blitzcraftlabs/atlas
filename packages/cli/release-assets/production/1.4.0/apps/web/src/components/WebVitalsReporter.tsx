"use client";

/**
 * Web Vitals Reporter Component
 *
 * Client component that initializes Web Vitals reporting.
 * Dynamically loads web-vitals only when reporting is enabled.
 */

import { useEffect } from "react";

import { getClientConfig } from "@/config/client";

/**
 * WebVitalsReporter component
 *
 * Initializes Web Vitals collection on mount.
 * Runs only once per page load.
 */
export function WebVitalsReporter() {
  useEffect(() => {
    const clientConfig = getClientConfig();

    void import("@/lib/telemetry/webVitals").then(({ initWebVitalsReporting }) => {
      initWebVitalsReporting({
        config: {
          enabled: clientConfig.webVitals.enabled,
          sampleRate: clientConfig.webVitals.sampleRate,
          endpoint: clientConfig.webVitals.endpoint,
          debug: clientConfig.webVitals.debug,
          environment: clientConfig.app.env,
          appName: "@atlas/web",
          buildId: clientConfig.app.buildId,
        },
      });
    });
  }, []);

  return null;
}
