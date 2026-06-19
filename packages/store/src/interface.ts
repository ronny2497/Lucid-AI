/**
 * The abstract `TraceStore` interface — the swap point mandated by PRD §10.
 *
 * Every Phase 1 consumer (collector, metrics, CLI, UI API) depends on THIS
 * interface, never on `better-sqlite3` directly. The SQLite implementation is
 * one of potentially several (DuckDB / ClickHouse are documented upgrade
 * paths); swapping the backend must not break any consumer.
 */

import type {
  HscSpan,
  HarnessTrace,
  TraceFilter,
  MetricsFilter,
  MetricsInput,
} from "./types.js";

export interface TraceStore {
  /** Write a batch of validated HSC spans (one event per span). */
  writeSpans(spans: HscSpan[]): Promise<void>;

  /** Query traces by agent, harness version, and/or time range. */
  queryTraces(filter: TraceFilter): Promise<HarnessTrace[]>;

  /** Get a single trace with all turns and events, or null if absent. */
  getTrace(traceId: string): Promise<HarnessTrace | null>;

  /** Compute the raw per-trace metric INPUTS for a filter window. */
  getMetricsInput(filter: MetricsFilter): Promise<MetricsInput>;
}
