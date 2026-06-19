/**
 * emit-or-omit — the no-fabrication gate (D-05, "absence is signal").
 *
 * `emitOrOmit(eventType, ctx)` is the single chokepoint through which an adapter
 * emits an HSC event. It enforces the honesty invariant in CODE, not docs:
 *
 *   1. No substantiating context (`ctx.substantiated !== true`) ⇒ emit NOTHING
 *      and return `undefined`. The adapter MUST NOT synthesize an event it cannot
 *      observe (no stub verify.result, no invented feedback.check). The absence
 *      itself is the signal a downstream consumer reads — papering over it is the
 *      exact failure D-05 forbids.
 *
 *   2. Prohibited inference (§5.2): inference is permitted ONLY for the two
 *      feedforward events `context.load` and `plan.emit`. Any other event type
 *      tagged `inferred:true` (notably verify.result, feedback.check,
 *      evolve.propose, evolve.apply) is REJECTED — emit nothing, return
 *      `undefined`. The prohibited set is DERIVED from the canonical EVENT_TYPES
 *      tuple minus the permitted pair, never hardcoded as literal strings, so a
 *      Phase-0 rename or a new event type stays single-sourced (REQ-07).
 *
 *   3. Otherwise the event is emitted through `@lucid/sdk`'s `harness.event`,
 *      which owns every `harness.*` key and the quadrant derivation. When
 *      `inferred:true` (and permitted) the `harness.inferred` attribute is set via
 *      the SDK's `attrs.extra` pass-through channel using HARNESS_ATTR.inferred —
 *      this helper never spells the dotted string itself.
 *
 * Quadrant honesty: this helper does NO quadrant logic of its own. The SDK
 * already derives x/y from `quadrantFor()` and respects the EMITTER_SPECIFIED_Y
 * carve-out (feedback.check.y is never auto-assigned). emitOrOmit simply forwards
 * the caller's attrs, so that invariant is preserved end-to-end.
 */

import { EVENT_TYPES, HARNESS_ATTR, type HscEventType } from "@lucid/hsc-schema";
import { harness, type HscAttrs } from "@lucid/sdk";

/**
 * Event types for which `harness.inferred=true` is PERMITTED (§5.2). Inference is
 * an allowed source ONLY for the two feedforward events: a harness may infer the
 * context it loaded or the plan it produced. Everything else must be observed.
 */
export const PERMITTED_INFERENCE: ReadonlySet<HscEventType> = new Set<HscEventType>([
  "context.load",
  "plan.emit",
]);

/**
 * The prohibited-inference set: every canonical HSC event type that is NOT in
 * PERMITTED_INFERENCE. Derived from EVENT_TYPES so it widens automatically when a
 * new event type is added to the schema — the §5.2 prohibition is the default,
 * permission is the explicit carve-out.
 */
export const PROHIBITED_INFERENCE: ReadonlySet<HscEventType> = new Set<HscEventType>(
  (EVENT_TYPES as readonly HscEventType[]).filter((et) => !PERMITTED_INFERENCE.has(et)),
);

/**
 * The context an adapter hook hands to emitOrOmit for a single candidate event.
 *
 * `substantiated` is the honesty switch: the hook sets it `true` ONLY when the
 * live framework genuinely provided the thing this event represents. Absent or
 * `false` ⇒ the event is omitted (no span). `inferred` marks the value as
 * model-inferred rather than observed; it is allowed only for the permitted set.
 * `attrs` is forwarded verbatim to the SDK (which owns key + quadrant logic).
 */
export interface EmitContext {
  /** True ONLY when the framework genuinely substantiates this event. */
  substantiated: boolean;
  /** True when the value is model-inferred (permitted only for §5.2 set). */
  inferred?: boolean;
  /** SDK emission attributes (principle required; quadrant/genAi/extra optional). */
  attrs: HscAttrs;
}

/**
 * The outcome of an emitOrOmit call. `emitted` is `true` only when a span was
 * actually emitted; `reason` explains an omission so a caller (or test) can
 * distinguish an honest absence from a prohibited-inference rejection.
 */
export interface EmitResult {
  /** The event type that was emitted. */
  eventType: HscEventType;
  /** Always true on a returned result (undefined is returned when omitted). */
  emitted: true;
}

/** Reason an emission was omitted (surfaced for observability, never thrown). */
export type OmitReason = "unsubstantiated" | "prohibited-inference";

/**
 * Emit one HSC event for `eventType` IFF the honesty invariants hold; otherwise
 * omit it and return `undefined`.
 *
 * @returns an {@link EmitResult} when a span was emitted, or `undefined` when the
 *          event was honestly omitted (unsubstantiated) or rejected (prohibited
 *          inference). The two omission reasons are distinguished by
 *          {@link lastOmitReason} for callers that want to log them.
 */
export function emitOrOmit(eventType: HscEventType, ctx: EmitContext): EmitResult | undefined {
  // (1) Absence is signal: no substantiating context ⇒ emit nothing (D-05).
  if (!ctx || ctx.substantiated !== true) {
    lastOmitReason = "unsubstantiated";
    return undefined;
  }

  // (2) Prohibited inference (§5.2): reject inferred=true on a prohibited type.
  if (ctx.inferred === true && PROHIBITED_INFERENCE.has(eventType)) {
    lastOmitReason = "prohibited-inference";
    return undefined;
  }

  // (3) Emit through the SDK. When inference is permitted AND requested, stamp
  // harness.inferred via the extra channel using the schema-sourced key — never
  // a hardcoded dotted string, and never any quadrant logic (SDK owns that).
  const attrs: HscAttrs =
    ctx.inferred === true
      ? { ...ctx.attrs, extra: { ...(ctx.attrs.extra ?? {}), [HARNESS_ATTR.inferred]: true } }
      : ctx.attrs;

  harness.event(eventType, attrs);
  lastOmitReason = undefined;
  return { eventType, emitted: true };
}

/**
 * The reason the most recent {@link emitOrOmit} call omitted its event, or
 * `undefined` if it emitted. Exposed for callers/tests that want to assert WHY a
 * span was not produced without re-deriving the rules.
 */
export let lastOmitReason: OmitReason | undefined;
