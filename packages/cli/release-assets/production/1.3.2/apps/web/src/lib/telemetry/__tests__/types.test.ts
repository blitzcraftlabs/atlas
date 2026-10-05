/**
 * Web Vitals Types Tests
 */

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { getSessionId, sanitizeRoute } from "../types";

const WEB_VITALS_SESSION_STORAGE_KEY = "web-vitals-session-id";

describe("Web Vitals Types", () => {
  describe("sanitizeRoute", () => {
    it("should extract pathname from full URL", () => {
      const url = "https://example.com/path/to/page?foo=bar#hash";
      const result = sanitizeRoute(url);

      expect(result).toBe("/path/to/page");
    });

    it("should handle pathname only", () => {
      const url = "/path/to/page";
      const result = sanitizeRoute(url);

      expect(result).toBe("/path/to/page");
    });

    it("should remove query parameters", () => {
      const url = "/page?email=user@example.com&token=secret";
      const result = sanitizeRoute(url);

      expect(result).toBe("/page");
    });

    it("should remove hash fragments", () => {
      const url = "/page#section";
      const result = sanitizeRoute(url);

      expect(result).toBe("/page");
    });

    it("should handle root path", () => {
      const url = "/";
      const result = sanitizeRoute(url);

      expect(result).toBe("/");
    });

    it("should handle invalid URLs gracefully", () => {
      const url = "not-a-valid-url";
      const result = sanitizeRoute(url);

      // Relative URLs get parsed relative to window.location.origin
      // In test environment this becomes / after parsing
      expect(result).toBe("/");
    });

    it("should preserve nested paths", () => {
      const url = "/dashboard/users/123/edit?debug=true";
      const result = sanitizeRoute(url);

      expect(result).toBe("/dashboard/users/123/edit");
    });
  });

  describe("getSessionId", () => {
    let mathRandomSpy: jest.SpiedFunction<typeof Math.random>;

    beforeEach(() => {
      sessionStorage.clear();
      mathRandomSpy = jest.spyOn(Math, "random");
    });

    afterEach(() => {
      mathRandomSpy.mockRestore();
      sessionStorage.clear();
    });

    it("should generate a session ID using crypto.randomUUID when available", () => {
      const randomUuid = jest.fn(() => "550e8400-e29b-41d4-a716-446655440000");
      const originalCrypto = globalThis.crypto;

      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: { randomUUID: randomUuid },
      });

      const sessionId = getSessionId();

      expect(sessionId).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(randomUuid).toHaveBeenCalledTimes(1);
      expect(mathRandomSpy).not.toHaveBeenCalled();

      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: originalCrypto,
      });
    });

    it("should return consistent ID within same session", () => {
      const id1 = getSessionId();
      const id2 = getSessionId();

      expect(id1).toBe(id2);
      expect(sessionStorage.getItem(WEB_VITALS_SESSION_STORAGE_KEY)).toBe(id1);
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it("should reuse an existing sessionStorage value", () => {
      const existingId = "existing-session-id";
      sessionStorage.setItem(WEB_VITALS_SESSION_STORAGE_KEY, existingId);

      expect(getSessionId()).toBe(existingId);
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it("should generate an ID when sessionStorage throws", () => {
      const getItemSpy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("sessionStorage blocked");
      });

      const sessionId = getSessionId();

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);
      expect(mathRandomSpy).not.toHaveBeenCalled();

      getItemSpy.mockRestore();
    });

    it("should generate an ID when sessionStorage is unavailable", () => {
      const originalSessionStorage = global.sessionStorage;

      Object.defineProperty(global, "sessionStorage", {
        configurable: true,
        value: undefined,
      });

      const sessionId = getSessionId();

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);
      expect(mathRandomSpy).not.toHaveBeenCalled();

      Object.defineProperty(global, "sessionStorage", {
        configurable: true,
        value: originalSessionStorage,
      });
    });
  });
});
