/**
 * Web Vitals Collection Module
 *
 * Collects Core Web Vitals (LCP, CLS, INP, FCP, TTFB) using the official
 * web-vitals library and sends them to the backend for RUM analytics.
 *
 * Production-safe with sampling, batching, and privacy protections.
 */

import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";

import { shouldReportVitals } from "./config";
import { initTransport, sendMetric } from "./transport";
import { getNavigationType, sanitizeRoute } from "./types";

import type { MetricName, WebVitalMetric } from "./types";
import type { Metric } from "web-vitals";

export interface WebVitalsInitConfig {
  enabled: boolean;
  sampleRate: number;
  endpoint: string;
  environment: string;
  appName: string;
  buildId?: string;
  debug: boolean;
}

interface ReportingSessionState {
  initialized: boolean;
  enabled: boolean;
  sampled: boolean;
}

let reportingSession: ReportingSessionState = {
  initialized: false,
  enabled: false,
  sampled: false,
};

/**
 * Effective reporting session state after initialization.
 *
 * @internal Test helper
 */
export function getReportingSessionState(): ReportingSessionState {
  return { ...reportingSession };
}

/**
 * Reset reporting session state.
 *
 * @internal Test helper
 */
export function _resetReportingSessionState(): void {
  reportingSession = {
    initialized: false,
    enabled: false,
    sampled: false,
  };
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem("web-vitals-sampled");
  }
}

/**
 * Web Vitals initialization options
 */
export interface WebVitalsOptions {
  /** Canonical runtime configuration from validated Atlas config */
  config: WebVitalsInitConfig;
  /** Callback for each metric (for custom handling) */
  onMetric?: (metric: WebVitalMetric) => void;
}

/**
 * Initialize Web Vitals reporting
 *
 * Call this once on app initialization (client-side only).
 * Uses the validated Atlas config passed by WebVitalsReporter — it does not
 * independently rediscover configuration from hostname fallbacks.
 */
export function initWebVitalsReporting(options: WebVitalsOptions): void {
  if (typeof window === "undefined") {
    return;
  }

  const config = options.config;
  reportingSession = {
    initialized: true,
    enabled: config.enabled,
    sampled: false,
  };

  if (!config.enabled) {
    if (config.debug) {
      console.log("[Web Vitals] Reporting disabled via config");
    }
    return;
  }

  const sampled = shouldReportVitals(config.sampleRate);
  reportingSession = {
    initialized: true,
    enabled: true,
    sampled,
  };

  if (!sampled) {
    if (config.debug) {
      console.log(`[Web Vitals] Session not sampled (rate: ${config.sampleRate})`);
    }
    return;
  }

  if (config.debug) {
    console.log("[Web Vitals] Reporting enabled", {
      environment: config.environment,
      sampleRate: config.sampleRate,
      endpoint: config.endpoint,
      appName: config.appName,
      buildId: config.buildId,
    });
  }

  initTransport({
    endpoint: config.endpoint,
    debug: config.debug,
  });

  const handleMetric = (metric: Metric) => {
    const payload: WebVitalMetric = {
      name: metric.name as MetricName,
      value: metric.value,
      rating: metric.rating,
      delta: metric.delta,
      id: metric.id,
      route: sanitizeRoute(window.location.href),
      timestamp: Date.now(),
      environment: config.environment,
      appName: config.appName,
      buildId: config.buildId,
      navigationType: getNavigationType(),
    };

    if (options.onMetric) {
      options.onMetric(payload);
    }

    sendMetric(payload);
  };

  try {
    onLCP(handleMetric);
    onCLS(handleMetric);
    onINP(handleMetric);
    onFCP(handleMetric);
    onTTFB(handleMetric);

    if (config.debug) {
      console.log("[Web Vitals] Observers registered");
    }
  } catch (error) {
    if (config.debug) {
      console.error("[Web Vitals] Failed to register observers:", error);
    }
  }
}

/**
 * Check if Web Vitals reporting is active in the current initialized session.
 */
export function isReportingActive(): boolean {
  if (typeof window === "undefined") return false;

  return reportingSession.initialized && reportingSession.enabled && reportingSession.sampled;
}
