import { render, screen } from "@testing-library/react";

import type React from "react";

jest.mock("../consent-bridge", () => ({
  ConsentBridge: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="consent-bridge">{children}</div>
  ),
}));

jest.mock("@/lib/feature-flags", () => ({
  FeatureFlagsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("../theme-provider", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("../toaster-provider", () => ({
  ToasterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/WebVitalsReporter", () => ({
  WebVitalsReporter: () => null,
}));

import { MainProvider } from "../index";

describe("MainProvider", () => {
  it("wires ConsentBridge around app children", () => {
    render(
      <MainProvider>
        <div>app child</div>
      </MainProvider>
    );

    expect(screen.getByTestId("consent-bridge")).toBeInTheDocument();
    expect(screen.getByText("app child")).toBeInTheDocument();
  });
});
