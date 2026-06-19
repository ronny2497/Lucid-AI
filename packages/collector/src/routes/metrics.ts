/**
 * The base-metrics query route: `GET /api/metrics`.
 *
 * Derivation happens HERE in the query layer (RESEARCH Anti-Pattern: never in
 * the receiver): the route maps the untrusted query string into a typed
 * `MetricsFilter`, asks the store for the raw `MetricsInput`, then runs
 * `deriveBaseMetrics`. The receiver (`src/receiver.ts`) is untouched.
 *
 * Response: the `BaseMetrics` shape (successRate + source breakdown, costPerRun
 * /costUnknown, latencyP50/P95, totalTokens, toolErrorRate) — the same object
 * the `lucid metrics` CLI prints, so CLI and UI never diverge.
 */

import type { Hono } from "hono";
import type { TraceStore, MetricsFilter } from "@lucid/store";
import { deriveBaseMetrics } from "../metrics.js";
import { parseTraceFilter } from "./traces.js";

/** Parse the untrusted query string into a typed `MetricsFilter`. */
export function parseMetricsFilter(query: URLSearchParams): MetricsFilter {
  // MetricsFilter === TraceFilter; reuse the single parser.
  return parseTraceFilter(query);
}

/** Register the metrics query route onto an existing Hono app. */
export function registerMetricsRoutes(app: Hono, store: TraceStore): void {
  app.get("/api/metrics", async (c) => {
    const filter = parseMetricsFilter(new URL(c.req.url).searchParams);
    const input = await store.getMetricsInput(filter);
    return c.json(deriveBaseMetrics(input));
  });
}
