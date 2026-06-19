/**
 * `runRegressionGuard` — the fixed-sample A/B regression guard (Plan 04-03, Task 1).
 *
 * Asserts the four typed verdicts and the two safety invariants:
 *   - KEEP when the candidate cohort is sufficiently sampled and delta >= min_delta;
 *   - REVERT when delta < min_delta;
 *   - INSUFFICIENT_DATA (NOT KEEP) when the candidate cohort is under-sampled (Pitfall 2);
 *   - NULL_SCORE (NOT KEEP) when a guard-metric score is null on either cohort (Pitfall 6);
 *   - the guard filters cohorts by `version` (the stub records the filter it received)
 *     and applies `sample` in memory (no `limit` field passed);
 *   - the guard performs NO harness write (it only reads queryTraces + diagnoseFn).
 *
 * Imports the module directly (not the barrel) — `src/index.ts` is owned by 04-04.
 */

import { describe, it, expect } from "vitest";

import {
  runRegressionGuard,
  extractScore,
  type CohortTrace,
  type GuardTraceFilter,
  type TraceQuery,
  type DiagnoseFn,
} from "../../src/guard.js";
import type { GuardConfig } from "../../src/apply-config.js";
import type { DiagnosticResult } from "@lucid/diagnostic";

/** A trace with the given 2xx/5xx status (success/failure for the "success" metric). */
function trace(statusCode: number | null, version = "v1"): CohortTrace {
  return { statusCode, traceId: `t-${Math.random()}`, agentId: "a", harnessVersion: version };
}

/** A stub TraceQuery that returns canned cohorts and RECORDS every filter it received. */
function stubQuery(byVersion: Record<string, CohortTrace[]>): {
  query: TraceQuery;
  filters: GuardTraceFilter[];
} {
  const filters: GuardTraceFilter[] = [];
  const query: TraceQuery = {
    async queryTraces(filter: GuardTraceFilter): Promise<CohortTrace[]> {
      filters.push(filter);
      return byVersion[filter.version ?? ""] ?? [];
    },
  };
  return { query, filters };
}

/** A diagnose stub returning a fixed `context` principle score (or null). */
function diagnoseWithContextScore(score: number | null): DiagnoseFn {
  return (_trace: unknown): DiagnosticResult =>
    ({
      traceId: "t",
      agentId: "a",
      principles: [
        {
          principle: "context",
          score,
          coverage: score === null ? 0 : 1,
          hitCount: 0,
          relevantEventCount: score === null ? 0 : 1,
          worstDetector: "",
        },
      ],
      findings: [],
      plot2x2: { cells: {}, emptyColumns: [], emptyRows: [] },
      generatedAt: "2026-06-18T00:00:00.000Z",
      llmJudgeEnabled: false,
    }) as unknown as DiagnosticResult;
}

const cfg = (over: Partial<GuardConfig> = {}): GuardConfig => ({
  regression_metric: "success",
  min_delta: 0,
  sample: 3,
  ...over,
});

/** A diagnoseFn that must never be called (the "success" metric path). */
const failIfCalled: DiagnoseFn = () => {
  throw new Error("diagnoseFn must not be called for the success metric");
};

