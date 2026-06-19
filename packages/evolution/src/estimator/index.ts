/**
 * @lucid/evolution — the rule-based `expected_effect` estimator.
 *
 * `expectedEffect(candidate, principleScore)` attaches a CONSERVATIVE, falsifiable
 * predicted delta to a candidate change-set. The prediction is the change kind's
 * base heuristic delta (RESEARCH Pattern 3 `HEURISTIC_DELTAS`) scaled by the
 * matching `PrincipleScore`'s hit fraction:
 *
 *   hitFraction = hitCount / max(relevantEventCount, 1)        // [0, 1]
 *   delta(p)    = round2( clampToCeiling( base(p) * hitFraction ) )
 *
 * Properties (the falsifiability discipline):
 *   - Scaled by hit fraction so a low-incidence finding predicts a small delta —
 *     the heuristic max is a CEILING, never the floor (Pitfall 1: over-precision
 *     erodes trust; threat T-03-06).
 *   - Rounded to 2 decimals — no spurious precision.
 *   - Clamped so a scaled value can never exceed its base ceiling.
 *   - `delete-layer → {}` : no rule-based delta until VersionDiff evidence is
 *     supplied (Pitfall 5). The propose() path treats `{}` as diff-evidence-required.
 *   - Every non-delete-layer kind yields >=1 non-null entry, so the assembled
 *     manifest's `expected_effect` can never be empty/unfalsifiable.
 *
 * B4 [VERIFIED]: the scaling counts live on `PrincipleScore`, NOT on `Finding`.
 * `propose()` passes the matching `diagnostic.principles[].principle === finding.principle`.
 *
 * `llm-assisted` is OUT OF SCOPE for Phase 3 (Phase 1 exposes no provider
 * abstraction — C3). The schema enum value exists, but only the rule-based path is
 * wired here. No LLM call, no new dependency.
 *
 * ZERO BLAST RADIUS (L0): pure function; no write path.
 */

import type { PrincipleScore } from "@lucid/diagnostic";

import type { CandidateChangeSet, ChangeSetKind, ExpectedEffect, Principle } from "../types.js";

/**
 * Base predicted per-principle deltas per change kind (RESEARCH Pattern 3).
 * These are CEILINGS — the realised prediction is `base * hitFraction`, clamped
 * never to exceed the base. `delete-layer` carries no rule-based delta.
 */
export const HEURISTIC_DELTAS: Record<ChangeSetKind, Partial<Record<Principle, number>>> = {
  "add-gate": { feedback: 0.4 },
  "trim-context": { context: 0.2 },
  "edit-skill": { plan_execute: 0.15, feedback: 0.1 },
  "prompt-patch": { plan_execute: 0.2 },
  "delete-layer": {},
};

/** Round a number to (at most) 2 decimal places, returned as a number. */
function round2(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * Compute the conservative, hit-fraction-scaled `expected_effect` for a candidate.
 *
 * @param candidate       the change-set whose kind selects the base delta table
 * @param principleScore  the matching PrincipleScore (counts drive scaling); when
 *                         absent, hitFraction defaults to 1 (full base ceiling)
 */
export function expectedEffect(
  candidate: CandidateChangeSet,
  principleScore: PrincipleScore | undefined,
): ExpectedEffect {
  const base = HEURISTIC_DELTAS[candidate.change];

  // delete-layer (and any kind with no base table) → no rule-based delta.
  if (!base || Object.keys(base).length === 0) {
    return {} as ExpectedEffect;
  }

  const hitFraction = principleScore
    ? principleScore.hitCount / Math.max(principleScore.relevantEventCount, 1)
    : 1;
  // hitFraction is in [0,1] for well-formed scores; clamp defensively so we never
  // scale ABOVE the base ceiling even if upstream counts are malformed.
  const safeFraction = Math.min(Math.max(hitFraction, 0), 1);

  const effect: Partial<Record<Principle, number>> = {};
  for (const [principle, ceiling] of Object.entries(base) as Array<[Principle, number]>) {
    const scaled = ceiling * safeFraction;
    // Clamp to the base ceiling, then round to 2dp.
    effect[principle] = round2(Math.min(scaled, ceiling));
  }

  return effect as ExpectedEffect;
}
