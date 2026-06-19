/**
 * A tiny typed fetch wrapper for the collector query API.
 *
 * The base URL defaults to the same-origin `/api` (how the collector serves the
 * bundled SPA, PRD §11) and can be overridden via `VITE_API_BASE` for split
 * dev hosting. The Vite dev server proxies `/api` to the local collector, so
 * the default works in both modes. This module performs read-only GETs only —
 * the explorer is read-only in Phase 1 (no mutation paths exist here).
 */

import type {
  BaseMetrics,
  HarnessTrace,
  TraceFilterQuery,
  TracesResponse,
} from "./types.js";

/** Resolve the API base URL. Same-origin `/api` unless `VITE_API_BASE` is set. */
export function apiBase(): string {
  const fromEnv =
    typeof import.meta !== "undefined"
      ? (import.meta as { env?: Record<string, string | undefined> }).env
          ?.VITE_API_BASE
      : undefined;
  return (fromEnv ?? "/api").replace(/\/$/, "");
}

/** Build a query string from a filter, omitting empty/undefined values. */
export function toQueryString(filter: TraceFilterQuery = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

/** `GET /api/traces` — the run list, filtered by agent/version/since/status. */
export async function fetchTraces(
  filter: TraceFilterQuery = {},
): Promise<TracesResponse> {
  return getJson<TracesResponse>(`/traces${toQueryString(filter)}`);
}

/** `GET /api/traces/:id` — the full trace (turns -> events). */
export async function fetchTrace(id: string): Promise<HarnessTrace> {
  return getJson<HarnessTrace>(`/traces/${encodeURIComponent(id)}`);
}

/** `GET /api/metrics` — the server-derived base metrics for the window. */
export async function fetchMetrics(
  filter: TraceFilterQuery = {},
): Promise<BaseMetrics> {
  return getJson<BaseMetrics>(`/metrics${toQueryString(filter)}`);
}
