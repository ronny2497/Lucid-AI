/**
 * Neutral typed contracts for the Lucid trace store (REQ-07).
 *
 * Event-type strings and attribute paths are NEVER inlined here — they are
 * imported from `@lucid/hsc-schema` (the Phase 0 source of truth). The
 * provisional `gen_ai.*` names live in `@lucid/hsc-map`, never here.
 */

import type { HscEventType, HscPrinciple } from "@lucid/hsc-schema";

/** A free-form attribute bag as carried on an OTLP span / HSC event. */
export type AttrValue = string | number | boolean | null | AttrValue[];
export type Attrs = Record<string, AttrValue>;

/**
 * A single stored HSC event (one row in `harness_events`). Absence of an event
 * type is represented by the ABSENCE of a row of that type — never a null/zero
 * backfilled row (D-05).
 */
export interface HarnessEvent {
  eventId: string;
  traceId: string;
  parentId: string | null;
  /** HSC event-type string — typed against the Phase 0 enum. */
  eventType: HscEventType;
  principle: HscPrinciple | null;
  quadrantX: string | null;
  quadrantY: string | null;
  startTime: number;
  endTime: number | null;
  statusCode: number | null;
  /** Reconstructed attribute bag (harness.*, gen_ai.*, custom). */
  attrs: Attrs;
}

/** A grouping of events within a trace (a single agent turn). */
export interface Turn {
  turnId: string;
  events: HarnessEvent[];
}

/** A full trace: trace-level identity plus its turns->events tree. */
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

/**
 * The per-event write unit accepted by `writeSpans`. Each span carries the
 * trace-level identity (so the store can upsert the trace row) plus exactly one
 * event. Spans are already validated upstream; the store still parameterizes
 * all SQL (T-01-04).
 */
export interface HscSpan {
  traceId: string;
  agentId: string;
  harnessVersion: string;
  traceStartTime: number;
  traceEndTime: number | null;
  traceStatusCode: number | null;
  traceAttrs: Attrs;
  turnId: string;
  event: HarnessEvent;
}

/** Filter for `queryTraces` / `getMetricsInput`. */
export interface TraceFilter {
  agentId?: string;
  version?: string;
  startTime?: number;
  endTime?: number;
  status?: number;
}

/** Filter window for metrics aggregation (same surface as TraceFilter). */
export type MetricsFilter = TraceFilter;

/**
 * Per-trace raw inputs from which the metrics layer derives success/cost/
 * latency/tokens/tool-error. The store returns INPUTS only — it does not apply
 * the pricing table or the success policy (those live in `@lucid/hsc-map`).
 */
export interface MetricsInputRow {
  traceId: string;
  agentId: string;
  statusCode: number | null;
  durationNs: number | null;
  inputTokens: number;
  outputTokens: number;
  /** The gen_ai.request.model observed on this trace, if any. */
  model: string | null;
  mutatingToolCallCount: number;
  toolErrorCount: number;
}

export interface MetricsInput {
  traces: MetricsInputRow[];
}
