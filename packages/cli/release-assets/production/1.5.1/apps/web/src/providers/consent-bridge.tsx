"use client";

import { ConsentProvider, useConsent } from "@atlas/consent";

import { getClientConfig } from "@/config/client";
import { analytics } from "@/lib/analytics";
import { getConsentConfig } from "@/lib/consent/config";

import { AnalyticsProvider } from "./analytics-provider";

import type React from "react";

interface ConsentBridgeProps {
  children: React.ReactNode;
  nonce?: string;
}

function AnalyticsWithConsent({ children, nonce }: ConsentBridgeProps) {
  const { analyticsGranted } = useConsent();

  return (
    <AnalyticsProvider consentGranted={analyticsGranted} nonce={nonce}>
      {children}
    </AnalyticsProvider>
  );
}

export function ConsentBridge({ children, nonce }: ConsentBridgeProps) {
  return (
    <ConsentProvider
      config={getConsentConfig()}
      onAnalyticsConsentChange={(granted) => {
        analytics.setConsent(granted);
      }}
      debug={getClientConfig().analytics.debug}
    >
      <AnalyticsWithConsent nonce={nonce}>{children}</AnalyticsWithConsent>
    </ConsentProvider>
  );
}
