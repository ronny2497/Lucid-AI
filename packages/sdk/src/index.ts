/**
 * @lucid/sdk — the TypeScript manual-instrumentation path for HSC v0.
 *
 * Public surface (consumed by the Phase 1 adapters, Plan 01-06):
 *   - `harness.event(eventType, attrs)`            — emit one completed HSC span.
 *   - `harness.start(eventType, attrs).end(extra?)`— open/close one HSC span.
 *   - `configureExporter(opts?)`                   — OTLP/HTTP exporter (/v1/traces).
 *   - `initTracing(opts?)`                         — register the global provider.
 *   - `HscAttrs`                                   — the emission input type.
 *
 * Event-type strings, attribute paths, and the quadrant predicate all live in
 * `@lucid/hsc-schema`; this SDK imports them rather than redeclaring them so a
 * Phase 0 rename never touches a call site (REQ-07).
 */

export { harness, type HscSpanHandle } from "./sdk.js";
export {
  configureExporter,
  initTracing,
  DEFAULT_ENDPOINT,
  type ExporterOptions,
  type InitTracingOptions,
} from "./exporter.js";
export type { HscAttrs } from "./types.js";
export {
  guardContentFields,
  CONTENT_FIELD_KEYS,
  type ContentFieldKey,
  type GuardContentFieldsOptions,
} from "./redaction-guard.js";
