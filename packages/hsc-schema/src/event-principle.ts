/**
 * EVENT_PRINCIPLE — the canonical event_type → principle binding (spec §2).
 *
 * This is the single source of truth for which convergence principle each HSC
 * event type carries. It is transcribed verbatim from the §2 event taxonomy
 * table in `docs/standard/hsc-v0-spec.md` and mirrors the reference adapter's
 * `_PRINCIPLE_FOR_EVENT` (adapters/hermes/hsc_adapter.py). Downstream consumers
 * MUST import this map rather than hand-coding the binding (REQ-07) — the
 * hand-coded copy is exactly what produced the BL-02 fixture drift.
 *
 * `error` is cross-cutting (spec §3.3): it carries no principle of its own and
 * is emitted as a span event, so it is intentionally absent from this map. A
 * lookup for `error` returns `undefined`; consumers checking the principle of an
 * `error` event MUST treat it specially rather than expecting a binding here.
 */

import type { HscEventType, HscPrinciple } from "./event-types.js";

/**
 * Canonical event_type → principle binding for the principle-bearing event types
 * (spec §2). `error` is omitted by design (cross-cutting, §3.3).
 *
 * The Phase 5 L2 audit events `evolve.train` and `evolve.promote` carry the same
 * `feedback` principle as their L0/L1 siblings `evolve.propose`/`evolve.apply`:
 * the whole self-evolution family is a feedback loop closing on observed harness
 * behavior. The conformance predicate enforcement reads this map, so a missing
 * entry for a registered event type breaks validation — both new types must be
 * bound here.
 */
export const EVENT_PRINCIPLE: Readonly<Partial<Record<HscEventType, HscPrinciple>>> = {
  "context.load": "context",
  "plan.emit": "plan_execute",
  "task.slice": "one_at_a_time",
  "tool.call": "plan_execute",
  "feedback.check": "feedback",
  "verify.result": "feedback",
  "doc.encode": "codebase_docs",
  "evolve.propose": "feedback",
  "evolve.apply": "feedback",
  "evolve.train": "feedback",
  "evolve.promote": "feedback",
} as const;
