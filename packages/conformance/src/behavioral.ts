/**
 * @lucid/conformance — Layer 3: behavioral honesty (`checkBehavioralHonesty`).
 *
 * Layer 3 is the ONLY layer that reasons about whole sequences rather than
 * isolated attributes, and it runs ONLY NEGATIVE honesty rules. It NEVER
 * positive-requires an event to be PRESENT.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ABSENCE-IS-SIGNAL (load-bearing, spec §4 / RESEARCH Pitfall 1):
 *
 *   An honest absence is NEVER a violation. A `tool.call{mutated_state:true}`
 *   with no following `verify.result`/`feedback.check` is a fully conformant
 *   trace — the missing verification IS the signal. This scanner therefore has
 *   NO rule of the form "a mutating tool.call must be followed by a verify.result".
 *   It only flags things the adapter actively did WRONG:
 *
 *     (1) prohibited-inference — `harness.inferred=true` on an event type outside
 *         the §5.1 permitted-inference set {plan.emit, context.load}. The §5.2
 *         prohibited set (verify.result, feedback.check, evolve.propose,
 *         evolve.apply) is a strict subset of "not permitted", so a whitelist on
 *         the permitted set covers §5.2 AND any other type (e.g. tool.call).
 *
 *     (2) fabricated-event — a verify.result/feedback.check the trace itself marks
 *         as unsubstantiated (an explicit, deterministic sentinel attribute the
 *         behavioral fixtures set: `harness.x.lucid.test.unsubstantiated`). This
 *         keeps the scanner a deterministic attribute scan rather than a heuristic
 *         that could false-positive an honest trace. A verify.result with NO such
 *         marker is treated as substantiated and PASSES.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * The scanner NEVER mutates its input and NEVER synthesizes an event to fill an
 * absence (it is the inverse obligation of the emit-or-omit helper).
 */

import { HARNESS_ATTR } from "@lucid/hsc-schema";

import type { ErrorEntry } from "./report.js";

/** Result of the behavioral honesty scan: a verdict plus collected violations. */
export interface BehavioralResult {
  pass: boolean;
  violations: ErrorEntry[];
}

/**
 * §5.1 permitted-inference event types. `harness.inferred=true` is honest ONLY
 * on these; on any other type it is a prohibited-inference violation (covers the
 * §5.2 explicitly-prohibited set and any other event type). Sourced from the
 * spec — the strings are HSC event-type members, kept here as the documented
 * permitted set (not a hardcode of the prohibited list, which the §5.2 text
 * defines as "everything else").
 */
export const PERMITTED_INFERENCE: ReadonlySet<string> = new Set<string>([
  "plan.emit",
  "context.load",
]);

/**
 * The event types whose substantiation Layer 3 audits for fabrication. A
 * verify.result / feedback.check that the trace explicitly marks unsubstantiated
 * was fabricated to fill an absence (spec §4 / §5.2 prohibition).
 */
export const SUBSTANTIATED_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  "verify.result",
  "feedback.check",
]);

/**
 * Test-only sentinel attribute a behavioral fixture sets to declare that no
 * underlying check substantiated the event. It lives in a reserved
 * `harness.x.lucid.test.*` namespace so it can never collide with a real HSC
 * attribute. A trace that does NOT carry it is treated as substantiated.
 */
export const UNSUBSTANTIATED_MARKER = "harness.x.lucid.test.unsubstantiated";

function violation(
  code: "prohibited-inference" | "fabricated-event",
  message: string,
  path: string,
): ErrorEntry {
  return { code, message, path, layer: "behavioralHonesty", severity: "error" };
}

/**
 * Scan a turns/events HSC trace for behavioral honesty violations. Returns
 * `{ pass, violations }`. The input is never mutated. Inputs that are not the
 * turns/events shape produce no violations (Layer 3 has nothing to scan).
 */
export function checkBehavioralHonesty(trace: unknown): BehavioralResult {
  const violations: ErrorEntry[] = [];

  if (typeof trace !== "object" || trace === null) {
    return { pass: true, violations };
  }
  const turns = (trace as { turns?: unknown }).turns;
  if (!Array.isArray(turns)) {
    return { pass: true, violations };
  }

  turns.forEach((turn, turnIdx) => {
    const events = (turn as { events?: unknown })?.events;
    if (!Array.isArray(events)) {
      return;
    }
    events.forEach((event, eventIdx) => {
      if (typeof event !== "object" || event === null) {
        return;
      }
      const e = event as Record<string, unknown>;
      const eventType = e[HARNESS_ATTR.eventType];
      if (typeof eventType !== "string") {
        return; // identity errors are a Layer 2 concern
      }
      const path = `/turns/${turnIdx}/events/${eventIdx}`;

      // (1) prohibited-inference: inferred=true outside the permitted set.
      if (
        e[HARNESS_ATTR.inferred] === true &&
        !PERMITTED_INFERENCE.has(eventType)
      ) {
        violations.push(
          violation(
            "prohibited-inference",
            `${HARNESS_ATTR.inferred}=true is prohibited on "${eventType}"; inference is permitted only on {plan.emit, context.load} (spec §5)`,
            `${path}/${HARNESS_ATTR.inferred}`,
          ),
        );
      }

      // (2) fabricated-event: a verify.result/feedback.check the trace marks as
      //     unsubstantiated was synthesized to fill an absence (spec §4).
      if (
        SUBSTANTIATED_EVENT_TYPES.has(eventType) &&
        e[UNSUBSTANTIATED_MARKER] === true
      ) {
        violations.push(
          violation(
            "fabricated-event",
            `"${eventType}" is marked unsubstantiated (${UNSUBSTANTIATED_MARKER}=true) — fabricating an event to fill an honest absence is prohibited (spec §4)`,
            `${path}/${HARNESS_ATTR.eventType}`,
          ),
        );
      }
    });
  });

  return { pass: violations.length === 0, violations };
}
