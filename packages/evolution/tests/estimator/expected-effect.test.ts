/**
 * Estimator contract — rule-based, hit-fraction-scaled, conservative.
 *
 * Pins:
 *   - W3 cross-wave pin: add-gate on the flagship feedback PrincipleScore
 *     (hitCount 18 / relevantEventCount 24 → 0.75) reproduces feedback = 0.30
 *     from BASE_ADD_GATE_FEEDBACK (0.40), matching expected-manifest-add-gate.json.
 *   - A low hit fraction scales the delta DOWN, never up.
 *   - delete-layer → {}.
 *   - Values are rounded to 2 dp and never exceed the base ceiling.
 *   - Non-delete-layer results validate against ExpectedEffectSchema.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DiagnosticResultSchema } from "@lucid/diagnostic";
import type { PrincipleScore } from "@lucid/diagnostic";

import { expectedEffect, HEURISTIC_DELTAS } from "../../src/estimator/index.js";
import { ExpectedEffectSchema } from "../../src/schema.js";
import type { CandidateChangeSet } from "../../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");
const loadDiagnostic = () =>
  DiagnosticResultSchema.parse(
    JSON.parse(readFileSync(join(fixtures, "golden-diagnostic-empty-feedback.json"), "utf8")),
  );
const loadExpectedManifest = () =>
  JSON.parse(readFileSync(join(fixtures, "expected-manifest-add-gate.json"), "utf8")) as {
    expected_effect: Record<string, number>;
  };

const addGate: CandidateChangeSet = {
  change: "add-gate",
  detail: "d",
  rationale: "r",
};

describe("expectedEffect — rule-based hit-fraction-scaled estimator", () => {
  it("reproduces the pinned flagship feedback delta (0.30) from the golden PrincipleScore (W3)", () => {
    const diagnostic = loadDiagnostic();
    const feedbackScore = diagnostic.principles.find((p) => p.principle === "feedback")!;
    const expectedManifest = loadExpectedManifest();

    const effect = expectedEffect(addGate, feedbackScore);

    // 0.40 * (18/24=0.75) = 0.30
    expect(effect.feedback).toBe(0.3);
    expect(effect.feedback).toBe(expectedManifest.expected_effect.feedback);
  });

  it("scales the delta DOWN for a low hit fraction (never up)", () => {
    const lowScore: PrincipleScore = {
      principle: "feedback",
      score: 0.9,
      coverage: 1,
      hitCount: 2,
      relevantEventCount: 20, // hitFraction 0.10
      worstDetector: "",
    };
    const effect = expectedEffect(addGate, lowScore);
    // 0.40 * 0.10 = 0.04
    expect(effect.feedback).toBe(0.04);
    expect(effect.feedback!).toBeLessThan(HEURISTIC_DELTAS["add-gate"].feedback!);
  });

  it("never exceeds the base ceiling and rounds to 2 dp", () => {
    // hitFraction = 1 → exactly the ceiling.
    const fullScore: PrincipleScore = {
      principle: "feedback",
      score: 0,
      coverage: 1,
      hitCount: 10,
      relevantEventCount: 10,
      worstDetector: "",
    };
    const effect = expectedEffect(addGate, fullScore);
    expect(effect.feedback).toBe(HEURISTIC_DELTAS["add-gate"].feedback);

    // Even a (malformed) over-unity fraction is clamped to the ceiling.
    const overScore: PrincipleScore = {
      ...fullScore,
      hitCount: 99,
      relevantEventCount: 10,
    };
    const clamped = expectedEffect(addGate, overScore);
    expect(clamped.feedback).toBe(HEURISTIC_DELTAS["add-gate"].feedback);

    // 2 dp: a fraction that would produce 3+ dp rounds to 2.
    const oddScore: PrincipleScore = {
      ...fullScore,
      hitCount: 1,
      relevantEventCount: 3, // 0.40 * 0.3333 = 0.1333 → 0.13
    };
    expect(expectedEffect(addGate, oddScore).feedback).toBe(0.13);
  });

  it("returns {} for delete-layer (no rule-based delta until diff evidence)", () => {
    const deleteLayer: CandidateChangeSet = { change: "delete-layer", detail: "d", rationale: "r" };
    expect(expectedEffect(deleteLayer, undefined)).toEqual({});
  });

  it("defaults hitFraction to 1 when no PrincipleScore is supplied", () => {
    const effect = expectedEffect(addGate, undefined);
    expect(effect.feedback).toBe(HEURISTIC_DELTAS["add-gate"].feedback);
  });

  it("produces a non-delete-layer result that validates against ExpectedEffectSchema", () => {
    const diagnostic = loadDiagnostic();
    const feedbackScore = diagnostic.principles.find((p) => p.principle === "feedback")!;
    const effect = expectedEffect(addGate, feedbackScore);
    expect(() => ExpectedEffectSchema.parse(effect)).not.toThrow();
    // >=1 non-null entry.
    expect(Object.values(effect).some((v) => v !== null && v !== undefined)).toBe(true);
  });

  it("HEURISTIC_DELTAS encodes the RESEARCH Pattern 3 base table", () => {
    expect(HEURISTIC_DELTAS["add-gate"]).toEqual({ feedback: 0.4 });
    expect(HEURISTIC_DELTAS["trim-context"]).toEqual({ context: 0.2 });
    expect(HEURISTIC_DELTAS["edit-skill"]).toEqual({ plan_execute: 0.15, feedback: 0.1 });
    expect(HEURISTIC_DELTAS["prompt-patch"]).toEqual({ plan_execute: 0.2 });
    expect(HEURISTIC_DELTAS["delete-layer"]).toEqual({});
  });
});
