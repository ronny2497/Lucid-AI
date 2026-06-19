/**
 * The @lucid/sdk emission core.
 *
 * `harness.event(eventType, attrs)` emits one completed OTel span representing a
 * single HSC event; `harness.start(eventType, attrs).end(extra?)` opens a span
 * and closes it on `end()`. Both attach the `harness.*` attribute layer using
 * attribute KEYS imported from `@lucid/hsc-schema` (HARNESS_ATTR) and quadrant
 * VALUES from `quadrantFor()` — no dotted attribute path or event-type string is
 * ever hardcoded here (REQ-07 / prohibitions).
 *
 * Honesty invariants (D-05): the SDK emits ONLY the event the caller requests.
 * It never synthesizes an absent verify.result / feedback.check, and it never
 * auto-assigns quadrant.y for an emitter-specified event (EMITTER_SPECIFIED_Y).
 *
 * Privacy invariant (T-01-07): the SDK sets no content-bearing field on its own.
 * Prompt / tool-argument content reaches a span only when the caller explicitly
 * passes it through `attrs.genAi` / `attrs.extra` (opt-in).
 */

import { type Attributes, type AttributeValue, type Span, trace } from "@opentelemetry/api";
import {
  EMITTER_SPECIFIED_Y,
  HARNESS_ATTR,
  type HscEventType,
  quadrantFor,
} from "@lucid/hsc-schema";
import type { HscAttrs } from "./types.js";

/** Tracer name + version for spans this SDK emits. */
const TRACER_NAME = "@lucid/sdk";
const SDK_VERSION = "0.1.0";

/** Handle returned by `harness.start`; `end()` closes the open span. */
export interface HscSpanHandle {
  /** Finish the span, optionally merging a few late attributes. */
  end(extra?: Partial<HscAttrs>): void;
}

/** Resolve the tracer lazily so the active (possibly test) provider is used. */
function tracer() {
  return trace.getTracer(TRACER_NAME, SDK_VERSION);
}

/**
 * Build the `harness.*` attribute block for one event. Keys come exclusively
 * from HARNESS_ATTR; quadrant values come from quadrantFor() with the
 * EMITTER_SPECIFIED_Y carve-out. Undefined values are omitted so we never write
 * a null-valued attribute.
 */
function buildAttributes(eventType: HscEventType, attrs: HscAttrs): Attributes {
  const out: Attributes = {};
  const set = (key: string, value: AttributeValue | null | undefined): void => {
    if (value !== undefined && value !== null) out[key] = value;
  };

  set(HARNESS_ATTR.eventType, eventType);
  set(HARNESS_ATTR.principle, attrs.principle);
  set(HARNESS_ATTR.mutatedState, attrs.mutatedState);
  set(HARNESS_ATTR.version, attrs.version);

  // Quadrant: deterministic x/y from the spec table, with caller overrides.
  const derived = quadrantFor(eventType);
  const x = attrs.quadrant?.x ?? derived.x;
  set(HARNESS_ATTR.quadrantX, x);

  if (EMITTER_SPECIFIED_Y.has(eventType)) {
    // Emitter-specified (feedback.check): only set y if the caller supplied it.
    set(HARNESS_ATTR.quadrantY, attrs.quadrant?.y ?? undefined);
  } else {
    const y = attrs.quadrant?.y ?? derived.y;
    set(HARNESS_ATTR.quadrantY, y);
  }

  // Reused gen_ai.* attributes and any extra namespaced attributes pass through
  // verbatim — this is the only path by which content-bearing fields appear.
  if (attrs.genAi) {
    for (const [k, v] of Object.entries(attrs.genAi)) set(k, v as AttributeValue | undefined);
  }
  if (attrs.extra) {
    for (const [k, v] of Object.entries(attrs.extra)) set(k, v as AttributeValue | undefined);
  }

  return out;
}

/** Apply a partial attribute set onto an already-open span (used by `end`). */
function applyExtra(span: Span, eventType: HscEventType, extra: Partial<HscAttrs>): void {
  // Re-run the builder over the partial so late mutatedState/genAi/extra land on
  // the span with schema-sourced keys. principle is required by HscAttrs but may
  // be absent in a Partial; fall back to leaving it unset rather than inventing.
  const merged: HscAttrs = {
    principle: extra.principle as HscAttrs["principle"],
    quadrant: extra.quadrant,
    mutatedState: extra.mutatedState,
    version: extra.version,
    genAi: extra.genAi,
    extra: extra.extra,
  };
  const built = buildAttributes(eventType, merged);
  // Do not re-stamp event_type (already set at start); only late fields.
  delete (built as Record<string, unknown>)[HARNESS_ATTR.eventType];
  span.setAttributes(built);
}

/**
 * The public emission API. A harness imports `harness` and calls `event` /
 * `start` to project its lifecycle onto HSC spans.
 */
export const harness = {
  /** Emit one completed span for `eventType` carrying `attrs`. */
  event(eventType: HscEventType, attrs: HscAttrs): void {
    const span = tracer().startSpan(eventType);
    span.setAttributes(buildAttributes(eventType, attrs));
    span.end();
  },

  /** Open a span for `eventType`; the returned `end()` closes it. */
  start(eventType: HscEventType, attrs: HscAttrs): HscSpanHandle {
    const span = tracer().startSpan(eventType);
    span.setAttributes(buildAttributes(eventType, attrs));
    return {
      end(extra?: Partial<HscAttrs>): void {
        if (extra) applyExtra(span, eventType, extra);
        span.end();
      },
    };
  },
} as const;
