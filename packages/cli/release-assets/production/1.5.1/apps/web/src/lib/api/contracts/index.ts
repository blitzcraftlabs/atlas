/**
 * Typed API Client using OpenAPI-generated types
 *
 * Wrapper around the central API client that provides type-safe
 * access to API endpoints defined in the OpenAPI specification.
 */

import { apiDelete, apiGet, apiPatch, apiPost } from "../client";

import type { ApiRequestOptions } from "../client";
import type { paths } from "./schema";

/**
 * HTTP transport used by the typed OpenAPI client.
 * Accepts relative paths; the transport resolves them against a base URL.
 */
export interface ApiTransport {
  get: <T>(endpoint: string, options?: Omit<ApiRequestOptions, "method" | "body">) => Promise<T>;
  post: <T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, "method" | "body">
  ) => Promise<T>;
  patch: <T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, "method" | "body">
  ) => Promise<T>;
  delete: <T>(endpoint: string, options?: Omit<ApiRequestOptions, "method" | "body">) => Promise<T>;
}

function resolveEndpoint(baseUrl: string, endpoint: string): string {
  return endpoint.startsWith("http") ? endpoint : `${baseUrl}${endpoint}`;
}

/**
 * Create an HTTP transport that prefixes relative endpoints with the given base URL.
 * All requests still flow through the central `apiRequest` gateway.
 */
export function createApiTransport(baseUrl: string): ApiTransport {
  return {
    get: (endpoint, options) => apiGet(resolveEndpoint(baseUrl, endpoint), options),
    post: (endpoint, body, options) => apiPost(resolveEndpoint(baseUrl, endpoint), body, options),
    patch: (endpoint, body, options) => apiPatch(resolveEndpoint(baseUrl, endpoint), body, options),
    delete: (endpoint, options) => apiDelete(resolveEndpoint(baseUrl, endpoint), options),
  };
}

function createUsersApi(transport: ApiTransport) {
  return {
    /**
     * List users with pagination and search.
     */
    list: async (params?: { page?: number; pageSize?: number; search?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.page) searchParams.set("page", String(params.page));
      if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
      if (params?.search) searchParams.set("search", params.search);

      const query = searchParams.toString();
      const endpoint = query ? `/users?${query}` : "/users";

      return transport.get<
        paths["/users"]["get"]["responses"]["200"]["content"]["application/json"]
      >(endpoint);
    },

    /**
     * Create a new user.
     */
    create: async (data: paths["/users"]["post"]["requestBody"]["content"]["application/json"]) => {
      return transport.post<
        paths["/users"]["post"]["responses"]["201"]["content"]["application/json"]
      >("/users", data);
    },

    /**
     * Get a user by ID.
     */
    get: async (userId: string) => {
      return transport.get<
        paths["/users/{userId}"]["get"]["responses"]["200"]["content"]["application/json"]
      >(`/users/${userId}`);
    },

    /**
     * Update a user.
     */
    update: async (
      userId: string,
      data: paths["/users/{userId}"]["patch"]["requestBody"]["content"]["application/json"]
    ) => {
      return transport.patch<
        paths["/users/{userId}"]["patch"]["responses"]["200"]["content"]["application/json"]
      >(`/users/${userId}`, data);
    },

    /**
     * Delete a user.
     */
    delete: async (userId: string) => {
      return transport.delete<void>(`/users/${userId}`);
    },
  } as const;
}

function createSystemApi(transport: ApiTransport) {
  return {
    /**
     * Health check endpoint.
     */
    health: async () => {
      return transport.get<
        paths["/health"]["get"]["responses"]["200"]["content"]["application/json"]
      >("/health");
    },
  } as const;
}

export type TypedApiClient = ReturnType<typeof createApi>;

/**
 * Create a typed OpenAPI client bound to the given API base URL.
 *
 * @example Client components
 * ```ts
 * const api = useTypedApiClient();
 * const users = await api.users.list({ page: 1, pageSize: 20 });
 * ```
 *
 * @example Server-side
 * ```ts
 * import { createApi } from '@/lib/api/contracts';
 * import { getApiBaseUrl } from '@/lib/api/config';
 *
 * const api = createApi(await getApiBaseUrl());
 * const user = await api.users.get('user-123');
 * ```
 */
export function createApi(baseUrl: string) {
  const transport = createApiTransport(baseUrl);

  return {
    users: createUsersApi(transport),
    system: createSystemApi(transport),
  } as const;
}

// Re-export types for convenience
export type { components, paths } from "./schema";
