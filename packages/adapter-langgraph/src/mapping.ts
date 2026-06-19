/**
 * LangGraph OTel span-name -> HSC event-type mapping (the neutral adapter core).
 *
 * LangGraph JS emits OpenTelemetry spans whose names follow the OTel GenAI
 * agentic-core operations (RESEARCH Code Examples / A4): `invoke_agent` (a graph
 * / agent invocation), `chat` (an LLM call), and `execute_tool` (a tool node).
 * This file is the SINGLE place those names are named — RESEARCH A4 marks the
 * exact span strings as pending confirmation against `@langchain/langgraph`
 * source (Task 1 human-verify), so isolating them here makes a span-name change
 * a one-file edit (interface_context).
 *
 * Honest absence (D-05 / RESEARCH Pitfall 5): LangGraph has NO verification or
 * feedback-check hook, so this map deliberately produces NO `feedback.check` and
 * NO `verify.result`. An unknown span name maps to `null` — it is passed through
 * opaque, never coerced into an HSC event. That absence is the signal; it is the
 * first live empty-feedback-column demo for Phase 2. Nothing here is specific to
 * any other harness — this adapter shares only the SDK + schema (D-07
 * framework-neutrality).
 *
 * Mapping targets are typed `HscEventType` and selected from the canonical
 * `EVENT_TYPES` tuple in `@lucid/hsc-schema` — the event-type strings are not
 * hand-authored literals here (REQ-07 / prohibitions).
 */

import { EVENT_TYPES, type HscEventType } from "@lucid/hsc-schema";

/**
 * Pick an event type from the canonical `EVENT_TYPES` tuple by its literal so
 * the value is provably one of the schema's 10 (a typo becomes a compile error)
 * — i.e. the mapping targets are sourced from `@lucid/hsc-schema`, not hardcoded.
 */
function evt<T extends HscEventType>(name: T): T {
  // `EVENT_TYPES` is the single source of truth; assert membership at module
  // load so a schema rename that drops a type is caught immediately.
  if (!(EVENT_TYPES as readonly string[]).includes(name)) {
    throw new Error(`unknown HSC event type: ${name}`);
  }
  return name;
}

/**
 * The neutral LangGraph -> HSC mapping. Keys are LangGraph OTel span names;
 * values are HSC event types drawn from `EVENT_TYPES`.
 *
 *   invoke_agent -> task.slice   (an agent/graph invocation is a unit of work)
 *   chat         -> plan.emit    (an LLM call surfaces the plan/next-step)
 *   execute_tool -> tool.call    (a tool node executes a tool)
 *
 * There is intentionally NO key producing feedback.check or verify.result —
 * LangGraph exposes no such source (honest absence; see COVERAGE.md).
 */
export const LangGraphToHsc = {
  invoke_agent: evt("task.slice"),
  chat: evt("plan.emit"),
  execute_tool: evt("tool.call"),
} as const satisfies Record<string, HscEventType>;

/** A minimal view of a LangGraph OTel span — only the name drives the mapping. */
export interface LangGraphSpanLike {
  /** The OTel span name LangGraph emitted (e.g. `execute_tool`). */
  name: string;
}

/**
 * Map a LangGraph span to its HSC event type, or `null` for an unrecognized
 * span name.
 *
 * `null` is the honest-passthrough verdict: the span is NOT one of the three
 * LangGraph operations the adapter understands, so it is left opaque rather than
 * coerced into an HSC event. The adapter MUST NOT invent a `feedback.check` /
 * `verify.result` for any span — there is no LangGraph source for them.
 */
export function mapSpan(span: LangGraphSpanLike): HscEventType | null {
  const key = span.name as keyof typeof LangGraphToHsc;
  return key in LangGraphToHsc ? LangGraphToHsc[key] : null;
}
