"use client";

import { ReactQueryProvider } from "./react-query-provider";

import type React from "react";

/**
 * Scopes React Query to routes that perform client-side data fetching.
 */
export function DataProviderLayout({ children }: { children: React.ReactNode }) {
  return <ReactQueryProvider>{children}</ReactQueryProvider>;
}
