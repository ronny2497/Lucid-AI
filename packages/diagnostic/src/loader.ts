/**
 * @lucid/diagnostic — the canonical flat→structured trace loader (Plan 02-04).
 *
 * `diagnose()` consumes the structured runtime `HarnessTrace` (02-01:
 * `{ traceId, agentId, harnessVersion?, turns: { id, events }[] }`). Two upstream
 * shapes feed it:
 *
 *   1. The on-disk golden FIXTURES + any Phase 0 producer: the FLAT OTLP layout
 *      (`trace_id`, `harness_id`, `turn_id`, `span_id`, dotted attribute keys such
 *      as `harness.event_type` / `harness.mutated_state` / `gen_ai.tool.name`),
 *      validated by the Phase 0 `harnessTraceSchema`.
 *   2. The Phase 1 STORE shape (`@lucid/store` `HarnessTrace`): structured, with
 *      `traceId`/`agentId`/`turns[].turnId`/`events[].eventId` and a typed `attrs`
 *      bag plus split `quadrantX`/`quadrantY`.
 *
 * Before this plan there were TWO ad-hoc readers — `src/detectors/event-access.ts`
 * (`viewTurns`) and the plotter's self-contained reader — each independently
 * tolerating both shapes at the field-access level. `loadTrace` is the SINGLE
 * canonical normalizer: it maps EITHER source into one structured `HarnessTrace`
 * up front, so the rest of the pipeline (detectors / scorer / plotter / findings)
 * operates on exactly one shape. The existing per-reader tolerance is retained as a
 * defensive fallback (a caller may still hand a detector a flat fixture directly in
 * a unit test) but `diagnose()` always normalizes first.
 *
 * Every attribute path resolves through a `@lucid/hsc-schema` constant
 * (`HARNESS_ATTR` / `GEN_AI_ATTR`) — no dotted HSC literal is written here (A1/A2/A7
 * mitigation). PURE: builds a fresh structured trace; never mutates the input.
 */

import type { HscEventType, HscPrinciple, QuadrantX, QuadrantY } from "@lucid/hsc-schema";
import { HARNESS_ATTR } from "@lucid/hsc-schema";
import type { Attrs, AttrValue, HarnessEvent, HarnessTrace, Turn } from "./types.js";

/** Loose view of any accepted raw event record (flat OTLP key or structured field). */
type RawEvent = Record<string, unknown>;
/** Loose view of any accepted raw turn record. */
interface RawTurn {
  id?: unknown;
  turnId?: unknown;
  turn_id?: unknown;
  events?: unknown;
}
/** Loose view of any accepted raw trace record. */
interface RawTrace {
  traceId?: unknown;
  trace_id?: unknown;
  agentId?: unknown;
  harness_id?: unknown;
  harnessVersion?: unknown;
  harness_version?: unknown;
  turns?: unknown;
}

/** The set of dotted attribute keys promoted to first-class structured fields. */
const STRUCTURED_KEYS: ReadonlySet<string> = new Set<string>([
  "span_id",
  "eventId",
  "eventType",
  "principle",
  "quadrant",
  "quadrantX",
  "quadrantY",
  HARNESS_ATTR.eventType,
  HARNESS_ATTR.principle,
  HARNESS_ATTR.quadrantX,
  HARNESS_ATTR.quadrantY,
]);

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asAttrValue(v: unknown): AttrValue {
  if (v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(asAttrValue);
  // Objects that are not AttrValue arrays are dropped from the bag (out of contract).
  return String(v);
}

/** Pull a value from the structured field OR the flat dotted attribute key. */
function pick(raw: RawEvent, structuredKey: string, dottedKey: string): unknown {
  if (structuredKey in raw && raw[structuredKey] !== undefined) return raw[structuredKey];
  if (dottedKey in raw) return raw[dottedKey];
  const attrs = raw["attrs"];
  if (attrs && typeof attrs === "object") {
    const bag = attrs as Record<string, unknown>;
    if (dottedKey in bag) return bag[dottedKey];
    if (structuredKey in bag) return bag[structuredKey];
  }
  return undefined;
}

function quadrantValue(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Reconstruct the `attrs` bag for a structured event: every key that is NOT a
 * promoted structured field, merged with any explicit `attrs` object the source
 * carried. Flat dotted keys (`harness.*`, `gen_ai.*`, custom) are preserved verbatim
 * so detectors that read via `HARNESS_ATTR`/`GEN_AI_ATTR` constants keep working.
 */
function buildAttrs(raw: RawEvent): Attrs {
  const out: Attrs = {};
  const existing = raw["attrs"];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    for (const [k, v] of Object.entries(existing as Record<string, unknown>)) {
      out[k] = asAttrValue(v);
    }
  }
  for (const [k, v] of Object.entries(raw)) {
    if (k === "attrs") continue;
    if (STRUCTURED_KEYS.has(k)) continue;
    out[k] = asAttrValue(v);
  }
  return out;
}

function toEvent(raw: RawEvent): HarnessEvent {
  const eventId = str(raw["eventId"] ?? raw["span_id"]);
  const eventType = (pick(raw, "eventType", HARNESS_ATTR.eventType) ?? "") as HscEventType;
  const principleRaw = pick(raw, "principle", HARNESS_ATTR.principle);
  const principle = (typeof principleRaw === "string" ? principleRaw : null) as HscPrinciple | null;

  // Quadrant: prefer a structured {x,y}; fall back to split fields / dotted keys.
  const structuredQ = raw["quadrant"];
  let x: unknown;
  let y: unknown;
  if (structuredQ && typeof structuredQ === "object") {
    const q = structuredQ as Record<string, unknown>;
    x = q["x"];
    y = q["y"];
  } else {
    x = pick(raw, "quadrantX", HARNESS_ATTR.quadrantX);
    y = pick(raw, "quadrantY", HARNESS_ATTR.quadrantY);
  }

  return {
    eventId,
    eventType,
    principle,
    quadrant: {
      x: quadrantValue(x) as QuadrantX,
      y: quadrantValue(y) as QuadrantY,
    },
    attrs: buildAttrs(raw),
  };
}

function toTurn(raw: RawTurn, index: number): Turn {
  const id = str(raw.id ?? raw.turnId ?? raw.turn_id) || `turn-${index}`;
  const events = Array.isArray(raw.events)
    ? (raw.events as RawEvent[]).map((e) => toEvent(e ?? {}))
    : [];
  return { id, events };
}

/**
 * Normalize any accepted trace shape (flat OTLP fixture/producer or Phase 1 store
 * structured trace) into the canonical structured `HarnessTrace` `diagnose()`
 * consumes. Pure — never mutates the input.
 */
export function loadTrace(input: unknown): HarnessTrace {
  const raw = (input ?? {}) as RawTrace;
  const traceId = str(raw.traceId ?? raw.trace_id);
  const agentId = str(raw.agentId ?? raw.harness_id);
  const harnessVersion = str(raw.harnessVersion ?? raw.harness_version) || undefined;
  const turns = Array.isArray(raw.turns)
    ? (raw.turns as RawTurn[]).map((t, i) => toTurn(t ?? {}, i))
    : [];
  return { traceId, agentId, harnessVersion, turns };
}
