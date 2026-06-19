/**
 * @lucid/diagnostic — runtime-consumed trace shapes and detector interfaces.
 *
 * Every event-type string and attribute path referenced here resolves through a
 * `@lucid/hsc-schema` import (EVENT_TYPES, PRINCIPLES, HARNESS_ATTR, EVENT_PRINCIPLE,
 * quadrantFor). No bare HSC event-type literal (e.g. the tool-call event) or
 * attribute path (e.g. the mutated-state flag) is written as a string in this file
 * — that is the A1/A2/A7 mitigation: a Phase 0 rename propagates automatically
 * through these types.
 *
 * ## Phase 1 store reconciliation (interface_context / RESEARCH Open Question 3)
 *
 * `@lucid/store` (Phase 1) already exposes a structured trace shape via its
 * `TraceStore.getTrace(traceId): Promise<HarnessTrace | null>` and
 * `queryTraces(filter): Promise<HarnessTrace[]>` contract:
 *
 *   store.HarnessTrace = { traceId, agentId, harnessVersion, turns: store.Turn[] }
 *   store.Turn         = { turnId, events: store.HarnessEvent[] }
 *   store.HarnessEvent = { eventId, eventType, principle, quadrantX, quadrantY, attrs, ... }
 *
 * The diagnostic input type below is deliberately a STRUCTURAL SUPERSET-compatible
 * read view of that store shape, so a caller can hand a store `HarnessTrace`
 * straight to `diagnose()` with at most a thin adapter:
 *
 *   | diagnostic field                  | store field                          |
 *   | --------------------------------- | ------------------------------------ |
 *   | HarnessTrace.traceId              | HarnessTrace.traceId                 |
 *   | HarnessTrace.agentId              | HarnessTrace.agentId                 |
 *   | HarnessTrace.harnessVersion?      | HarnessTrace.harnessVersion          |
 *   | Turn.turnId                       | Turn.turnId                          |
 *   | HarnessEvent.eventId              | HarnessEvent.eventId                 |
 *   | HarnessEvent.eventType            | HarnessEvent.eventType (HscEventType)|
 *   | HarnessEvent.principle            | HarnessEvent.principle               |
 *   | HarnessEvent.quadrant {x,y}       | { quadrantX, quadrantY }             |
 *   | HarnessEvent.attrs                | HarnessEvent.attrs                   |
 *
 * The on-disk golden FIXTURES, by contrast, validate against `harnessTraceSchema`
 * (the Phase 0 JSON Schema), which uses the flat OTLP layout with dotted keys
 * (`harness.event_type`, `turn_id`, `span_id`). Plan 02-04 owns the
 * fixture(flat-JSON) -> HarnessTrace(structured) loader that `diagnose()` consumes;
 * this plan only freezes the structured runtime shape and records the mapping.
 *
 * ASSUMPTION A5 (turn boundary): a trace is modeled as `{ turns: Turn[] }` with
 * `Turn = { turnId, events }` so turn-scoped detection (RESEARCH Pitfall 2) is
 * expressible. If Phase 1 ever stores a flat event stream, the loader groups into
 * turns before calling `diagnose()`.
 */

import type {
  HscEventType,
  HscPrinciple,
  QuadrantX,
  QuadrantY,
} from "@lucid/hsc-schema";
import { EVENT_PRINCIPLE, quadrantFor } from "@lucid/hsc-schema";

// Re-export the Phase 0 source-of-truth bindings so downstream plans can pull the
// event->principle map and the quadrant predicate from `@lucid/diagnostic` without
// re-importing `@lucid/hsc-schema` and without re-deriving them (REQ-07).
export { EVENT_PRINCIPLE, quadrantFor };
export type { HscEventType, HscPrinciple, QuadrantX, QuadrantY };

/** A free-form attribute bag carried on an HSC event (mirrors store `Attrs`). */
export type AttrValue = string | number | boolean | null | AttrValue[];
export type Attrs = Record<string, AttrValue>;

/** The {x, y} quadrant tags on an event (`harness.quadrant.x` / `.y`). */
export interface Quadrant {
  x: QuadrantX;
  y: QuadrantY;
}

/**
 * A single HSC event in the structured runtime view consumed by `diagnose()`.
 *
 * `eventType` and `principle` are typed against the Phase 0 enums — never raw
 * strings. `attrs` carries the reconstructed `harness.*` / `gen_ai.*` bag; detectors
 * read it via the `HARNESS_ATTR` / `GEN_AI_ATTR` path constants, not literals.
 */
export interface HarnessEvent {
  /** Stable event identifier (store `eventId` / fixture `span_id`). */
  eventId: string;
  /** HSC event-type, typed against the Phase 0 `EVENT_TYPES` tuple. */
  eventType: HscEventType;
  /** Bound convergence principle; `null`/absent for cross-cutting `error` events. */
  principle: HscPrinciple | null;
  /** Quadrant tags ({x,y}); either axis may be null (untagged / emitter-specified). */
  quadrant: Quadrant;
  /** Reconstructed attribute bag (harness.*, gen_ai.*, custom). */
  attrs: Attrs;
  /** Event start time in unix-nanos, if present. */
  timestamp?: number;
  /** Optional cross-references to other events (e.g. an error's attributable call). */
  refs?: string[];
}

/** A grouping of events within a trace (a single agent turn) — ASSUMPTION A5. */
export interface Turn {
  id: string;
  events: HarnessEvent[];
}

/** The full structured trace `diagnose()` consumes. */
export interface HarnessTrace {
  traceId: string;
  agentId: string;
  harnessVersion?: string;
  turns: Turn[];
}

// ---------------------------------------------------------------------------
// Detector interfaces (RESEARCH Pattern 1)
// ---------------------------------------------------------------------------

/** Per-run knobs handed to a detector (e.g. enabling LLM-judge detectors). */
export interface DetectorOptions {
  /** When false, llm-judge detectors are skipped (default for offline runs). */
  llmJudgeEnabled?: boolean;
  /**
   * Confidence multiplier applied to events tagged `harness.inferred = true`
   * (ASSUMPTION A6 — the value itself is decided in Plan 02-02, default 0.5).
   */
  inferredConfidence?: number;
}

/**
 * One detector hit: a single offending event or event-group for a principle.
 * `evidence` carries DERIVED counts + tool NAMES only — never raw prompt/tool-arg
 * content (threat T-02-02).
 */
export interface DetectorHit {
  detectorId: string;
  principle: HscPrinciple;
  turnId?: string;
  /** The specific event ids that triggered this hit. */
  eventIds: string[];
  /** Human-readable derived evidence, e.g. "db.write (41), api.post (31)". */
  evidence: string;
  leverage: "high" | "med" | "low";
  /** Concrete remediation string. */
  remediation: string;
}

/**
 * The detector contract every Phase 2 detector implements. LLM-judge detectors
 * share this interface (the sync/async split is an implementation detail).
 */
export interface Detector {
  readonly id: string;
  readonly principle: HscPrinciple;
  readonly kind: "rule" | "llm-judge";
  readonly defaultEnabled: boolean;
  run(trace: HarnessTrace, options?: DetectorOptions): DetectorHit[];
}

/** Top-level configuration for a `diagnose()` run. */
export interface DiagnosticConfig {
  /** Enable llm-judge detectors (default false / offline). */
  llmJudgeEnabled?: boolean;
  /** Override `inferredConfidence` (ASSUMPTION A6). */
  inferredConfidence?: number;
  /** Restrict the run to a subset of detector ids; omit to run all enabled. */
  detectorIds?: string[];
}
