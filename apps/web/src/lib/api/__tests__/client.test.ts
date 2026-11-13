/**
 * Atlas-owned API client, correlation, retry, timeout, and auth injection.
 *
 * @jest-environment jest-fixed-jsdom
 */

import { RETRY_CONFIG } from "../config";
import { CORRELATION_ID_HEADER, extractCorrelationId, generateCorrelationId } from "../correlation";
import {
  ApiError,
  getUserFacingMessage,
  isApiErrorWithCode,
  isRetryableError,
  normalizeApiError,
} from "../errors";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  apiRequest,
  setAuthTokenProvider,
} from "../client";

function mockResponse(
  body: string | null,
  init: { status?: number; statusText?: string; headers?: Record<string, string> } = {}
) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? (status === 204 ? "No Content" : "OK"),
    headers: new Headers(init.headers),
    async json() {
      if (body == null || body === "") {
        throw new SyntaxError("Unexpected end of JSON input");
      }
      return JSON.parse(body);
    },
    async text() {
      return body ?? "";
    },
  };
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
) {
  return mockResponse(JSON.stringify(body), init);
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

describe("correlation IDs", () => {
  it("generates an id when crypto.randomUUID is available", () => {
    const id = generateCorrelationId();
    expect(id).toEqual(expect.any(String));
    expect(id.length).toBeGreaterThan(8);
  });

  it("extracts the response header and treats missing as undefined", () => {
    const headers = new Headers({ [CORRELATION_ID_HEADER]: "resp-id" });
    expect(extractCorrelationId(headers)).toBe("resp-id");
    expect(extractCorrelationId(new Headers())).toBeUndefined();
  });
});

describe("normalizeApiError", () => {
  it("classifies a realistic fetch TypeError as NETWORK_ERROR", () => {
    const normalized = normalizeApiError(new TypeError("Failed to fetch"), "corr-1");
    expect(normalized.shape.code).toBe("NETWORK_ERROR");
    expect(normalized.shape.correlationId).toBe("corr-1");
    expect(normalized.shape.userMessage).toMatch(/Unable to connect/i);
  });

  it("keeps generic Errors as UNKNOWN_ERROR", () => {
    const normalized = normalizeApiError(new Error("boom"));
    expect(normalized.shape.code).toBe("UNKNOWN_ERROR");
    expect(getUserFacingMessage(normalized)).not.toContain("boom");
  });

  it("returns already-normalized ApiErrors unchanged", () => {
    const error = new ApiError({ code: "X", message: "m" }, 400);
    expect(normalizeApiError(error)).toBe(error);
  });

  it("normalizes unknown non-Error values without leaking them to users", () => {
    const normalized = normalizeApiError({ raw: "secret" });
    expect(normalized.shape.code).toBe("UNKNOWN_ERROR");
    expect(normalized.shape.userMessage).not.toContain("secret");
  });

  it("detects codes and retryable HTTP statuses", () => {
    const error = new ApiError({ code: "NETWORK_ERROR", message: "n" }, 503);
    expect(isApiErrorWithCode(error, "NETWORK_ERROR")).toBe(true);
    expect(isRetryableError(error)).toBe(true);
    expect(isRetryableError(new ApiError({ code: "X", message: "m" }, 400))).toBe(false);
    expect(isRetryableError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isRetryableError(normalizeApiError(new TypeError("Failed to fetch")))).toBe(true);
  });
});

describe("apiRequest success paths", () => {
  afterEach(() => {
    setAuthTokenProvider(null);
    jest.restoreAllMocks();
  });

  it("parses JSON 2xx and prefers the response correlation id", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ ok: true }, { headers: { [CORRELATION_ID_HEADER]: "from-response" } })
      );

    const result = await apiRequest<{ ok: boolean }>("https://api.test/items", {
      correlationId: "from-request",
    });

    expect(result).toEqual({ ok: true });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get(CORRELATION_ID_HEADER)).toBe("from-request");
  });

  it("generates a correlation header when the caller omits one", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await apiGet("https://api.test/items");
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get(CORRELATION_ID_HEADER)).toEqual(expect.any(String));
  });

  it("returns undefined for 204 No Content", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(null, { status: 204 }));
    await expect(apiRequest("https://api.test/items")).resolves.toBeUndefined();
  });

  it("serializes JSON bodies and preserves custom headers", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ id: "1" }));
    await apiPost("https://api.test/items", { name: "Ada" }, { headers: { "X-Trace": "abc" } });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "Ada" }));
    const headers = new Headers(init.headers);
    expect(headers.get("X-Trace")).toBe("abc");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("exposes GET/PUT/PATCH/DELETE helpers", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ method: "GET" }))
      .mockResolvedValueOnce(jsonResponse({ method: "PUT" }))
      .mockResolvedValueOnce(jsonResponse({ method: "PATCH" }))
      .mockResolvedValueOnce(jsonResponse({ method: "DELETE" }));

    await apiGet("https://api.test/a");
    await apiPut("https://api.test/a", { n: 1 });
    await apiPatch("https://api.test/a", { n: 2 });
    await apiDelete("https://api.test/a");

    expect((global.fetch as jest.Mock).mock.calls.map((call) => call[1].method)).toEqual([
      "GET",
      "PUT",
      "PATCH",
      "DELETE",
    ]);
  });
});

