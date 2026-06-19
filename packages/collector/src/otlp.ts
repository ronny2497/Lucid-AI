/**
 * OTLP/JSON → HscSpan[] extraction.
 *
 * Phase 1 accepts OTLP/JSON only (RESEARCH Pitfall 1 / Assumption A5): rather
 * than depend on `@opentelemetry/otlp-transformer` server-side deserialization
 * (unverified), we parse the OTLP/JSON `ExportTraceServiceRequest` envelope
 * directly with a typed zod schema and a hand-written flattener. This walks
 * `resourceSpans[] > scopeSpans[] > spans[]` and turns each OTLP span into one
 * internal `HscSpan` (the per-event write unit @lucid/store accepts).
 *
 * Reconciliation (the carried Phase-0 open question): the collector receives the
 * HSC WIRE shape — OTLP spans whose attributes use the dotted `harness.*` /
 * `gen_ai.*` keys (snake_case). @lucid/store persists the INTERNAL camelCase
 * `HscSpan`. This module is the single, tested wire→internal mapping. It NEVER
 * fabricates a missing event to satisfy a downstream consumer (D-05): absent
 * attributes map to absent fields, not back-filled defaults.
 *
 * Attribute KEYS are always sourced from @lucid/hsc-schema (HARNESS_ATTR /
 * GEN_AI_ATTR) — no `harness.*` / `gen_ai.*` string is hardcoded here.
 */

import { HARNESS_ATTR, GEN_AI_ATTR } from "@lucid/hsc-schema";
import type {
  HscSpan,
  HarnessEvent,
  Attrs,
  AttrValue,
} from "@lucid/store";
import { z } from "zod";

/** Default turn id used when an OTLP scope carries no name. */
const DEFAULT_TURN_ID = "__default__";

/**
 * OTLP/JSON `AnyValue`. We only model the variants HSC actually emits; unknown
 * variants are read leniently and ignored by the consumers that need a value.
 */
const otlpAnyValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    stringValue: z.string().optional(),
    boolValue: z.boolean().optional(),
    // OTLP/JSON encodes int64 as a decimal STRING; number is also accepted.
    intValue: z.union([z.string(), z.number()]).optional(),
    doubleValue: z.number().optional(),
    arrayValue: z
      .object({ values: z.array(otlpAnyValueSchema).optional() })
      .optional(),
  }),
);

const otlpKeyValueSchema = z.object({
  key: z.string(),
  value: otlpAnyValueSchema.optional(),
});

const otlpSpanSchema = z.object({
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
  name: z.string().optional(),
  startTimeUnixNano: z.union([z.string(), z.number()]).optional(),
  endTimeUnixNano: z.union([z.string(), z.number()]).optional(),
  status: z.object({ code: z.number().optional() }).optional(),
  attributes: z.array(otlpKeyValueSchema).optional(),
});

const otlpScopeSpansSchema = z.object({
  scope: z.object({ name: z.string().optional() }).optional(),
  spans: z.array(otlpSpanSchema).optional(),
});

const otlpResourceSpansSchema = z.object({
  resource: z
    .object({ attributes: z.array(otlpKeyValueSchema).optional() })
    .optional(),
  scopeSpans: z.array(otlpScopeSpansSchema).optional(),
});

/** The top-level OTLP/JSON ExportTraceServiceRequest envelope. */
export const OtlpJsonSpanSchema = z.object({
  resourceSpans: z.array(otlpResourceSpansSchema).optional(),
});

export type OtlpExportTraceServiceRequest = z.infer<typeof OtlpJsonSpanSchema>;
type OtlpKeyValue = z.infer<typeof otlpKeyValueSchema>;

/** Thrown when the body is not a structurally valid OTLP/JSON envelope. */
export class OtlpEnvelopeError extends Error {
  readonly issues: unknown;
  constructor(issues: unknown) {
    super("malformed OTLP/JSON envelope");
    this.name = "OtlpEnvelopeError";
    this.issues = issues;
  }
}

