/**
 * RED until Plan 02-04.
 *
 * End-to-end: `diagnose()` over each golden fixture must produce a DiagnosticResult
 * matching that fixture's recorded expectation (expectations.ts). The `diagnose`
 * import resolves once 02-04 wires the detectors + scorer + plotter behind
 * `src/index.ts`. This is the load-bearing test that makes the fixtures the spec.
 */

import { describe, it, expect } from "vitest";
// @ts-expect-error — implemented in Plan 02-04 (RED scaffold).
import { diagnose } from "../../src/index.js";
import { DiagnosticResultSchema } from "../../src/schema.js";
import emptyFeedback from "../fixtures/golden-trace-empty-feedback.json" with { type: "json" };
import fullFeedback from "../fixtures/golden-trace-full-feedback.json" with { type: "json" };
import sparse from "../fixtures/golden-trace-sparse.json" with { type: "json" };
import { expectations } from "../fixtures/expectations.js";

const cases = [
  ["empty-feedback", emptyFeedback, expectations["golden-trace-empty-feedback.json"]],
  ["full-feedback", fullFeedback, expectations["golden-trace-full-feedback.json"]],
  ["sparse", sparse, expectations["golden-trace-sparse.json"]],
] as const;

describe("diagnose() over golden fixtures", () => {
  it.each(cases)("%s matches its recorded expectation", (_name, fixture, expectation) => {
    const result = diagnose(fixture as never);

    // The output must always satisfy the frozen schema.
    expect(DiagnosticResultSchema.safeParse(result).success).toBe(true);
    expect(result.traceId).toBe(expectation.traceId);

    // Per-principle pinned scores.
    for (const [principle, expected] of Object.entries(expectation.principles)) {
      const actual = result.principles.find((p: { principle: string }) => p.principle === principle);
      expect(actual, `missing principle ${principle}`).toBeDefined();
      expect(actual!.score).toBe(expected.score);
      expect(actual!.coverage).toBe(expected.coverage);
      expect(actual!.hitCount).toBe(expected.hitCount);
      expect(actual!.relevantEventCount).toBe(expected.relevantEventCount);
    }

    // 2x2 empty columns.
    expect(result.plot2x2.emptyColumns).toEqual(expectation.emptyColumns);

    // Top finding detector id (or no finding).
    if (expectation.topFindingDetectorId === null) {
      expect(result.findings).toHaveLength(0);
    } else {
      expect(result.findings[0]?.detectorId).toBe(expectation.topFindingDetectorId);
    }
  });

  it("sparse: Feedback score is null and coverage 0 — never 1.0 (the headline guard)", () => {
    const result = diagnose(sparse as never);
    const feedback = result.principles.find((p: { principle: string }) => p.principle === "feedback");
    expect(feedback!.score).toBeNull();
    expect(feedback!.coverage).toBe(0);
  });

  it("is deterministic: two runs on one fixture are deep-equal excluding generatedAt", () => {
    // LLM-judge defaultEnabled:false → the rule path is the only one wired, so a
    // diagnosis is reproducible evidence (threat T-02-10). `generatedAt` is the
    // single non-deterministic field and is excluded from the comparison.
    const a = diagnose(emptyFeedback as never) as Record<string, unknown>;
    const b = diagnose(emptyFeedback as never) as Record<string, unknown>;
    const { generatedAt: _a, ...restA } = a;
    const { generatedAt: _b, ...restB } = b;
    expect(restA).toEqual(restB);
    // Sanity: the only excluded field really is the timestamp, which is a valid ISO.
    expect(typeof a.generatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(a.generatedAt as string))).toBe(false);
  });

  it("rejects a malformed trace rather than scoring it (threat T-02-08)", () => {
    expect(() => diagnose({ not: "a trace" } as never)).toThrow();
    expect(() => diagnose(null as never)).toThrow();
  });
});
