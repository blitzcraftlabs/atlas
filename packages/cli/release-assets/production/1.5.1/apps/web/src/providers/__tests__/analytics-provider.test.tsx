import { render, waitFor } from "@testing-library/react";

import { AnalyticsProvider } from "../analytics-provider";

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

describe("AnalyticsProvider", () => {
  const originalPosthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = originalPosthogKey;
  });

  it("calls analytics.setConsent when consentGranted changes", async () => {
    const { rerender } = render(
      <AnalyticsProvider consentGranted={false}>
        <div>child</div>
      </AnalyticsProvider>
    );

    await waitFor(() => {
      expect(mockInitAnalytics).toHaveBeenCalled();
    });

    expect(mockSetConsent).toHaveBeenCalledWith(false);

    rerender(
      <AnalyticsProvider consentGranted={true}>
        <div>child</div>
      </AnalyticsProvider>
    );

    await waitFor(() => {
      expect(mockSetConsent).toHaveBeenCalledWith(true);
    });

    expect(mockInitAnalytics).toHaveBeenCalledTimes(1);
  });
});
