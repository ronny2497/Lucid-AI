/**
 * HSC v0 event-type strings and principle strings (D-04 / interface_context).
 *
 * These are the canonical enum values. Downstream consumers MUST import them
 * from this package rather than hardcoding the strings (REQ-07).
 */

/**
 * The HSC v0 event types (D-04), in canonical order.
 *
 * The original D-04 set is the eight harness lifecycle events plus the two L0/L1
 * self-evolution audit events (`evolve.propose`, `evolve.apply`) and the
 * cross-cutting `error`. Phase 5 adds the two L2 weight-level self-evolution
 * audit events `evolve.train` and `evolve.promote` — kept grouped with the other
 * `evolve.*` events and immediately before the cross-cutting `error` so the
 * lifecycle ordering reads top-to-bottom. Adding members here widens both
 * `EVENT_TYPES` and the derived `HscEventType` union automatically.
 */
export const EVENT_TYPES = [
  "context.load",
  "plan.emit",
  "task.slice",
  "tool.call",
  "feedback.check",
  "verify.result",
  "doc.encode",
  "evolve.propose",
  "evolve.apply",
  "evolve.train",
  "evolve.promote",
  "error",
] as const;

/** Union of the HSC v0 event-type string literals (derived from `EVENT_TYPES`). */
export type HscEventType = (typeof EVENT_TYPES)[number];

/** The 5 convergence principles. */
export const PRINCIPLES = [
  "context",
  "plan_execute",
  "feedback",
  "one_at_a_time",
  "codebase_docs",
] as const;

/** Union of the 5 principle string literals. */
export type HscPrinciple = (typeof PRINCIPLES)[number];

/** Quadrant x-axis values (feedforward vs. feedback; null = untagged). */
export type QuadrantX = "feedforward" | "feedback" | null;

/** Quadrant y-axis values (computational vs. inferential; null = untagged/emitter-specified). */
export type QuadrantY = "computational" | "inferential" | null;