describe("apiRequest error normalization", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("preserves a standard Atlas error body", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(
        {
          code: "VALIDATION_FAILED",
          message: "invalid",
          userMessage: "Fix the form",
          details: { fieldErrors: { email: ["taken"] } },
        },
        { status: 422, headers: { [CORRELATION_ID_HEADER]: "corr-err" } }
      )
    );

    await expect(apiPost("https://api.test/users", {}, { skipRetry: true })).rejects.toMatchObject({
      status: 422,
      shape: {
        code: "VALIDATION_FAILED",
        userMessage: "Fix the form",
        correlationId: "corr-err",
        details: { fieldErrors: { email: ["taken"] } },
      },
    });
  });

  it("does not leak HTML bodies into userMessage", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse("<html>stack trace</html>", {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "content-type": "text/html" },
      })
    );

    try {
      await apiGet("https://api.test/boom", { skipRetry: true });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.shape.code).toBe("HTTP_500");
      expect(apiError.shape.userMessage).not.toContain("stack trace");
      expect(apiError.shape.userMessage).not.toContain("<html>");
    }
  });

  it("treats non-Atlas JSON errors as HTTP_* without leaking the raw object to users", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ unexpected: true }, { status: 500 }));

    try {
      await apiGet("https://api.test/boom", { skipRetry: true });
      throw new Error("expected failure");
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.shape.code).toBe("HTTP_500");
      expect(apiError.shape.userMessage).not.toContain("unexpected");
      expect(apiError.shape.details).toEqual({ unexpected: true });
    }
  });

  it("returns INVALID_RESPONSE for malformed successful JSON", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        mockResponse("{not-json", { status: 200, headers: { "content-type": "application/json" } })
      );

    await expect(apiGet("https://api.test/items", { skipRetry: true })).rejects.toMatchObject({
      shape: { code: "INVALID_RESPONSE" },
    });
  });

  it("normalizes a fetch TypeError as NETWORK_ERROR after retries are exhausted", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const pending = apiGet("https://api.test/items");
    const expectation = expect(pending).rejects.toMatchObject({
      shape: { code: "NETWORK_ERROR" },
    });
    await jest.advanceTimersByTimeAsync(RETRY_CONFIG.baseDelayMs);
    await jest.advanceTimersByTimeAsync(RETRY_CONFIG.baseDelayMs * 2);
    await expectation;
    expect(global.fetch).toHaveBeenCalledTimes(RETRY_CONFIG.maxAttempts);
    jest.useRealTimers();
  });
});

describe("apiRequest retry policy", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([408, 429, 502, 503, 504])("retries HTTP %s according to policy", async (status) => {
    jest.useFakeTimers();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(mockResponse("nope", { status, statusText: "Retry" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const pending = apiGet("https://api.test/retry");
    await jest.advanceTimersByTimeAsync(RETRY_CONFIG.baseDelayMs);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 404, 422])("does not retry HTTP %s", async (status) => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ code: "X", message: "no" }, { status }));
    await expect(apiGet("https://api.test/nope")).rejects.toMatchObject({ status });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry when skipRetry is set", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse("nope", { status: 503 }));
    await expect(apiGet("https://api.test/nope", { skipRetry: true })).rejects.toMatchObject({
      status: 503,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds retry count and backoff", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue(mockResponse("nope", { status: 503 }));
    const pending = apiGet("https://api.test/nope");
    const expectation = expect(pending).rejects.toMatchObject({ status: 503 });
    await jest.advanceTimersByTimeAsync(RETRY_CONFIG.baseDelayMs);
    await jest.advanceTimersByTimeAsync(RETRY_CONFIG.maxDelayMs);
    await expectation;
    expect(global.fetch).toHaveBeenCalledTimes(RETRY_CONFIG.maxAttempts);
  });
});

describe("apiRequest cancellation and timeout", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("honors a caller AbortSignal and does not retry", async () => {
    const controller = new AbortController();
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(abortError()));
      });
    }) as typeof fetch;

    const pending = apiRequest("https://api.test/slow", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ shape: { code: "REQUEST_CANCELLED" } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("times out without retrying when Atlas timeout fires first", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(abortError()));
      });
    }) as typeof fetch;

    const pending = apiRequest("https://api.test/slow", { timeout: 25 });
    const expectation = expect(pending).rejects.toMatchObject({ shape: { code: "TIMEOUT" } });
    await jest.advanceTimersByTimeAsync(25);
    await expectation;
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("lets a caller abort win while a timeout is also configured", async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(abortError()));
      });
    }) as typeof fetch;

    const pending = apiRequest("https://api.test/slow", {
      signal: controller.signal,
      timeout: 5_000,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ shape: { code: "REQUEST_CANCELLED" } });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("apiRequest auth injection", () => {
  afterEach(() => {
    setAuthTokenProvider(null);
    jest.restoreAllMocks();
  });

  it("sets Authorization when the provider returns a token", async () => {
    setAuthTokenProvider(async () => "secret-token");
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await apiGet("https://api.test/me");
    const headers = new Headers((global.fetch as jest.Mock).mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
  });

  it("omits Authorization when the provider returns null", async () => {
    setAuthTokenProvider(async () => null);
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await apiGet("https://api.test/public");
    const headers = new Headers((global.fetch as jest.Mock).mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBeNull();
  });

  it("does not call the provider when skipAuth is set", async () => {
    const provider = jest.fn(async () => "secret-token");
    setAuthTokenProvider(provider);
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await apiGet("https://api.test/public", { skipAuth: true });
    expect(provider).not.toHaveBeenCalled();
    const headers = new Headers((global.fetch as jest.Mock).mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBeNull();
  });

  it("continues without leaking credentials when the provider throws", async () => {
    setAuthTokenProvider(async () => {
      throw new Error("vault exploded");
    });
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await apiGet("https://api.test/me");
    const headers = new Headers((global.fetch as jest.Mock).mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(JSON.stringify((global.fetch as jest.Mock).mock.calls[0][1])).not.toContain("vault");
  });
});
