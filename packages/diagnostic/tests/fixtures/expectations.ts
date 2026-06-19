/**
 * Recorded expectations for the three golden fixtures.
 *
 * THESE OBJECTS ARE THE SPECIFICATION. Plans 02-02 (scorer/detector), 02-03
 * (plotter), and 02-04 (diagnose integration) implement code until `diagnose()`
 * over each fixture produces output matching the recorded expectation. If the
 * pipeline disagrees with an expectation, the pipeline is wrong — not this file
 * (RESEARCH "Golden Fixture Strategy").
 *
 * The Feedback detector formula (docs/standard/eval-rubric.md §2.3, verbatim):
 *
 *   Feedback = | { c ∈ tool.call : mutated_state=true ∧ ∃ verify.result, same turn, after c } |
 *              ──────────────────────────────────────────────────────────────────────────────
 *              | { c ∈ tool.call : mutated_state=true } |
 *
 * "relevantEventCount" for Feedback = count of mutating tool.call events.
 * "hitCount" for Feedback = count of mutating tool.call events with NO following
 * in-turn verify.result (the no-verify-after-mutation detector hits).
 * Coverage-weighted score (RESEARCH Pattern 2): score = 1 - hitCount/relevantEventCount,
 * EXCEPT relevantEventCount === 0 -> { score: null, coverage: 0 } (the headline guard).
 */

import type { HscPrinciple } from "@lucid/hsc-schema";

/** The subset of a PrincipleScore the fixtures pin (the implementation may add more). */
export interface ExpectedPrincipleScore {
  score: number | null;
  coverage: number;
  hitCount: number;
  relevantEventCount: number;
}

/** What a single fixture's DiagnosticResult MUST contain. */
export interface FixtureExpectation {
  /** Fixture file (relative to tests/fixtures/). */
  fixture: string;
  traceId: string;
  /** Per-principle pinned scores. Partial: only principles the fixture exercises. */
  principles: Partial<Record<HscPrinciple, ExpectedPrincipleScore>>;
  /** Columns (x-axis) the 2x2 plotter MUST report empty. */
  emptyColumns: ("feedforward" | "feedback")[];
  /** The detectorId of the top-ranked finding, or null when there is no finding. */
  topFindingDetectorId: string | null;
}

/**
 * empty-feedback: 3 mutating tool.call events (e3, e4, e6), ZERO verify.result.
 * Feedback relevantEventCount = 3, hitCount = 3 -> score = 1 - 3/3 = 0, coverage = 1.
 * The feedback column is empty -> headline finding fires.
 */
export const emptyFeedbackExpectation: FixtureExpectation = {
  fixture: "golden-trace-empty-feedback.json",
  traceId: "trace-empty-feedback",
  principles: {
    feedback: {
      score: 0,
      coverage: 1,
      hitCount: 3,
      relevantEventCount: 3,
    },
  },
  emptyColumns: ["feedback"],
  topFindingDetectorId: "feedback.no-verify-after-mutation",
};

/**
 * full-feedback: 2 mutating tool.call events (e4, e7), each followed by an in-turn
 * verify.result (e5, e8). Feedback relevantEventCount = 2, hitCount = 0 ->
 * score = 1 - 0/2 = 1, coverage = 1. Feedback column is populated -> no finding.
 */
export const fullFeedbackExpectation: FixtureExpectation = {
  fixture: "golden-trace-full-feedback.json",
  traceId: "trace-full-feedback",
  principles: {
    feedback: {
      score: 1,
      coverage: 1,
      hitCount: 0,
      relevantEventCount: 2,
    },
  },
  emptyColumns: [],
  topFindingDetectorId: null,
};

/**
 * sparse: entirely feedforward — ZERO mutating tool.call events, zero verify.result,
 * zero feedback.check. Feedback relevantEventCount = 0.
 *
 * THE HIGHEST-RISK-BUG GUARD, encoded as spec: Feedback.score MUST be null and
 * Feedback.coverage MUST be 0 — NEVER 1.0 and NEVER 0.0. A sparse / near-empty
 * trace must not masquerade as a passing harness (RESEARCH Pitfall: "Standard
 * coverage ratio formulas silently produce 1.0 when the denominator is zero").
 */
export const sparseExpectation: FixtureExpectation = {
  fixture: "golden-trace-sparse.json",
  traceId: "trace-sparse",
  principles: {
    feedback: {
      score: null,
      coverage: 0,
      hitCount: 0,
      relevantEventCount: 0,
    },
  },
  emptyColumns: ["feedback"],
  topFindingDetectorId: "feedback.absent",
};

/** All recorded expectations, keyed by fixture file name. */
export const expectations = {
  "golden-trace-empty-feedback.json": emptyFeedbackExpectation,
  "golden-trace-full-feedback.json": fullFeedbackExpectation,
  "golden-trace-sparse.json": sparseExpectation,
} as const;
