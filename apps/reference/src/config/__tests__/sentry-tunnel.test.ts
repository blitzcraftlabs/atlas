/**
 * @jest-environment node
 */

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { URL as NodeURL } from "node:url";

import { parseSentryDsn } from "../sentry-tunnel";

// jest.setup.js replaces global URL with a minimal browser mock; these tests need the real one.
const MockedURL = global.URL;
beforeAll(() => {
  global.URL = NodeURL as unknown as typeof URL;
});
afterAll(() => {
  global.URL = MockedURL;
});

describe("parseSentryDsn", () => {
  it("parses a SaaS DSN with a region", () => {
    expect(parseSentryDsn("https://key@o123.ingest.us.sentry.io/456")).toEqual({
      orgId: "123",
      projectId: "456",
      upstreamUrl: "https://o123.ingest.us.sentry.io/api/456/envelope/",
    });
  });

  it("parses a self-hosted DSN with a path prefix and port", () => {
    expect(parseSentryDsn("https://key@sentry.example.com:9000/prefix/42")).toEqual({
      orgId: null,
      projectId: "42",
      upstreamUrl: "https://sentry.example.com:9000/prefix/api/42/envelope/",
    });
  });

  it.each([
    "not a url",
    "ftp://key@o1.ingest.sentry.io/2",
    "https://key@o1.ingest.sentry.io/abc",
    "",
  ])("rejects malformed DSN %p", (dsn) => {
    expect(parseSentryDsn(dsn)).toBeNull();
  });
});
