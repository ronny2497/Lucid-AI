/**
 * @lucid/diagnostic — coverage-weighted principle scorer (REQ-04).
 *
 * `scorePrinciple` aggregates a principle's `DetectorHit[]` into a coverage-weighted
 * 0–1 score. Its FIRST statement is the zero-denominator guard: when
 * `relevantEventCount === 0` it returns `{ score: null, coverage: 0 }` BEFORE any
 * division, so the "1 - 0/0 → 1.0/NaN" false-pass (RESEARCH Pitfall 1) is impossible.
 *
 * `scorePrinciples` computes each principle's relevant-event count from the trace
 * (feedback = mutating `tool.call`s; others = events the `EVENT_PRINCIPLE` map binds
 * to the principle), groups `allHits` by principle, and returns one validated
 * `PrincipleScore` per `PRINCIPLES`.
 *
 * Inferred-evidence hits (events with `harness.inferred=true`) contribute at
 * `INFERRED_WEIGHT` (RESEARCH Pitfall 3 / Assumption A11) — the single point of
 * adjustment if Phase 0 OQ-03 fixes a different factor. The denominator dedupes
 * events that triggered multiple same-principle detectors (RESEARCH Open Question 1).
 *
 * Pure: never mutates `trace` or `allHits`. All matching uses `@lucid/hsc-schema`
 * constants — no bare event-type / attribute literals.
 */

import { EVENT_TYPES, PRINCIPLES, EVENT_PRINCIPLE } from "@lucid/hsc-schema";
import type { HscPrinciple } from "@lucid/hsc-schema";
import type { DetectorHit, HarnessTrace } from "../types.js";
import { PrincipleScoreSchema, type PrincipleScore } from "../schema.js";
import { viewTurns, type EventView } from "../detectors/event-access.js";

/**
 * Confidence multiplier applied to hits whose underlying event carries
 * `harness.inferred=true` (default 0.5 — RESEARCH Assumption A11). Changing this is
 * the single point of adjustment for Phase 0 OQ-03.
 */
export const INFERRED_WEIGHT = 0.5;

const TOOL_CALL = EVENT_TYPES[3]; // "tool.call"

/**
 * Score one principle from its already-filtered hits and its relevant-event count.
 *
 * The zero-denominator guard is the first statement: absence is signal, never a
 * pass. `inferredEventIds` is the set of event ids known to come from inferred
 * events, so inferred-evidence hits can be down-weighted by `INFERRED_WEIGHT`.
 */
export function scorePrinciple(
  principle: HscPrinciple,
  hits: readonly DetectorHit[],
  relevantEventCount: number,
  inferredEventIds: ReadonlySet<string> = new Set(),
): PrincipleScore {
  // Highest-risk-bug guard (RESEARCH Pitfall 1): no division when there is nothing
  // to divide by. A sparse / empty principle scores null + coverage 0, never 1.0.
  if (relevantEventCount === 0) {
    return {
      principle,
      score: null,
      coverage: 0,
      hitCount: 0,
      relevantEventCount: 0,
      worstDetector: "",
    };
  }

  // Dedup the denominator/numerator per Open Question 1: an event that triggered
  // multiple same-principle detectors counts ONCE. Track, per offending event, the
  // max contribution weight (an explicit hit on the event dominates an inferred one).
  const weightByEvent = new Map<string, number>();
  const hitsByDetector = new Map<string, number>();

  for (const hit of hits) {
    hitsByDetector.set(hit.detectorId, (hitsByDetector.get(hit.detectorId) ?? 0) + 1);
    for (const eventId of hit.eventIds) {
      const weight = inferredEventIds.has(eventId) ? INFERRED_WEIGHT : 1;
      const prior = weightByEvent.get(eventId) ?? 0;
      if (weight > prior) weightByEvent.set(eventId, weight);
    }
  }

  let weightedHitCount = 0;
  for (const w of weightByEvent.values()) weightedHitCount += w;

  const dedupedHitCount = weightByEvent.size;
  const score = Math.max(0, Math.min(1, 1 - weightedHitCount / relevantEventCount));
  // Coverage is INSTRUMENTATION presence — the fraction of this principle's relevant
  // events that were actually emitted (schema.ts contract) — NOT the hit fraction.
  // `relevantEventCount` already counts the emitted relevant events, so once the
  // zero-denominator guard above has passed there is observable surface for the
  // principle: coverage is 1. (The zero-relevant case returns coverage 0 earlier —
  // the headline absence guard.) Tying coverage to `dedupedHitCount` was a bug: a
  // fully-verified principle (full-feedback: 0 hits / 2 relevant) wrongly read 0.
  const coverage = 1;

  let worstDetector = "";
  let worstCount = -1;
  for (const [id, count] of hitsByDetector) {
    if (count > worstCount) {
      worstCount = count;
      worstDetector = id;
    }
  }

  return {
    principle,
    score,
    coverage,
    hitCount: dedupedHitCount,
    relevantEventCount,
    worstDetector,
  };
}

/**
 * Per-principle relevant-event count derived from the trace via HSC constants.
 *
 * Feedback's relevant set is the mutating `tool.call` events (eval-rubric §2.3);
 * every other principle's relevant set is the events `EVENT_PRINCIPLE` binds to it.
 * Also returns the set of event ids carrying `harness.inferred=true` for weighting.
 */
function analyzeTrace(trace: HarnessTrace): {
  relevantByPrinciple: Record<HscPrinciple, number>;
  inferredEventIds: Set<string>;
} {
  const relevantByPrinciple = Object.fromEntries(
    PRINCIPLES.map((p) => [p, 0]),
  ) as Record<HscPrinciple, number>;
  const inferredEventIds = new Set<string>();

  for (const turn of viewTurns(trace)) {
    for (const e of turn.events) {
      if (e.inferred) inferredEventIds.add(e.id);
      countRelevant(e, relevantByPrinciple);
    }
  }
  return { relevantByPrinciple, inferredEventIds };
}

function countRelevant(e: EventView, acc: Record<HscPrinciple, number>): void {
  // Feedback: relevant set is mutating tool.call events (numerator/denominator base
  // of the eval-rubric §2.3 formula), NOT the verify events themselves.
  if (e.type === TOOL_CALL && e.mutatedState) {
    acc.feedback += 1;
  }
  // Other principles: the event's bound principle from the canonical map. A
  // mutating tool.call also counts toward plan_execute (its bound principle).
  const bound = EVENT_PRINCIPLE[e.type];
  if (bound && bound !== "feedback") {
    acc[bound] += 1;
  }
}

/**
 * Score every principle for a trace. Returns one `PrincipleScore` per `PRINCIPLES`,
 * each validated against `PrincipleScoreSchema`. Pure — does not mutate inputs.
 */
export function scorePrinciples(
  trace: HarnessTrace,
  allHits: readonly DetectorHit[],
): PrincipleScore[] {
  const { relevantByPrinciple, inferredEventIds } = analyzeTrace(trace);

  const hitsByPrinciple = new Map<HscPrinciple, DetectorHit[]>();
  for (const hit of allHits) {
    const list = hitsByPrinciple.get(hit.principle);
    if (list) list.push(hit);
    else hitsByPrinciple.set(hit.principle, [hit]);
  }

  return PRINCIPLES.map((principle) => {
    const score = scorePrinciple(
      principle,
      hitsByPrinciple.get(principle) ?? [],
      relevantByPrinciple[principle],
      inferredEventIds,
    );
    // Every returned object validates against the frozen Zod shape (02-01 contract).
    return PrincipleScoreSchema.parse(score);
  });
}
