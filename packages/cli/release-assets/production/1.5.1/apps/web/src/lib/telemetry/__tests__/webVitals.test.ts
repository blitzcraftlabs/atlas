import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
  _resetReportingSessionState,
  getReportingSessionState,
  initWebVitalsReporting,
  isReportingActive,
} from "../webVitals";

jest.mock("web-vitals", () => ({
  onCLS: jest.fn(),
  onFCP: jest.fn(),
  onINP: jest.fn(),
  onLCP: jest.fn(),
  onTTFB: jest.fn(),
}));

jest.mock("../transport", () => ({
  initTransport: jest.fn(),
  sendMetric: jest.fn(),
}));

const baseConfig = {
  endpoint: "/api/telemetry/web-vitals",
  environment: "development",
  appName: "@atlas/web",
  buildId: "test-build",
  debug: false,
} as const;

describe("initWebVitalsReporting session state", () => {
  beforeEach(() => {
    _resetReportingSessionState();
  });

  it("marks reporting inactive when config is disabled", () => {
    initWebVitalsReporting({
      config: {
        ...baseConfig,
        enabled: false,
        sampleRate: 1,
      },
    });

    expect(getReportingSessionState()).toEqual({
      initialized: true,
      enabled: false,
      sampled: false,
    });
    expect(isReportingActive()).toBe(false);
  });

  it("marks reporting active when enabled with sample rate 1", () => {
    initWebVitalsReporting({
      config: {
        ...baseConfig,
        enabled: true,
        sampleRate: 1,
      },
    });

    expect(getReportingSessionState()).toEqual({
      initialized: true,
      enabled: true,
      sampled: true,
    });
    expect(isReportingActive()).toBe(true);
  });

  it("marks reporting inactive when enabled with sample rate 0", () => {
    initWebVitalsReporting({
      config: {
        ...baseConfig,
        enabled: true,
        sampleRate: 0,
      },
    });

    expect(getReportingSessionState()).toEqual({
      initialized: true,
      enabled: true,
      sampled: false,
    });
    expect(isReportingActive()).toBe(false);
  });

  it("keeps diagnostic status aligned with initialization", () => {
    initWebVitalsReporting({
      config: {
        ...baseConfig,
        enabled: true,
        sampleRate: 1,
      },
    });

    const session = getReportingSessionState();
    expect(isReportingActive()).toBe(session.initialized && session.enabled && session.sampled);
  });
});