/** Unwrap a single OTLP `AnyValue` into a plain JS value. */
function unwrapAnyValue(value: unknown): AttrValue | undefined {
  if (value == null || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.stringValue === "string") return v.stringValue;
  if (typeof v.boolValue === "boolean") return v.boolValue;
  if (v.intValue !== undefined) {
    const n = typeof v.intValue === "string" ? Number(v.intValue) : v.intValue;
    return typeof n === "number" && Number.isFinite(n) ? n : undefined;
  }
  if (typeof v.doubleValue === "number") return v.doubleValue;
  if (v.arrayValue && typeof v.arrayValue === "object") {
    const values = (v.arrayValue as { values?: unknown[] }).values ?? [];
    const out: AttrValue[] = [];
    for (const item of values) {
      const u = unwrapAnyValue(item);
      if (u !== undefined) out.push(u);
    }
    return out;
  }
  return undefined;
}

/** Flatten an OTLP `attributes:[{key,value}]` array into a plain attr bag. */
function attrsFromKeyValues(kvs: OtlpKeyValue[] | undefined): Attrs {
  const attrs: Attrs = {};
  if (!kvs) return attrs;
  for (const kv of kvs) {
    const unwrapped = unwrapAnyValue(kv.value);
    if (unwrapped !== undefined) attrs[kv.key] = unwrapped;
  }
  return attrs;
}

function toNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : undefined;
}

function asString(value: AttrValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Flatten an OTLP/JSON ExportTraceServiceRequest into `HscSpan[]`.
 *
 * Trace-level identity (agentId / harnessVersion / traceAttrs) is read from the
 * resource attributes; turn membership is taken from the enclosing scope name.
 * Per-event `harness.*` / `gen_ai.*` are read from the span attribute array via
 * the schema-sourced attribute keys.
 *
 * @throws OtlpEnvelopeError when the top-level shape is not OTLP/JSON.
 */
export function extractSpans(otlpJson: unknown): HscSpan[] {
  const parsed = OtlpJsonSpanSchema.safeParse(otlpJson);
  if (!parsed.success) {
    throw new OtlpEnvelopeError(parsed.error.issues);
  }

  const spans: HscSpan[] = [];

  for (const resourceSpans of parsed.data.resourceSpans ?? []) {
    const resourceAttrs = attrsFromKeyValues(resourceSpans.resource?.attributes);
    const agentId =
      asString(resourceAttrs[GEN_AI_ATTR.agentId]) ??
      asString(resourceAttrs[GEN_AI_ATTR.agentName]) ??
      "";
    const harnessVersion = asString(resourceAttrs[HARNESS_ATTR.version]) ?? "";

    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      const turnId = scopeSpans.scope?.name ?? DEFAULT_TURN_ID;

      for (const span of scopeSpans.spans ?? []) {
        const attrs = attrsFromKeyValues(span.attributes);
        const traceId = span.traceId ?? "";
        const eventId = span.spanId ?? "";
        const startTime = toNumber(span.startTimeUnixNano) ?? 0;
        const endTime = toNumber(span.endTimeUnixNano) ?? null;
        const statusCode =
          span.status?.code !== undefined ? span.status.code : null;

        const eventType = attrs[HARNESS_ATTR.eventType];
        const principle = attrs[HARNESS_ATTR.principle];
        const quadrantX = attrs[HARNESS_ATTR.quadrantX];
        const quadrantY = attrs[HARNESS_ATTR.quadrantY];

        const event: HarnessEvent = {
          eventId,
          traceId,
          parentId: span.parentSpanId ? span.parentSpanId : null,
          // Cast at the boundary (through `unknown` — `eventType` is a broad
          // AttrValue here); the validator (zod + @lucid/conformance) is the gate
          // that guarantees these are valid HSC values before any write happens.
          eventType: (asString(eventType) ?? "") as unknown as HarnessEvent["eventType"],
          principle: (asString(principle) as unknown) as HarnessEvent["principle"],
          quadrantX: asString(quadrantX),
          quadrantY: asString(quadrantY),
          startTime,
          endTime,
          statusCode,
          attrs,
        };

        spans.push({
          traceId,
          agentId,
          harnessVersion,
          traceStartTime: startTime,
          traceEndTime: endTime,
          traceStatusCode: statusCode,
          traceAttrs: resourceAttrs,
          turnId,
          event,
        });
      }
    }
  }

  return spans;
}
