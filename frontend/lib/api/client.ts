import { ApiError } from "./errors";
import { getActiveOrganizationId } from "./organization-store";

// Requests go to the same origin and are proxied to Django by next.config.ts rewrites,
// so the session and CSRF cookies are first-party.
const API_BASE = "/api/v1";
const CSRF_COOKIE = "nexora_csrftoken";
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  /** Send X-Organization-ID for the active organization (default true). */
  scoped?: boolean;
  signal?: AbortSignal;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

async function ensureCsrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  const res = await fetch(`${API_BASE}/auth/csrf/`, { credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, null);
  return readCookie(CSRF_COOKIE) ?? ((await res.json()) as { csrfToken: string }).csrfToken;
}

export function buildUrl(path: string, query?: Query): string {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };

  const isForm = options.body instanceof FormData;
  // For FormData the browser sets multipart Content-Type with the boundary itself.
  if (options.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (UNSAFE.has(method)) headers["X-CSRFToken"] = await ensureCsrfToken();
  if (options.scoped !== false) {
    const organizationId = getActiveOrganizationId();
    if (organizationId) headers["X-Organization-ID"] = organizationId;
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      credentials: "same-origin",
      body:
        options.body === undefined
          ? undefined
          : isForm
            ? (options.body as FormData)
            : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, null);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) throw new ApiError(res.status, data as never);
  return data as T;
}

/** Fetch a private file (documents need the organization header, so no plain links). */
export async function apiDownload(path: string, opts: { scoped?: boolean } = {}): Promise<Blob> {
  const headers: Record<string, string> = {};
  const organizationId = opts.scoped === false ? null : getActiveOrganizationId();
  if (organizationId) headers["X-Organization-ID"] = organizationId;
  let res: Response;
  try {
    res = await fetch(buildUrl(path), { headers, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, null);
  }
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw new ApiError(res.status, body);
  }
  return res.blob();
}

export const api = {
  get: <T>(path: string, query?: Query, opts?: Omit<RequestOptions, "method" | "query">) =>
    apiRequest<T>(path, { ...opts, method: "GET", query }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "PATCH", body }),
  upload: <T>(path: string, form: FormData, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "POST", body: form }),
  delete: <T = void>(path: string, opts?: Omit<RequestOptions, "method">) =>
    apiRequest<T>(path, { ...opts, method: "DELETE" }),
};
