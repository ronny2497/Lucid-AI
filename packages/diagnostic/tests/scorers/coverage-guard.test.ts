/**
 * RED until Plan 02-02.
 *
 * The coverage-weighted scorer guard: when a principle has ZERO relevant events,
 * `scorePrinciple` MUST return `{ score: null, coverage: 0 }` — never 1.0. This is
 * the highest-risk-bug pin (RESEARCH Pitfall: ratio formulas silently yield 1.0 on
 * a zero denominator). The import resolves once 02-02 creates `src/scorers/index.ts`.
 */

import { describe, it, expect } from "vitest";
// @ts-expect-error — implemented in Plan 02-02 (RED scaffold).
import { scorePrinciple } from "../../src/scorers/index.js";
import { sparseExpectation } from "../fixtures/expectations.js";

describe("scorePrinciple coverage guard", () => {
  it("returns score null + coverage 0 for zero relevant events (sparse case)", () => {
    const result = scorePrinciple("feedback", [], 0);
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
    // Pin against the recorded sparse expectation so the spec and test agree.
    expect(result.score).toBe(sparseExpectation.principles.feedback!.score);
    expect(result.coverage).toBe(sparseExpectation.principles.feedback!.coverage);
  });

  it("never reports 1.0 when the denominator is zero", () => {
    const result = scorePrinciple("feedback", [], 0);
    expect(result.score).not.toBe(1);
  });
});
