"use client";

import { useEffect } from "react";

import { getClientConfig } from "@/config/client";

/**
 * Global error handler for unhandled promise rejections.
 *
 * Mounted in the root layout when Sentry is enabled via config.
 * Component-level error boundaries use Sentry's ErrorBoundary from @sentry/nextjs
 * directly or via global-error.tsx for catastrophic failures.
 */
export function GlobalErrorHandler() {
  useEffect(() => {
    if (!getClientConfig().sentry.enabled) return;

    let cleanup: (() => void) | undefined;

    void import("@sentry/nextjs").then((Sentry) => {
      const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
        Sentry.captureException(event.reason, {
          tags: { errorType: "unhandledRejection" },
        });
      };

      window.addEventListener("unhandledrejection", handleUnhandledRejection);
      cleanup = () => window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    });

    return () => cleanup?.();
  }, []);

  return null;
}
