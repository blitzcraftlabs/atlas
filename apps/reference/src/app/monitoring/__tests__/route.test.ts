/**
 * @jest-environment node
 */

/**
 * Sentry tunnel route: upstream targets must come only from configured DSNs (no SSRF),
 * and envelope bodies are size-limited.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { URL as NodeURL } from "node:url";
import { NextRequest } from "next/server";

import { log } from "@/lib/logging/logger.server";

import { POST } from "../route";

jest.mock("@/lib/logging/logger.server", () => ({
  log: { warn: jest.fn() },
}));

const CLIENT_DSN = "https://publickey@o123.ingest.us.sentry.io/456";
const UPSTREAM = "https://o123.ingest.us.sentry.io/api/456/envelope/";

function tunnelRequest(query: string, body: BodyInit = "{}\n{}", headers?: HeadersInit) {
  return new NextRequest(`http://localhost/monitoring?${query}`, {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as ConstructorParameters<typeof NextRequest>[1]);
}

// jest.setup.js replaces global URL with a minimal browser mock; these tests need the real one.
const MockedURL = global.URL;
beforeAll(() => {
  global.URL = NodeURL as unknown as typeof URL;
});
afterAll(() => {
  global.URL = MockedURL;
});

describe("POST /monitoring", () => {
  let fetchMock: jest.Mock<typeof fetch>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.mocked(log.warn).mockClear();
    process.env.NEXT_PUBLIC_SENTRY_DSN = CLIENT_DSN;
    delete process.env.SENTRY_DSN;
    fetchMock = jest.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    delete process.env.SENTRY_DSN;
  });

  it("forwards envelopes for the configured project to the DSN's ingest host", async () => {
    const response = await POST(tunnelRequest("o=123&p=456&r=us"));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(UPSTREAM);
  });

  it("forwards the body bytes unchanged", async () => {
    const bytes = new Uint8Array([0x7b, 0x7d, 0x0a, 0x1f, 0x8b, 0x00, 0xff]);
    await POST(tunnelRequest("o=123&p=456", bytes));

    const init = fetchMock.mock.calls[0]?.[1];
    expect(Array.from(init?.body as Uint8Array)).toEqual(Array.from(bytes));
  });

  it.each([
    ["region host injection", "o=123&p=456&r=attacker.example%23"],
    ["org userinfo injection", "o=x%40169.254.169.254%2Flatest%2F%3F&p=456"],
    ["region path injection", "o=123&p=456&r=x.attacker.example%2F"],
  ])("never derives the upstream host from query params (%s)", async (_label, query) => {
    await POST(tunnelRequest(query));

    for (const [url] of fetchMock.mock.calls) {
      expect(url).toBe(UPSTREAM);
    }
  });

  it("rejects projects that are not configured", async () => {
    const response = await POST(tunnelRequest("o=123&p=999"));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a mismatched org for the configured project", async () => {
    const response = await POST(tunnelRequest("o=999&p=456"));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects all requests when Sentry is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;

    const response = await POST(tunnelRequest("o=123&p=456"));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the server DSN's project", async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    process.env.SENTRY_DSN = "https://key@o123.ingest.sentry.io/789";

    const response = await POST(tunnelRequest("o=123&p=789"));

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://o123.ingest.sentry.io/api/789/envelope/");
  });

  it("returns 400 when the project parameter is missing", async () => {
    const response = await POST(tunnelRequest("o=123"));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects envelopes over the size limit without forwarding", async () => {
    const tooLarge = new Uint8Array(2 * 1024 * 1024 + 1);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Chunked: no Content-Length header to rely on.
        controller.enqueue(tooLarge.subarray(0, 1024 * 1024));
        controller.enqueue(tooLarge.subarray(1024 * 1024));
        controller.close();
      },
    });

    const response = await POST(tunnelRequest("o=123&p=456", stream));

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "sentry_tunnel_envelope_rejected", projectId: "456" }),
      expect.any(String)
    );
  });

  it("returns 502 when the upstream request fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const response = await POST(tunnelRequest("o=123&p=456"));

    expect(response.status).toBe(502);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "sentry_tunnel_upstream_failed" }),
      expect.any(String)
    );
  });
});
