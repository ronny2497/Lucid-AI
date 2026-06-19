/**
 * @lucid/diagnostic — shared HSC event accessor for detectors/scorers.
 *
 * Detectors are typed against the 02-01 `HarnessTrace`/`Turn`/`HarnessEvent`
 * contract (structured: `Turn.id`, `HarnessEvent.eventType`, `.attrs`). The golden
 * fixtures, however, are the flat OTLP JSON the RED tests pass straight into a
 * detector's `run()` (`turn_id`, `events[]` with dotted keys such as
 * `harness.event_type` / `harness.mutated_state` / `gen_ai.tool.name`). Plan 02-04
 * owns the dedicated flat→structured loader; until then these accessors read EITHER
 * shape so the same detector code is GREEN against both the structured runtime view
 * and the recorded golden fixtures.
 *
 * EVERY attribute path resolves through a `@lucid/hsc-schema` constant
 * (`HARNESS_ATTR` / `GEN_AI_ATTR`) — no dotted HSC literal is written here. That is
 * the A1/A2/A7 mitigation and the Pitfall-4 (no tool-name / no bare-path) guard.
 */

import type { HscEventType } from "@lucid/hsc-schema";
import { HARNESS_ATTR, GEN_AI_ATTR } from "@lucid/hsc-schema";
import type { HarnessTrace, Turn, HarnessEvent } from "../types.js";

/** A turn as seen on the flat golden fixture (turn_id + flat events). */
interface FlatTurn {
  turn_id?: string;
  id?: string;
  events: ReadonlyArray<Record<string, unknown>>;
}

/** Loosely-typed view that accepts both the structured and flat trace shapes. */
interface LooseTrace {
  turns?: ReadonlyArray<FlatTurn | Turn>;
}

/** Normalized, read-only view of one event regardless of source shape. */
export interface EventView {
  /** Stable id (`eventId` structured, `span_id` flat). */
  id: string;
  /** HSC event-type, typed against the Phase 0 enum. */
  type: HscEventType;
  /** True when `HARNESS_ATTR.mutatedState` is set truthy. */
  mutatedState: boolean;
  /** True when `HARNESS_ATTR.inferred` is set truthy. */
  inferred: boolean;
  /** Tool name from `GEN_AI_ATTR.toolName`, for evidence strings only. */
  toolName: string | undefined;
  /** Raw accessor for any attribute path (HSC-constant driven). */
  attr(path: string): unknown;
}

/** Normalized, read-only view of one turn. */
export interface TurnView {
  id: string;
  /** Events in stored (temporal) order — never mutated. */
  events: EventView[];
}

/**
 * Resolve an attribute path against an event that may carry attrs either as a flat
 * dotted key (fixture: `e["harness.event_type"]`) or in a structured `attrs` bag
 * (`e.attrs["harness.event_type"]`). The path argument is always a `@lucid/hsc-schema`
 * constant, never a literal at the call site.
 */
function resolveAttr(raw: Record<string, unknown>, path: string): unknown {
  if (path in raw) return raw[path];
  const attrs = raw["attrs"];
  if (attrs && typeof attrs === "object" && path in (attrs as Record<string, unknown>)) {
    return (attrs as Record<string, unknown>)[path];
  }
  return undefined;
}

function toEventView(raw: Record<string, unknown>): EventView {
  // Structured shape exposes `eventType`/`eventId`; flat shape carries the dotted
  // `HARNESS_ATTR.eventType` key and `span_id`.
  const type = (raw["eventType"] ?? resolveAttr(raw, HARNESS_ATTR.eventType)) as HscEventType;
  const id = String(raw["eventId"] ?? raw["span_id"] ?? "");
  return {
    id,
    type,
    mutatedState: resolveAttr(raw, HARNESS_ATTR.mutatedState) === true,
    inferred: resolveAttr(raw, HARNESS_ATTR.inferred) === true,
    toolName: ((): string | undefined => {
      const v = resolveAttr(raw, GEN_AI_ATTR.toolName);
      return typeof v === "string" ? v : undefined;
    })(),
    attr: (path: string) => resolveAttr(raw, path),
  };
}

/**
 * Normalize any accepted trace shape into `TurnView[]`. Events keep their stored
 * array order (the OTLP/fixture order is the temporal order; the fixtures carry no
 * `timestamp`). When a `timestamp` IS present the per-detector logic may sort by it,
 * but ordering here is a non-mutating copy — detectors never mutate the input.
 */
export function viewTurns(trace: HarnessTrace): TurnView[] {
  const loose = trace as unknown as LooseTrace;
  const turns = loose.turns ?? [];
  return turns.map((t) => {
    const turn = t as FlatTurn & Turn;
    const id = String(turn.id ?? turn.turn_id ?? "");
    const events = (turn.events ?? []).map((e) => toEventView(e as Record<string, unknown>));
    return { id, events };
  });
}
