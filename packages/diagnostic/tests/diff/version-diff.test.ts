/**
 * Plan 02-05 — version & cohort diffing (REQ-04, Build-to-Delete workflow).
 *
 * `diff(query, {from, to})` groups traces into a `from` and `to` cohort via an
 * abstract `TraceQuery`, runs `diagnose()` per cohort, and reports null-safe
 * per-principle deltas with a deterministic verdict and a cross-schema warning.
 *
 * The cohorts are backed by the two golden cohort fixtures (v37 = empty feedback
 * column; v38 = every mutating call verified), so v37 -> v38 must yield a positive
 * non-null Feedback delta while Context stays flat.
 */

import { describe, it, expect } from "vitest";
import { diff } from "../../src/diff/index.js";
import type { TraceQuery, TraceFilter } from "../../src/diff/trace-query.js";
import type { HarnessTrace } from "../../src/types.js";
import v37 from "../fixtures/golden-cohort-v37.json" with { type: "json" };
import v38 from "../fixtures/golden-cohort-v38.json" with { type: "json" };

interface RawCohort {
  version: string;
  hsc_version?: string;
  traces: unknown[];
}

/**
 * An in-memory `TraceQuery` backed by the cohort fixtures. `queryTraces` returns the
 * flat fixture traces for the requested `version` — `diagnose()` normalizes them.
 * Each cohort may override its emitted `hsc_version` (to exercise the cross-schema
 * warning) without touching the on-disk fixtures.
 */
function makeQuery(cohorts: RawCohort[]): TraceQuery {
  return {
    queryTraces(filter: TraceFilter): Promise<HarnessTrace[]> {
      const cohort = cohorts.find((c) => c.version === filter.version);
      const traces = (cohort?.traces ?? []) as HarnessTrace[];
      return Promise.resolve(traces);
    },
  };
}

const V37 = v37 as RawCohort;
const V38 = v38 as RawCohort;

describe("diff() version & cohort diffing", () => {
  it("v37 -> v38 yields a positive non-null Feedback delta", async () => {
    const result = await diff(makeQuery([V37, V38]), { from: "v37", to: "v38" });

    const feedback = result.principles.feedback;
    expect(feedback.from).not.toBeNull();
    expect(feedback.to).not.toBeNull();
    expect(feedback.delta).not.toBeNull();
    expect(feedback.delta as number).toBeGreaterThan(0);
    // v37 (no verify) -> 0, v38 (all verified) -> 1, delta +1.
    expect(feedback.delta).toBeCloseTo(1, 5);
  });

  it("Context delta is near zero (both cohorts load context the same way)", async () => {
    const result = await diff(makeQuery([V37, V38]), { from: "v37", to: "v38" });
    const context = result.principles.context;
    expect(context.delta).not.toBeNull();
    expect(Math.abs(context.delta as number)).toBeLessThanOrEqual(0.01);
  });

  it("the VersionDiff principle keys are exactly the PRINCIPLES", async () => {
    const result = await diff(makeQuery([V37, V38]), { from: "v37", to: "v38" });
    expect(Object.keys(result.principles).sort()).toEqual(
      ["codebase_docs", "context", "feedback", "one_at_a_time", "plan_execute"].sort(),
    );
  });

  it("a principle null in one cohort yields delta === null (never coerced to 0)", async () => {
    // 'to' cohort has zero traces -> every principle scores null there.
    const result = await diff(makeQuery([V37, { version: "empty", traces: [] }]), {
      from: "v37",
      to: "empty",
    });
    for (const p of Object.values(result.principles)) {
      if (p.to === null) {
        expect(p.delta).toBeNull();
      }
    }
    // Feedback specifically: from is non-null, to is null -> delta must be null, NOT 0.
    expect(result.principles.feedback.to).toBeNull();
    expect(result.principles.feedback.delta).toBeNull();
  });

  it("the verdict is a deterministic, stable, non-LLM string", async () => {
    const a = await diff(makeQuery([V37, V38]), { from: "v37", to: "v38" });
    const b = await diff(makeQuery([V37, V38]), { from: "v37", to: "v38" });
    expect(a.verdict).toBe(b.verdict);
    expect(typeof a.verdict).toBe("string");
    expect(a.verdict.length).toBeGreaterThan(0);
    // Names the principle that moved most (Feedback) and its direction.
    expect(a.verdict.toLowerCase()).toContain("feedback");
  });

  it("warns when the two cohorts carry different HSC schema versions", async () => {
    // Rewrite every member trace's own hsc_version (the field diff() reads), so the
    // 'to' cohort declares a different HSC schema than the 'from' cohort.
    const skewed: RawCohort = {
      ...V38,
      traces: V38.traces.map((t) => ({ ...(t as object), hsc_version: "v1" })),
    };
    const result = await diff(makeQuery([V37, skewed]), { from: "v37", to: "v38" });
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w) => /schema|hsc/i.test(w))).toBe(true);
  });

  it("does NOT warn when both cohorts share an HSC schema version", async () => {
    const result = await diff(makeQuery([V37, V38]), { from: "v37", to: "v38" });
    const hasSchemaWarning = (result.warnings ?? []).some((w) => /schema|hsc/i.test(w));
    expect(hasSchemaWarning).toBe(false);
  });

  it("records the from/to cohort labels on the result", async () => {
    const result = await diff(makeQuery([V37, V38]), { from: "v37", to: "v38" });
    expect(result.from).toBe("v37");
    expect(result.to).toBe("v38");
  });
});
