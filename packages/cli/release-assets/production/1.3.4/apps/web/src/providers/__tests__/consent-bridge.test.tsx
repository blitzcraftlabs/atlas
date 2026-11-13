import { render, screen } from "@testing-library/react";

import type React from "react";

jest.mock("@/lib/consent/config", () => ({
  getConsentConfig: () => ({
    enabled: false,
    appName: "Atlas",
  }),
}));

const mockSetConsent = jest.fn();
const mockInitAnalytics = jest.fn();

jest.mock("@/lib/analytics", () => ({
  analytics: {
    setConsent: (...args: unknown[]) => mockSetConsent(...args),
  },
  initAnalytics: (...args: unknown[]) => mockInitAnalytics(...args),
}));

jest.mock("@/lib/analytics/adapters/posthog", () => ({
  createPostHogAdapter: jest.fn(() => ({ setConsent: jest.fn() })),
}));

jest.mock("@/lib/analytics/adapters/ga", () => ({
  createGAAdapter: jest.fn(() => ({ setConsent: jest.fn() })),
  GAScript: () => null,
}));

jest.mock("@atlas/consent", () => ({
  ConsentProvider: ({
    children,
    onAnalyticsConsentChange,
  }: {
    children: React.ReactNode;
    onAnalyticsConsentChange?: (granted: boolean) => void;
  }) => (
    <div data-testid="consent-provider">
      <button type="button" onClick={() => onAnalyticsConsentChange?.(true)}>
        Grant analytics
      </button>
      {children}
    </div>
  ),
  useConsent: () => ({
    isEnabled: false,
    hasResolvedConsent: true,
    analyticsGranted: false,
    marketingGranted: false,
    preferencesGranted: false,
    openPreferences: jest.fn(),
    acceptAll: jest.fn(),
    rejectAll: jest.fn(),
    resetConsent: jest.fn(),
  }),
}));

import { ConsentBridge } from "../consent-bridge";

describe("ConsentBridge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("wraps children with ConsentProvider before AnalyticsProvider", () => {
    render(
      <ConsentBridge>
        <div>child content</div>
      </ConsentBridge>
    );

    expect(screen.getByTestId("consent-provider")).toBeInTheDocument();
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("forwards analytics consent changes to analytics.setConsent", () => {
    render(
      <ConsentBridge>
        <div>child</div>
      </ConsentBridge>
    );

    screen.getByText("Grant analytics").click();
    expect(mockSetConsent).toHaveBeenCalledWith(true);
  });
});
