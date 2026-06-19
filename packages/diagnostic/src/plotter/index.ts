/**
 * @lucid/diagnostic — the 2×2 plotter (RESEARCH Pattern 3; REQ-04).
 *
 * `buildPlot` projects a trace's quadrant-tagged events onto the
 * feedforward/feedback × computational/inferential 2×2 and — critically —
 * reports which columns/rows are empty. The empty-feedback-column auto-detection
 * is the second of Phase 2's three success criteria: a harness that emits zero
 * feedback-tagged events yields `emptyColumns` containing `"feedback"`, which the
 * findings engine (02-04) surfaces as "the feedback column is empty".
 *
 * ## Absence is signal (D-05)
 *
 * Events with no quadrant (`tool.call` / `error` → `quadrantFor` x:null/y:null,
 * and any event the emitter left unquadranted) are EXCLUDED from the cells — never
 * fabricated into a quadrant. An entirely-feedforward trace therefore produces a
 * visibly empty feedback column rather than a guessed one.
 *
 * ## Quadrant resolution rule (interface_context / quadrantFor)
 *
 * For each event the plotter prefers an emitter-set `harness.quadrant.x`/`.y`
 * (read via the `HARNESS_ATTR` constants — never a dotted literal) and falls back
 * to `quadrantFor(eventType)` per the OQ-02 table. `feedback.check` is special:
 * its y-axis is emitter-specified (`EMITTER_SPECIFIED_Y`), so the plotter takes y
 * strictly from the emitter-set value and NEVER auto-assigns one — a
 * `feedback.check` whose y is absent is unbinnable on the y-axis and excluded.
 *
 * Any non-enum / malformed quadrant value resolves to "no quadrant" and the event
 * is excluded (T-02-06): an adversarial producer cannot fabricate or hide a column.
 *
 * ## Input shapes
 *
 * `buildPlot` accepts the structured `HarnessTrace` (02-01), a flat
 * `HarnessEvent[]`, or the flat OTLP golden-fixture shape (`turns[].events[]` with
 * dotted keys such as `harness.event_type` / `harness.quadrant.x`). Plan 02-04 owns
 * the canonical flat→structured loader; this self-contained reader keeps the plotter
 * GREEN against both the runtime view and the recorded fixtures without coupling to
 * another plan's accessor. The function is PURE — it never mutates its input.
 */

import type { HscEventType, QuadrantX, QuadrantY } from "@lucid/hsc-schema";
import { HARNESS_ATTR, EMITTER_SPECIFIED_Y, quadrantFor } from "@lucid/hsc-schema";
import type { Plot2x2 } from "../schema.js";
import { QUADRANT_KEYS } from "../schema.js";
import type { HarnessEvent, HarnessTrace } from "../types.js";

/** The enumerated x-axis values (non-null). Sourced from the QuadrantX union. */
const COLUMNS = ["feedforward", "feedback"] as const;
/** The enumerated y-axis values (non-null). Sourced from the QuadrantY union. */
const ROWS = ["computational", "inferential"] as const;

type Column = (typeof COLUMNS)[number];
type Row = (typeof ROWS)[number];

const COLUMN_SET: ReadonlySet<string> = new Set(COLUMNS);
const ROW_SET: ReadonlySet<string> = new Set(ROWS);

/** Composite cell key from a resolved (x,y). */
function cellKey(x: Column, y: Row): (typeof QUADRANT_KEYS)[number] {
  return `${x}_${y}` as (typeof QUADRANT_KEYS)[number];
}

/**
 * Resolve an attribute against an event carried either as a flat dotted key
 * (fixture: `e["harness.quadrant.x"]`) or inside a structured `attrs` bag / typed
 * field. `path` is always a `@lucid/hsc-schema` constant — never a literal here.
 */
function resolveAttr(raw: Record<string, unknown>, path: string): unknown {
  if (path in raw) return raw[path];
  const attrs = raw["attrs"];
  if (attrs && typeof attrs === "object" && path in (attrs as Record<string, unknown>)) {
    return (attrs as Record<string, unknown>)[path];
  }
  return undefined;
}

/** A column value, or null if absent / not an enumerated x value. */
function asColumn(v: unknown): Column | null {
  return typeof v === "string" && COLUMN_SET.has(v) ? (v as Column) : null;
}

/** A row value, or null if absent / not an enumerated y value. */
function asRow(v: unknown): Row | null {
  return typeof v === "string" && ROW_SET.has(v) ? (v as Row) : null;
}

/** Read the structured `quadrant` field if the event carries one. */
function structuredQuadrant(raw: Record<string, unknown>): { x: unknown; y: unknown } {
  const q = raw["quadrant"];
  if (q && typeof q === "object") {
    const qq = q as Record<string, unknown>;
    return { x: qq["x"], y: qq["y"] };
  }
  return { x: undefined, y: undefined };
}

