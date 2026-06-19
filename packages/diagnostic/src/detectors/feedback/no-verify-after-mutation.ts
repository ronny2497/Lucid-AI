/**
 * @lucid/diagnostic — flagship Feedback detector (REQ-04 exit criterion).
 *
 * `feedback.no-verify-after-mutation` emits exactly one `DetectorHit` per
 * state-mutating `tool.call` that is NOT followed, in the SAME turn and at a
 * strictly later position, by a `verify.result` or `feedback.check`. This is the
 * per-hit (numerator) side of the eval-rubric §2.3 Feedback formula; the scorer
 * turns hits into the fraction.
 *
 * Turn + temporal scoping (RESEARCH Pitfall 2): a verify in a later turn, or one
 * that precedes the mutating call in the same turn, does NOT clear the mutation.
 *
 * Matching is HSC-constant-driven only (RESEARCH Pitfall 4): the mutating set is
 * `e.type === EVENT_TYPES tool.call` AND `HARNESS_ATTR.mutatedState === true`; the
 * verify set is `EVENT_TYPES verify.result` OR `feedback.check`. Tool names appear
 * solely inside the evidence string (read via `GEN_AI_ATTR.toolName`), never in the
 * matching predicate. The detector is a pure read-model: it never mutates `trace`.
 */

import { EVENT_TYPES, PRINCIPLES } from "@lucid/hsc-schema";
import type { Detector, DetectorHit, HarnessTrace } from "../../types.js";
import { viewTurns, type EventView } from "../event-access.js";

/** Stable detector id; consumed as a constant so callers never hardcode the string. */
export const NO_VERIFY_AFTER_MUTATION_ID = "feedback.no-verify-after-mutation" as const;

// HSC event-type constants (no bare literals in matching logic).
const TOOL_CALL = EVENT_TYPES[3]; // "tool.call"
const FEEDBACK_CHECK = EVENT_TYPES[4]; // "feedback.check"
const VERIFY_RESULT = EVENT_TYPES[5]; // "verify.result"
const FEEDBACK = PRINCIPLES[2]; // "feedback"

const isMutatingCall = (e: EventView): boolean => e.type === TOOL_CALL && e.mutatedState;
const isVerify = (e: EventView): boolean => e.type === VERIFY_RESULT || e.type === FEEDBACK_CHECK;

export const noVerifyAfterMutation: Detector = {
  id: NO_VERIFY_AFTER_MUTATION_ID,
  principle: FEEDBACK,
  kind: "rule",
  defaultEnabled: true,

  run(trace: HarnessTrace): DetectorHit[] {
    const hits: DetectorHit[] = [];

    for (const turn of viewTurns(trace)) {
      // Stored array order is temporal order (fixtures carry no timestamp). The
      // index of the LAST verify in the turn is the only look-ahead we need: a
      // mutating call at index i is covered iff some verify exists at index > i.
      const events = turn.events;
      let lastVerifyIndex = -1;
      for (let i = events.length - 1; i >= 0; i--) {
        if (isVerify(events[i]!)) {
          lastVerifyIndex = i;
          break;
        }
      }

      for (let i = 0; i < events.length; i++) {
        const e = events[i]!;
        if (!isMutatingCall(e)) continue;
        // Covered only by a verify strictly AFTER this call, in this same turn.
        const covered = lastVerifyIndex > i;
        if (covered) continue;
        const tool = e.toolName ?? "unknown tool";
        hits.push({
          detectorId: NO_VERIFY_AFTER_MUTATION_ID,
          principle: FEEDBACK,
          turnId: turn.id,
          eventIds: [e.id],
          evidence: `${tool} (unverified mutating tool.call)`,
          leverage: "high",
          remediation: `add a verify.result event after ${tool} calls in the same turn`,
        });
      }
    }

    return hits;
  },
};
