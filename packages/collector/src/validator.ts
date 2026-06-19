/**
 * HSC validation for extracted spans.
 *
 * Two-layer gate, both delegating to Phase 0 sources of truth:
 *
 *   1. A zod guard asserting every span carries the two mandatory `harness.*`
 *      keys (HARNESS_ATTR.eventType + HARNESS_ATTR.principle). This produces a
 *      fast, span-indexed error before we bother assembling a trace doc.
 *   2. Structural + predicate validation via `@lucid/conformance` `validateTrace`,
 *      which checks the HSC v0 JSON Schema PLUS the §2 principle binding and the
 *      OQ-02 quadrant predicate (now enforced on the wire document).
 *
 * To run `validateTrace` (which validates the HSC WIRE `HarnessTrace` document —
 * snake_case keys, `turns[].events[]`), this module reassembles the flattened
 * `HscSpan[]` back into that wire shape. The reassembled doc only carries the
 * schema-allowed keys (the JSON Schema is `additionalProperties:false`), sourced
 * from @lucid/hsc-schema — never hardcoded.
 *
 * Honest absence (D-05): this never fabricates a missing event or attribute to
 * make validation pass; it only reads what the emitter sent.
 */

import { HARNESS_ATTR, GEN_AI_ATTR } from "@lucid/hsc-schema";
import { validateTrace } from "@lucid/conformance";
import type { HscSpan, AttrValue } from "@lucid/store";

export interface ValidationResult {
  valid: boolean;
  errors: unknown[];
}

const HSC_VERSION = "v0";

/** The `harness.*` keys the HSC v0 schema permits on an event. */
const SCHEMA_HARNESS_KEYS: readonly string[] = Object.values(HARNESS_ATTR);
/** The reused `gen_ai.*` keys the HSC v0 schema permits on an event. */
const SCHEMA_GEN_AI_KEYS: readonly string[] = Object.values(GEN_AI_ATTR);

/**
 * Per-span zod-style guard for the two mandatory harness attributes. We assert
 * directly against the schema-sourced keys rather than build a zod object whose
 * property names would have to be hardcoded.
 */
function mandatoryHarnessErrors(spans: HscSpan[]): unknown[] {
  const errors: unknown[] = [];
  spans.forEach((span, idx) => {
    const attrs = span.event.attrs ?? {};
    const eventType = attrs[HARNESS_ATTR.eventType];
    const principle = attrs[HARNESS_ATTR.principle];
    if (typeof eventType !== "string" || eventType.length === 0) {
      errors.push({
        guard: true,
        spanIndex: idx,
        spanId: span.event.eventId,
        missing: HARNESS_ATTR.eventType,
        message: `span must carry ${HARNESS_ATTR.eventType}`,
      });
    }
    if (typeof principle !== "string" || principle.length === 0) {
      errors.push({
        guard: true,
        spanIndex: idx,
        spanId: span.event.eventId,
        missing: HARNESS_ATTR.principle,
        message: `span must carry ${HARNESS_ATTR.principle}`,
      });
    }
  });
  return errors;
}

/** Copy only the schema-permitted `harness.*`/`gen_ai.*` keys from an attr bag. */
function projectSchemaAttrs(attrs: Record<string, AttrValue>): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {};
  for (const key of SCHEMA_HARNESS_KEYS) {
    if (key in attrs && attrs[key] !== undefined) out[key] = attrs[key];
  }
  for (const key of SCHEMA_GEN_AI_KEYS) {
    if (key in attrs && attrs[key] !== undefined) out[key] = attrs[key];
  }
  return out;
}

/**
 * Reassemble flattened `HscSpan[]` into the HSC WIRE `HarnessTrace` document
 * that `validateTrace` expects. Spans are grouped by traceId then turnId.
 * Only schema-allowed event keys are emitted (additionalProperties:false).
 */
function toWireTrace(spans: HscSpan[]): unknown {
  // Phase 1 ingests one trace per request; if several traceIds appear we take
  // the first as the document identity (the predicate pass is per-event anyway).
  const traceId = spans[0]?.traceId ?? "";
  const harnessVersion = spans[0]?.harnessVersion ?? "";

  const turnOrder: string[] = [];
  const turns = new Map<string, unknown[]>();

  for (const span of spans) {
    const turnId = span.turnId ?? "__default__";
    if (!turns.has(turnId)) {
      turns.set(turnId, []);
      turnOrder.push(turnId);
    }
    const e = span.event;
    const wireEvent: Record<string, unknown> = {
      span_id: e.eventId,
      ...projectSchemaAttrs(e.attrs ?? {}),
    };
    if (e.parentId !== null) wireEvent.parent_span_id = e.parentId;
    turns.get(turnId)!.push(wireEvent);
  }

  const wireTrace: Record<string, unknown> = {
    hsc_version: HSC_VERSION,
    trace_id: traceId,
    turns: turnOrder.map((turnId) => ({
      turn_id: turnId,
      events: turns.get(turnId)!,
    })),
  };
  if (harnessVersion) wireTrace.harness_version = harnessVersion;
  return wireTrace;
}

/**
 * Validate a batch of extracted spans against HSC v0.
 *
 * Returns `{ valid, errors }`. `valid` is true only when the mandatory-harness
 * guard AND `@lucid/conformance` `validateTrace` both produce no errors.
 *
 * An empty batch is invalid: a POST that yields no spans is not a conformant
 * trace and must not silently 200 with nothing written.
 */
export function validateHscSpans(spans: HscSpan[]): ValidationResult {
  if (spans.length === 0) {
    return {
      valid: false,
      errors: [{ guard: true, message: "no spans found in OTLP payload" }],
    };
  }

  const guardErrors = mandatoryHarnessErrors(spans);
  const wireTrace = toWireTrace(spans);
  const conformance = validateTrace(wireTrace);

  const errors = [...guardErrors, ...conformance.errors];
  return { valid: errors.length === 0, errors };
}