/**
 * Resolve the binnable {x,y} for one raw event, applying the quadrantFor fallback
 * and the EMITTER_SPECIFIED_Y rule. Returns nulls for any axis that cannot be
 * resolved to an enumerated value — the caller excludes such events.
 */
function resolveQuadrant(raw: Record<string, unknown>): { x: Column | null; y: Row | null } {
  const eventType = (raw["eventType"] ??
    resolveAttr(raw, HARNESS_ATTR.eventType)) as HscEventType | undefined;

  const structured = structuredQuadrant(raw);

  // x: emitter-set value (flat dotted key, structured quadrant.x), else quadrantFor.
  const emitterX = asColumn(resolveAttr(raw, HARNESS_ATTR.quadrantX) ?? structured.x);
  const derivedX: QuadrantX = eventType ? quadrantFor(eventType).x : null;
  const x = emitterX ?? asColumn(derivedX);

  // y: emitter-set value first.
  const emitterY = asRow(resolveAttr(raw, HARNESS_ATTR.quadrantY) ?? structured.y);
  let y: Row | null;
  if (eventType && EMITTER_SPECIFIED_Y.has(eventType)) {
    // feedback.check: y is STRICTLY emitter-specified — never auto-assigned.
    y = emitterY;
  } else {
    const derivedY: QuadrantY = eventType ? quadrantFor(eventType).y : null;
    y = emitterY ?? asRow(derivedY);
  }

  return { x, y };
}

/** Pull the event-type string for the eventTypes accumulator (best-effort). */
function eventTypeOf(raw: Record<string, unknown>): string | undefined {
  const t = raw["eventType"] ?? resolveAttr(raw, HARNESS_ATTR.eventType);
  return typeof t === "string" ? t : undefined;
}

/** Accepted input shapes for `buildPlot`. */
type PlotInput =
  | HarnessTrace
  | ReadonlyArray<HarnessEvent>
  | ReadonlyArray<Record<string, unknown>>
  | { turns?: ReadonlyArray<{ events?: ReadonlyArray<unknown> }> };

/**
 * Flatten any accepted input into a read-only list of raw event records, without
 * mutating the input (a fresh array is built; events are not copied/modified).
 */
function flattenEvents(input: PlotInput): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(input)) {
    return input as ReadonlyArray<Record<string, unknown>>;
  }
  const turns = (input as { turns?: ReadonlyArray<{ events?: ReadonlyArray<unknown> }> }).turns ?? [];
  const out: Record<string, unknown>[] = [];
  for (const turn of turns) {
    for (const e of turn.events ?? []) {
      out.push(e as Record<string, unknown>);
    }
  }
  return out;
}

/**
 * Build the 2×2 plot for a trace: bin every fully-quadranted event into one of the
 * four cells, exclude unquadranted events, and auto-detect empty columns/rows.
 *
 * @param input a structured `HarnessTrace`, a flat `HarnessEvent[]`, or the flat
 *   OTLP golden-fixture shape.
 * @returns a `Plot2x2` validating against `Plot2x2Schema` (02-01).
 */
export function buildPlot(input: PlotInput): Plot2x2 {
  type CellKey = (typeof QUADRANT_KEYS)[number];
  interface Accum {
    count: number;
    eventTypes: Set<string>;
  }

  // Initialize all four accumulators so the result is total over QUADRANT_KEYS.
  const accum = new Map<CellKey, Accum>();
  for (const key of QUADRANT_KEYS) {
    accum.set(key, { count: 0, eventTypes: new Set<string>() });
  }

  const seenColumns = new Set<Column>();
  const seenRows = new Set<Row>();

  for (const raw of flattenEvents(input)) {
    const { x, y } = resolveQuadrant(raw);
    // Absence is signal: an event missing either axis is NOT binned (never fabricated).
    if (x === null || y === null) continue;

    const cell = accum.get(cellKey(x, y))!;
    cell.count += 1;
    const type = eventTypeOf(raw);
    if (type !== undefined) cell.eventTypes.add(type);

    seenColumns.add(x);
    seenRows.add(y);
  }

  // Materialize the four cells with deduped, stable-ordered eventTypes.
  const cells = {} as Plot2x2["cells"];
  for (const key of QUADRANT_KEYS) {
    const a = accum.get(key)!;
    cells[key] = { count: a.count, eventTypes: [...a.eventTypes] };
  }

  const emptyColumns = COLUMNS.filter((c) => !seenColumns.has(c)) as Column[];
  const emptyRows = ROWS.filter((r) => !seenRows.has(r)) as Row[];

  return { cells, emptyColumns, emptyRows };
}
