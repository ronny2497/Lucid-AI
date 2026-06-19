/**
 * `mountQueryRoutes(app, store)` — the additive query-surface entrypoint.
 *
 * Attaches the read-only `/api/*` query routes (`/api/traces`,
 * `/api/traces/:id`, `/api/metrics`) onto an EXISTING collector Hono app. This
 * is purely additive: it registers new routes and never touches the ingestion
 * receiver (`POST /v1/traces`) or its 415/413/400 behavior. `server.ts` calls
 * it from the composition root so the receiver stays thin (Plan 01-03).
 */

import type { Hono } from "hono";
import type { TraceStore } from "@lucid/store";
import { registerTraceRoutes } from "./traces.js";
import { registerMetricsRoutes } from "./metrics.js";

/**
 * Mount the `/api/*` read routes onto `app`, backed by `store`. Returns the
 * same app instance for chaining.
 */
export function mountQueryRoutes(app: Hono, store: TraceStore): Hono {
  registerTraceRoutes(app, store);
  registerMetricsRoutes(app, store);
  return app;
}

export {
  parseTraceFilter,
  sinceToStartTime,
  toRunListRow,
  type RunListRow,
} from "./traces.js";
export { parseMetricsFilter } from "./metrics.js";
