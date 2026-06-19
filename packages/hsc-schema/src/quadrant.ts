/**
 * quadrantFor() — the machine-checkable OQ-02 quadrant predicate.
 *
 * `quadrant.x` (feedforward vs. feedback) and `quadrant.y`
 * (computational vs. inferential) are deterministically assigned from the
 * `harness.event_type` at emit time, per the OQ-02 spec table. The table IS
 * the predicate — no model inference is involved.
 *
 * The single exception is `feedback.check`: its y-axis can be either
 * computational (a programmatic check) or inferential (an LLM evaluator), so
 * the emitter MUST tag it explicitly. quadrantFor() therefore returns y=null
 * for `feedback.check` and lists it in EMITTER_SPECIFIED_Y. It MUST NOT
 * auto-assign a non-null y for that event.
 */

import type { HscEventType, QuadrantX, QuadrantY } from "./event-types.js";

export interface Quadrant {
  x: QuadrantX;
  y: QuadrantY;
}

/**
 * Event types whose `quadrant.y` is emitter-specified and MUST NOT be
 * auto-derived by quadrantFor(). Currently only `feedback.check`.
 */
export const EMITTER_SPECIFIED_Y: ReadonlySet<HscEventType> = new Set<HscEventType>([
  "feedback.check",
]);

/**
 * OQ-02 spec table. For emitter-specified-y events the y value is recorded as
 * `null` here; consumers must consult EMITTER_SPECIFIED_Y to distinguish an
 * intentionally-untagged action (tool.call, error) from an event whose y is
 * awaiting an explicit emitter tag (feedback.check).
 */
const QUADRANT_TABLE: Record<HscEventType, Quadrant> = {
  "context.load": { x: "feedforward", y: "computational" },
  "plan.emit": { x: "feedforward", y: "inferential" },
  "task.slice": { x: "feedforward", y: "computational" },
  "tool.call": { x: null, y: null },
  "feedback.check": { x: "feedback", y: null }, // y emitter-specified — not auto-assigned
  "verify.result": { x: "feedback", y: "computational" },
  "doc.encode": { x: "feedforward", y: "computational" },
  "evolve.propose": { x: "feedback", y: "inferential" },
  "evolve.apply": { x: "feedback", y: "computational" },
  // Phase 5 L2 self-evolution: `evolve.train` is the inferential act of producing
  // a weight-level candidate from the feedback loop; `evolve.promote` is the
  // computational gate verdict that swaps the candidate in.
  "evolve.train": { x: "feedback", y: "inferential" },
  "evolve.promote": { x: "feedback", y: "computational" },
  error: { x: null, y: null },
};

/**
 * Returns the deterministic {x, y} quadrant for an HSC event type per the
 * OQ-02 spec table. For `feedback.check`, y is null (emitter-specified).
 */
export function quadrantFor(eventType: HscEventType): Quadrant {
  const q = QUADRANT_TABLE[eventType];
  // Return a fresh object so callers cannot mutate the shared table.
  return { x: q.x, y: q.y };
}
