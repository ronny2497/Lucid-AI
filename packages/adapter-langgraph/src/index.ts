/**
 * @lucid/adapter-langgraph — the neutral framework adapter (public surface).
 *
 * Re-exports the LangGraph -> HSC mapping and the `withLucid` wrapper. This
 * adapter proves framework-neutrality (D-07): it shares ONLY `@lucid/sdk` and
 * `@lucid/hsc-schema` with the rest of Lucid and contains nothing
 * hermes-specific. It emits NO `feedback.check` / `verify.result` — that honest
 * absence (RESEARCH Pitfall 5 / D-05) is the first live empty-feedback-column
 * demo for Phase 2 and is documented in COVERAGE.md.
 */

export { withLucid, emitForSpan } from "./adapter.js";
export type {
  WithLucidOptions,
  ObservedSpan,
  LucidWrappedGraph,
  GraphLike,
} from "./adapter.js";
export { LangGraphToHsc, mapSpan } from "./mapping.js";
export type { LangGraphSpanLike } from "./mapping.js";
