/**
 * Server-side reads of Django's public API, for pages rendered on the server (the public
 * listings website, its sitemap). Never import this from a client component.
 *
 * Each call is made on behalf of the visitor's request: Django sees the public host (its
 * ALLOWED_HOSTS), the original scheme (so production doesn't redirect to HTTPS) and the
 * visitor's address, so its per-visitor rate limits still apply. In production the TLS proxy
 * (deploy/Caddyfile) sets X-Forwarded-For to the real client, replacing anything the client
 * sent. `fetch` can't set Host, so this uses node:http.
 */

import http from "node:http";
import https from "node:https";

import { headers } from "next/headers";
import { cache } from "react";

import type { ListingSearch } from "@/features/listings/format";
import type { Paginated, PublicListing } from "@/types/api";

const API_ORIGIN = new URL(process.env.NEXORA_API_ORIGIN ?? "http://localhost:8000");
const TIMEOUT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ServerApiError extends Error {
  constructor(readonly status: number) {
    super(`The API answered ${status}.`);
  }
}

async function forwarded(): Promise<Record<string, string>> {
  const h = await headers();
  const out: Record<string, string> = { accept: "application/json" };
  const host = h.get("host");
  if (host) out.host = host;
  const proto = h.get("x-forwarded-proto");
  if (proto) out["x-forwarded-proto"] = proto;
  // The last entry was added by our own proxy; anything before it came from the client.
  const ip = h.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (ip) out["x-forwarded-for"] = ip;
  return out;
}

/** The site's own origin as the visitor sees it, for absolute URLs (sitemap, link previews). */
export async function siteOrigin(): Promise<URL> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  return new URL(`${proto}://${h.get("host") ?? "localhost:3000"}`);
}

async function getJson<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T | null> {
  const url = new URL(`/api/v1${path}`, API_ORIGIN);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const requestHeaders = await forwarded();
  const transport = url.protocol === "https:" ? https : http;
  const { status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = transport.request(url, { method: "GET", headers: requestHeaders, timeout: TIMEOUT_MS }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`The API didn't answer within ${TIMEOUT_MS / 1000}s.`)));
    req.on("error", reject);
    req.end();
  });
  if (status === 404) return null;
  if (status < 200 || status >= 300) throw new ServerApiError(status);
  return JSON.parse(body) as T;
}

// --- Public listings ------------------------------------------------------------------------

/** One advertised home, or null once it's let or taken down. Shared by the page and its metadata. */
export const getPublicListing = cache(async (id: string): Promise<PublicListing | null> => {
  if (!UUID.test(id)) return null;
  return getJson<PublicListing>(`/public/listings/${id}/`);
});

/** Takes the search as a query string so React's per-request cache can match repeated calls. */
const searchListings = cache(async (query: string): Promise<Paginated<PublicListing>> => {
  const params = Object.fromEntries(new URLSearchParams(query));
  const empty = { count: 0, next: null, previous: null, results: [] };
  // A page past the end is a 404 from Django: show no results rather than an error.
  return (await getJson<Paginated<PublicListing>>("/public/listings/", params)) ?? empty;
});

export function getPublicListings(search: ListingSearch): Promise<Paginated<PublicListing>> {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) if (v !== undefined && v !== "") query.set(k, String(v));
  query.sort();
  return searchListings(query.toString());
}

/** Every advertised home, for the sitemap (capped, newest first). */
export async function getAllPublicListings(maxPages = 20): Promise<PublicListing[]> {
  const all: PublicListing[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await getJson<Paginated<PublicListing>>("/public/listings/", { page, page_size: 100 });
    if (!data) break;
    all.push(...data.results);
    if (!data.next) break;
  }
  return all;
}
