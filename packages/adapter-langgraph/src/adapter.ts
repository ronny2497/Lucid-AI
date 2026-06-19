/**
 * withLucid — wrap a LangGraph graph so running it emits HSC events.
 *
 * The neutral adapter does NOT hook LangGraph internals (RESEARCH "Don't
 * Hand-Roll": use LangGraph's built-in OTel integration). Instead it observes
 * the OTel spans LangGraph emits, maps each recognized span (`invoke_agent` /
 * `chat` / `execute_tool`) onto an HSC event type via `src/mapping.ts`, and
 * emits that event through `@lucid/sdk`'s `harness.event` — so every
 * `harness.*` string stays single-sourced in `@lucid/hsc-schema` (REQ-07).
 *
 * Honesty (D-05 / RESEARCH Pitfall 5): there is NO code path that emits
 * `feedback.check` or `verify.result`. LangGraph has no verification step, so
 * that absence is preserved, never synthesized. Unknown spans are skipped
 * (mapSpan -> null), not coerced. The principle for each emitted event comes
 * from the canonical `EVENT_PRINCIPLE` binding in the schema — it is never
 * hand-assigned here. Nothing in this file is specific to any other harness —
 * the adapter shares only the SDK + schema (D-07 framework-neutrality).
 *
 * Privacy (inherited from @lucid/sdk, T-01-07): no prompt / tool-argument
 * content is recorded unless the caller opts in via `genAi` on the span attrs;
 * this adapter passes only `gen_ai.tool.name` / `gen_ai.operation.name`-style
 * non-content identifiers through when present on the span.
 */

import {
  EVENT_PRINCIPLE,
  GEN_AI_ATTR,
  type HscEventType,
  type HscPrinciple,
} from "@lucid/hsc-schema";
import { harness, initTracing, type HscAttrs } from "@lucid/sdk";
import { mapSpan, type LangGraphSpanLike } from "./mapping.js";

/** Options for {@link withLucid}. */
export interface WithLucidOptions {
  /** Logical agent id stamped on emitted events (`gen_ai.agent.id`). */
  agentId: string;
  /** OTLP/HTTP collector endpoint; defaults to the SDK default (:4318). */
  endpoint?: string;
  /** Harness build version stamped on each event (`harness.version`). */
  version?: string;
}

/**
 * A LangGraph OTel span as observed by the adapter. Beyond the name (which
 * drives the mapping), an optional `attributes` bag may carry non-content
 * `gen_ai.*` identifiers the adapter forwards verbatim (e.g. tool name, model).
 */
export interface ObservedSpan extends LangGraphSpanLike {
  /** OTel attributes already on the LangGraph span (non-content forwarded). */
  attributes?: Record<string, unknown>;
}

/** The non-content `gen_ai.*` keys the adapter is willing to forward. */
const FORWARDED_GEN_AI_KEYS: readonly string[] = [
  GEN_AI_ATTR.operationName,
  GEN_AI_ATTR.toolName,
  GEN_AI_ATTR.agentName,
  GEN_AI_ATTR.requestModel,
  GEN_AI_ATTR.usageInputTokens,
  GEN_AI_ATTR.usageOutputTokens,
  GEN_AI_ATTR.responseFinishReasons,
];

/**
 * Resolve the canonical principle for an HSC event type from the schema's
 * `EVENT_PRINCIPLE` binding. The three event types this adapter emits
 * (task.slice / plan.emit / tool.call) are all principle-bearing, so a missing
 * binding is a programming/schema error rather than a runtime condition.
 */
function principleFor(eventType: HscEventType): HscPrinciple {
  const principle = EVENT_PRINCIPLE[eventType];
  if (principle === undefined) {
    throw new Error(`no principle bound for ${eventType} (schema EVENT_PRINCIPLE)`);
  }
  return principle;
}

/**
 * Build the SDK attrs for an observed span: the schema-bound principle plus any
 * non-content `gen_ai.*` identifiers carried on the span. `tool.call` /
 * `execute_tool` is the state-mutation-capable operation, but LangGraph does not
 * report durable-state mutation, so `mutatedState` is left unset (honest).
 */
function attrsFor(
  eventType: HscEventType,
  span: ObservedSpan,
  opts: WithLucidOptions,
): HscAttrs {
  const genAi: Record<string, unknown> = {};
  if (opts.agentId) genAi[GEN_AI_ATTR.agentId] = opts.agentId;
  const incoming = span.attributes ?? {};
  for (const key of FORWARDED_GEN_AI_KEYS) {
    if (key in incoming && incoming[key] !== undefined && incoming[key] !== null) {
      genAi[key] = incoming[key];
    }
  }
  const attrs: HscAttrs = { principle: principleFor(eventType) };
  if (opts.version !== undefined) attrs.version = opts.version;
  if (Object.keys(genAi).length > 0) attrs.genAi = genAi;
  return attrs;
}

/**
 * Project a single observed LangGraph span onto an HSC event (if it maps) and
 * emit it through `@lucid/sdk`. Returns the emitted event type, or `null` when
 * the span did not map (it is skipped, never coerced).
 *
 * This is the unit the wrapper drives per span and the unit tests exercise
 * without needing a live LangGraph runtime.
 */
export function emitForSpan(span: ObservedSpan, opts: WithLucidOptions): HscEventType | null {
  const eventType = mapSpan(span);
  if (eventType === null) {
    return null; // honest passthrough — unknown span, no HSC event
  }
  // By construction the mapping never yields feedback.check / verify.result, so
  // there is no synthesis path here (D-05). We simply emit the mapped event.
  harness.event(eventType, attrsFor(eventType, span, opts));
  return eventType;
}

/**
 * A graph wrapped by {@link withLucid}. `run` executes the underlying graph and
 * emits HSC events for every observed LangGraph span.
 */
export interface LucidWrappedGraph<TGraph> {
  /** The original LangGraph graph, untouched. */
  readonly graph: TGraph;
  /** Emit HSC events for a batch of observed LangGraph spans. */
  observe(spans: readonly ObservedSpan[]): HscEventType[];
}

/**
 * The minimal shape `withLucid` accepts. Any object is acceptable — the wrapper
 * is structural and does not depend on LangGraph types, so the adapter stays
 * installable and testable without `@langchain/langgraph` present.
 */
export type GraphLike = object;

/**
 * Wrap a LangGraph graph so its OTel spans are projected onto HSC events.
 *
 * `initTracing` registers the global OTLP provider pointed at `opts.endpoint`
 * (the SDK default :4318 when omitted) so LangGraph's own OTel spans AND the
 * HSC events this adapter emits flow to the same collector. The returned
 * wrapper exposes `observe(spans)` — the integration point a LangGraph OTel
 * span processor calls with the spans it sees (the example wires this to
 * LangGraph's built-in OTel integration).
 *
 * The wrapper holds the original graph unchanged (it does not rewrite or proxy
 * the agent) — this is the "no agent rewrite" property the Phase 1 exit
 * criterion requires.
 */
export function withLucid<TGraph extends GraphLike>(
  graph: TGraph,
  opts: WithLucidOptions,
): LucidWrappedGraph<TGraph> {
  initTracing(opts.endpoint !== undefined ? { endpoint: opts.endpoint } : undefined);
  return {
    graph,
    observe(spans: readonly ObservedSpan[]): HscEventType[] {
      const emitted: HscEventType[] = [];
      for (const span of spans) {
        const eventType = emitForSpan(span, opts);
        if (eventType !== null) emitted.push(eventType);
      }
      return emitted;
    },
  };
}
