/**
 * The API response shapes the explorer consumes from the collector `/api/*`
 * routes (Plan 01-04 stable contract). These mirror the server-side types
 * (`RunListRow`, `BaseMetrics`, `HarnessTrace`) — the SPA renders them verbatim
 * and NEVER re-derives metrics client-side (RESEARCH Anti-Pattern).
 *
 * Event-type / principle / quadrant strings are not redeclared here; the UI
 * imports the canonical enums from `@lucid/hsc-schema` where it needs them.
 */

import type {
  HscEventType,
  HscPrinciple,
  QuadrantX,
  QuadrantY,
} from "@lucid/hsc-schema";

/** Free-form attribute bag carried on a stored HSC event/trace. */
export type AttrValue = string | number | boolean | null | AttrValue[];
export type Attrs = Record<string, AttrValue>;

/** A single run-list row — `GET /api/traces` returns `{ traces: RunListRow[] }`. */
export interface RunListRow {
  traceId: string;
  agentId: string;
  harnessVersion: string;
  startTime: number;
  endTime: number | null;
  statusCode: number | null;
  /** Trace duration in nanoseconds, or null when the run is still open. */
  durationNs: number | null;
  /** USD cost for the run, or null when the model is unpriced/absent. */
  cost: number | null;
  eventCount: number;
}

/**
 * A single stored HSC event. `quadrantY` is `null` when the emitter did not tag
 * it (an honest absence for `feedback.check`) — the UI MUST render this as an
 * explicit "absent" state and never fabricate a value (D-05).
 */
export interface HarnessEvent {
  eventId: string;
  traceId: string;
  parentId: string | null;
  eventType: HscEventType;
  principle: HscPrinciple | null;
  quadrantX: QuadrantX | string | null;
  quadrantY: QuadrantY | string | null;
  startTime: number;
  endTime: number | null;
  statusCode: number | null;
  attrs: Attrs;
}

/** A grouping of events within a trace (one agent turn). */
export interface Turn {
  turnId: string;
  events: HarnessEvent[];
}

/** Full trace — `GET /api/traces/:id` returns this (or 404). */
export interface HarnessTrace {
  hscVersion?: string;
  traceId: string;
  agentId: string;
  harnessVersion: string;
  startTime: number;
  endTime: number | null;
  statusCode: number | null;
  attrs: Attrs;
  turns: Turn[];
}

/** Server-derived base metrics — `GET /api/metrics` returns this. */
export interface BaseMetrics {
  traceCount: number;
  successRate: number;
  successSourceBreakdown: { declared: number; inferred: number };
  /** Mean USD cost per run, or null when any model in the window is unpriced. */
  costPerRun: number | null;
  costUnknown: boolean;
  latencyP50: number;
  latencyP95: number;
  totalTokens: number;
  toolErrorRate: number;
}

/** Filters accepted by the run-list and metrics routes. */
export interface TraceFilterQuery {
  agent?: string;
  version?: string;
  since?: string;
  status?: string;
}

export interface TracesResponse {
  traces: RunListRow[];
}
