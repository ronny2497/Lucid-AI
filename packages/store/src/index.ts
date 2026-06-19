/**
 * @lucid/store — the abstract TraceStore contract and its default
 * implementation.
 *
 * Consumers import the `TraceStore` interface, the neutral types, and the
 * `SqliteTraceStore` class from here. The underlying database driver is an
 * implementation detail of `sqlite.ts` and is intentionally NOT re-exported.
 */

export type { TraceStore } from "./interface.js";
export type {
  HscSpan,
  HarnessTrace,
  Turn,
  HarnessEvent,
  Attrs,
  AttrValue,
  TraceFilter,
  MetricsFilter,
  MetricsInput,
  MetricsInputRow,
} from "./types.js";
export { SqliteTraceStore } from "./sqlite.js";
export { SCHEMA } from "./schema.js";