describe("runRegressionGuard — fixed-sample A/B verdict", () => {
  it("KEEP when candidate cohort is sufficiently sampled and candidate >= baseline", async () => {
    // baseline: 2/3 success (0.667); candidate: 3/3 success (1.0); delta +0.333 >= 0.
    const { query } = stubQuery({
      base: [trace(200), trace(200), trace(500)],
      cand: [trace(200), trace(200), trace(200)],
    });
    const verdict = await runRegressionGuard("a", "base", "cand", cfg(), query, failIfCalled);
    expect(verdict.verdict).toBe("KEEP");
    if (verdict.verdict === "KEEP") {
      expect(verdict.candidateScore).toBeCloseTo(1);
      expect(verdict.baselineScore).toBeCloseTo(2 / 3);
      expect(verdict.delta).toBeGreaterThan(0);
    }
  });

  it("REVERT when candidate regressed below min_delta", async () => {
    // baseline: 3/3 (1.0); candidate: 1/3 (0.333); delta -0.667 < 0.
    const { query } = stubQuery({
      base: [trace(200), trace(200), trace(200)],
      cand: [trace(200), trace(500), trace(500)],
    });
    const verdict = await runRegressionGuard("a", "base", "cand", cfg(), query, failIfCalled);
    expect(verdict.verdict).toBe("REVERT");
    if (verdict.verdict === "REVERT") expect(verdict.delta).toBeLessThan(0);
  });

  it("INSUFFICIENT_DATA (NOT KEEP) when the candidate cohort is under-sampled (Pitfall 2)", async () => {
    // sample = 3 but candidate has only 2 traces.
    const { query } = stubQuery({
      base: [trace(200), trace(200), trace(200)],
      cand: [trace(200), trace(200)],
    });
    const verdict = await runRegressionGuard("a", "base", "cand", cfg(), query, failIfCalled);
    expect(verdict.verdict).toBe("INSUFFICIENT_DATA");
    expect(verdict.verdict).not.toBe("KEEP");
    if (verdict.verdict === "INSUFFICIENT_DATA") {
      expect(verdict.candidateN).toBe(2);
      expect(verdict.baselineN).toBe(3);
    }
  });

  it("NULL_SCORE (NOT KEEP) when a principle score is null on the candidate cohort (Pitfall 6)", async () => {
    const { query } = stubQuery({
      base: [trace(200), trace(200), trace(200)],
      cand: [trace(200), trace(200), trace(200)],
    });
    // Principle metric; diagnose returns a null score for every candidate trace.
    const verdict = await runRegressionGuard(
      "a",
      "base",
      "cand",
      cfg({ regression_metric: "context" }),
      query,
      diagnoseWithContextScore(null),
    );
    expect(verdict.verdict).toBe("NULL_SCORE");
    expect(verdict.verdict).not.toBe("KEEP");
  });

  it("KEEP on a principle metric when both cohort scores are non-null and delta >= min_delta", async () => {
    const { query } = stubQuery({
      base: [trace(200), trace(200), trace(200)],
      cand: [trace(200), trace(200), trace(200)],
    });
    const verdict = await runRegressionGuard(
      "a",
      "base",
      "cand",
      cfg({ regression_metric: "context" }),
      query,
      diagnoseWithContextScore(0.8),
    );
    // Same fixed score on both cohorts -> delta 0 >= min_delta 0 -> KEEP.
    expect(verdict.verdict).toBe("KEEP");
  });

  it("filters cohorts by `version` (NOT harnessVersion) and slices `sample` in memory", async () => {
    const { query, filters } = stubQuery({
      base: [trace(200), trace(200), trace(200), trace(200), trace(200)],
      cand: [trace(200), trace(200), trace(200), trace(200)],
    });
    await runRegressionGuard("a", "base", "cand", cfg({ sample: 3 }), query, failIfCalled);
    // The guard queried by { agentId, version } — never a `harnessVersion`/`limit` key.
    expect(filters).toHaveLength(2);
    for (const f of filters) {
      expect(f.agentId).toBe("a");
      expect(typeof f.version).toBe("string");
      expect(f).not.toHaveProperty("harnessVersion");
      expect(f).not.toHaveProperty("limit");
    }
    expect(filters[0].version).toBe("base");
    expect(filters[1].version).toBe("cand");
  });

  it("extractScore returns the cohort success RATE for the success metric (no diagnose call)", () => {
    const score = extractScore([trace(200), trace(500), trace(200)], "success", failIfCalled);
    expect(score).toBeCloseTo(2 / 3);
  });

  it("extractScore returns null for an empty cohort (no rate to derive)", () => {
    expect(extractScore([], "success", failIfCalled)).toBeNull();
  });
});
