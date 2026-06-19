/**
 * Read-only trace query routes: `GET /api/traces` and `GET /api/traces/:id`.
 *
 * These are the stable shapes the explorer UI (Plan 01-05) and the `lucid` CLI
 * consume. They are pure read paths over the `TraceStore`:
 *   - `GET /api/traces?agent=&version=&since=&status=` -> run-list rows
 *     (id, agentId, status, duration, cost, eventCount) for the filter window.
 *   - `GET /api/traces/:id` -> the full `HarnessTrace` (turns->events) or 404.
 *
 * Untrusted query params are mapped into a typed `TraceFilter` (T-01-10); the
 * store uses parameterized SQL exclusively, so no string-built SQL crosses this
 * boundary. Cost on a run-list row is single-sourced via `costOf` and is `null`
 * when the model is unpriced (never fabricated).
 */

import type { Hono } from "hono";
import type { TraceStore, TraceFilter, HarnessTrace } from "@lucid/store";
import { costOf, GenAiAttrMap } from "@lucid/hsc-map";

/** A single run-list row (the projection the explorer run list renders). */
export interface RunListRow {
  traceId: string;
  agentId: string;
  harnessVersion: string;
  startTime: number;
  endTime: number | null;
  statusCode: number | null;
  /** Trace duration in the store's native unit (ns), or null when open. */
  durationNs: number | null;
  /** USD cost for the run, or null when the model is unpriced/absent. */
  cost: number | null;
  /** Total event count across all turns. */
  eventCount: number;
}

/**
 * Parse the untrusted query string into a typed `TraceFilter`.
 * `since` is a relative window (e.g. `24h`, `30m`, `7d`) resolved against now.
 */
export function parseTraceFilter(query: URLSearchParams): TraceFilter {
  const filter: TraceFilter = {};
  const agent = query.get("agent");
  if (agent) filter.agentId = agent;
  const version = query.get("version");
  if (version) filter.version = version;
  const status = query.get("status");
  if (status !== null && status !== "" && Number.isFinite(Number(status))) {
    filter.status = Number(status);
  }
  const since = query.get("since");
  if (since) {
    const startTime = sinceToStartTime(since);
    if (startTime !== null) filter.startTime = startTime;
  }
  return filter;
}

/**
 * Resolve a relative `since` window (`<n>[smhd]`) to an absolute start time in
 * the store's native unit (nanoseconds since epoch). Returns null when the
 * window cannot be parsed (the filter then omits the time bound).
 */
export function sinceToStartTime(
  since: string,
  now: number = Date.now(),
): number | null {
  const match = /^(\d+)\s*([smhd])$/.exec(since.trim());
  if (!match) return null;
  const value = Number(match[1]);
  const unitMs: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const windowMs = value * unitMs[match[2]];
  // Store timestamps are nanoseconds (OTel span times).
  return (now - windowMs) * 1_000_000;
}

/** Project a full trace into the compact run-list row shape. */
export function toRunListRow(trace: HarnessTrace): RunListRow {
  let inputTokens = 0;
  let outputTokens = 0;
  let model: string | null = null;
  let eventCount = 0;
  for (const turn of trace.turns) {
    for (const ev of turn.events) {
      eventCount += 1;
      const inTok = ev.attrs[GenAiAttrMap.inputTokens];
      const outTok = ev.attrs[GenAiAttrMap.outputTokens];
      if (typeof inTok === "number") inputTokens += inTok;
      if (typeof outTok === "number") outputTokens += outTok;
      const m = ev.attrs[GenAiAttrMap.model];
      if (model === null && typeof m === "string") model = m;
    }
  }
  const cost = model === null ? null : costOf(inputTokens, outputTokens, model);
  const durationNs =
    trace.endTime !== null ? trace.endTime - trace.startTime : null;
  return {
    traceId: trace.traceId,
    agentId: trace.agentId,
    harnessVersion: trace.harnessVersion,
    startTime: trace.startTime,
    endTime: trace.endTime,
    statusCode: trace.statusCode,
    durationNs,
    cost,
    eventCount,
  };
}

/** Register the trace query routes onto an existing Hono app. */
export function registerTraceRoutes(app: Hono, store: TraceStore): void {
  app.get("/api/traces", async (c) => {
    const filter = parseTraceFilter(new URL(c.req.url).searchParams);
    const traces = await store.queryTraces(filter);
    return c.json({ traces: traces.map(toRunListRow) });
  });

  app.get("/api/traces/:id", async (c) => {
    const trace = await store.getTrace(c.req.param("id"));
    if (trace === null) {
      return c.json({ error: "trace not found" }, 404);
    }
    return c.json(trace);
  });
}
