"use client";

import { WebVitalsReporter } from "@/components/WebVitalsReporter";
import { FeatureFlagsProvider } from "@/lib/feature-flags";

import { ConsentBridge } from "./consent-bridge";
import { ThemeProvider } from "./theme-provider";
import { ToasterProvider } from "./toaster-provider";

import type React from "react";

interface MainProviderProps {
  children: React.ReactNode;
  nonce?: string;
}

export function MainProvider({ children, nonce }: MainProviderProps) {
  return (
    <FeatureFlagsProvider>
      <ThemeProvider>
        <ToasterProvider>
          <ConsentBridge nonce={nonce}>
            <WebVitalsReporter />
            {children}
          </ConsentBridge>
        </ToasterProvider>
      </ThemeProvider>
    </FeatureFlagsProvider>
  );
}
