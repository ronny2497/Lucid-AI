/**
 * @lucid/evolution — `runRegressionGuard`: the fixed-sample A/B regression guard
 * (Plan 04-03, Task 1, REQ-05).
 *
 * The guard is the FALSIFIABILITY layer of L1 auto-apply. Before a candidate
 * harness version is promoted (KEPT), the guard re-runs the diagnosis over a
 * fixed-sample cohort of recent traces for the baseline version and a fixed-sample
 * cohort for the candidate version, compares the configured guard metric, and
 * returns a typed verdict. Only KEEP promotes; everything else blocks promotion.
 *
 * NULL-SAFE + INSUFFICIENT-DATA-SAFE BY CONSTRUCTION (T-04-10 / Pitfall 2 / Pitfall 6):
 *   - If the candidate cohort has fewer than `config.sample` traces, the guard
 *     returns INSUFFICIENT_DATA — an under-sampled cohort is NEVER silently treated
 *     as a pass. Absence of signal blocks promotion.
 *   - If the guard metric score is null on EITHER cohort, the guard returns
 *     NULL_SCORE — `null - null` is NOT a NaN promoted as KEEP. Absence is signal.
 *   - Only when both cohorts are sufficiently sampled AND both scores are non-null
 *     does the guard compute `delta = candidate - baseline` and decide KEEP (delta
 *     >= min_delta) or REVERT (delta < min_delta).
 *
 * TRACESTORE CONTRACT (VERIFIED on disk — packages/store/src/{interface,types}.ts):
 * the cohort key on `TraceFilter` is `version`, NOT `harnessVersion`, and there is
 * NO `limit` field. The guard therefore filters by `{ agentId, version }` and
 * applies `config.sample` as an in-memory `.slice(0, sample)` — the sample is a
 * client-side cap, never a filter field. (This corrects RESEARCH U6/A7.)
 *
 * DIAGNOSE CONTRACT (VERIFIED on disk — packages/diagnostic/src/diagnose.ts): the
 * Phase 2 `diagnose(trace, config?)` takes a SINGLE trace, NOT an array. (This
 * corrects RESEARCH U1.) The guard accepts an injected `diagnoseFn` and applies it
 * PER TRACE, then averages the matching `PrincipleScore.score` across the cohort —
 * the chosen cohort scoring rule. For `regression_metric: "success"` the guard does
 * NOT call diagnose at all; it derives the cohort success RATE from each trace's
 * `statusCode` (a trace is "success" when its `statusCode` indicates success per the
 * Phase 1 success policy: a 2xx status code).
 *
 * DEPENDENCY-INJECTED COLLABORATORS (testable without a real store/diagnosis):
 * the guard depends only on a structural `TraceQuery` (`{ queryTraces }`) and a
 * `DiagnoseFn`, so tests inject an in-memory stub + a mock diagnose. The 04-04
 * orchestrator wires the real `@lucid/store` `TraceStore.queryTraces` and the real
 * `@lucid/diagnostic` `diagnose`. We deliberately do NOT import a concrete store
 * (zero new dependency; mirrors the apply-store decoupling discipline).
 *
 * PURE READ — STRUCTURAL ONLY: the guard never mutates a trace, never writes a
 * harness file, and never touches a model-parameter or training path. The metric
 * is "success" or a principle score only (ADR-0004 L1 boundary; T-04-09).
 */

import type { GuardConfig } from "./apply-config.js";
import type { DiagnosticResult } from "@lucid/diagnostic";

export type { GuardConfig };

/**
 * The minimal cohort-trace shape the guard reads. Structurally satisfied by the
 * `@lucid/store` `HarnessTrace` (and the `@lucid/diagnostic` trace shape) — we keep
 * it local so the guard adds no concrete-store dependency. The guard reads only
 * `statusCode` (for the "success" metric) and hands the whole trace to `diagnoseFn`
 * for a principle metric.
 */
export interface CohortTrace {
  /** Trace-level HTTP-style status code; null when unknown. 2xx === success. */
  statusCode: number | null;
  [key: string]: unknown;
}

/**
 * The minimal filter the guard passes to the store. `version` is the cohort key
 * (NOT `harnessVersion`); there is intentionally NO `limit` field — the sample cap
 * is applied in memory.
 */
export interface GuardTraceFilter {
  agentId?: string;
  version?: string;
}

/**
 * The structural TraceStore seam the guard depends on. The real
 * `@lucid/store` `TraceStore` satisfies this; tests inject an in-memory stub.
 */
export interface TraceQuery {
  queryTraces(filter: GuardTraceFilter): Promise<CohortTrace[]>;
}

/** The injected diagnose function — the real `@lucid/diagnostic` `diagnose` in prod. */
export type DiagnoseFn = (trace: unknown) => DiagnosticResult;

/**
 * The typed verdict. KEEP/REVERT carry the comparable scores + delta;
 * INSUFFICIENT_DATA carries the observed cohort sizes; NULL_SCORE carries the
 * reason. INSUFFICIENT_DATA and NULL_SCORE both BLOCK promotion (only KEEP promotes).
 */
export type GuardVerdict =
  | { verdict: "KEEP"; baselineScore: number; candidateScore: number; delta: number }
  | { verdict: "REVERT"; baselineScore: number; candidateScore: number; delta: number }
  | { verdict: "INSUFFICIENT_DATA"; baselineN: number; candidateN: number }
  | { verdict: "NULL_SCORE"; reason: string };

/** A 2xx status code is "success" per the Phase 1 success policy. */
function isSuccess(statusCode: number | null): boolean {
  return statusCode != null && statusCode >= 200 && statusCode < 300;
}

/**
 * Compute the guard-metric score for a cohort, or null when it cannot be derived.
 *
 *   - `"success"`: the cohort SUCCESS RATE over `statusCode` (no diagnose call).
 *     Returns null only on an empty cohort (an empty cohort has no rate).
 *   - a principle metric: run `diagnoseFn` per trace, read the matching
 *     `PrincipleScore.score`, and AVERAGE the non-null scores. Returns null when
 *     every trace's score for that principle is null (absence is signal — never a
 *     0 backfill).
 */
export function extractScore(
  cohort: CohortTrace[],
  metric: string,
  diagnoseFn: DiagnoseFn,
): number | null {
  if (cohort.length === 0) return null;

  if (metric === "success") {
    const successes = cohort.reduce((n, t) => n + (isSuccess(t.statusCode) ? 1 : 0), 0);
    return successes / cohort.length;
  }

  // Principle metric: diagnose each trace, collect the matching principle score.
  const scores: number[] = [];
  for (const trace of cohort) {
    const result = diagnoseFn(trace);
    const principle = result.principles.find((p) => p.principle === metric);
    if (principle && principle.score !== null) {
      scores.push(principle.score);
    }
  }
  if (scores.length === 0) return null; // all null — absence is signal, NOT a pass.
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * Run the fixed-sample A/B regression guard for `agentId` comparing
 * `candidateVersion` against `baselineVersion`.
 *
 * Order (the load-bearing safety sequence):
 *   1. Query both cohorts by `{ agentId, version }` and slice each to `config.sample`.
 *   2. If the candidate cohort is under-sampled (< sample) -> INSUFFICIENT_DATA.
 *   3. Compute baseline + candidate scores via `extractScore`.
 *   4. If either score is null -> NULL_SCORE.
 *   5. delta = candidate - baseline; KEEP when delta >= min_delta else REVERT.
 *
 * The guard is a pure read: it calls `queryTraces` + the injected `diagnoseFn` and
 * writes nothing. INSUFFICIENT_DATA and NULL_SCORE never resolve to KEEP.
 */
export async function runRegressionGuard(
  agentId: string,
  baselineVersion: string,
  candidateVersion: string,
  config: GuardConfig,
  traceQuery: TraceQuery,
  diagnoseFn: DiagnoseFn,
): Promise<GuardVerdict> {
  // 1. Query both cohorts by the `version` filter key, then cap in memory to
  //    `config.sample` (TraceFilter has no `limit` field — VERIFIED on disk).
  const baselineAll = await traceQuery.queryTraces({ agentId, version: baselineVersion });
  const candidateAll = await traceQuery.queryTraces({ agentId, version: candidateVersion });
  const baseline = baselineAll.slice(0, config.sample);
  const candidate = candidateAll.slice(0, config.sample);

  // 2. Under-sampled candidate cohort blocks promotion (Pitfall 2 — NOT a KEEP).
  if (candidate.length < config.sample) {
    return {
      verdict: "INSUFFICIENT_DATA",
      baselineN: baseline.length,
      candidateN: candidate.length,
    };
  }

  // 3. Score each cohort on the configured guard metric.
  const baselineScore = extractScore(baseline, config.regression_metric, diagnoseFn);
  const candidateScore = extractScore(candidate, config.regression_metric, diagnoseFn);

  // 4. A null score on either side blocks promotion (Pitfall 6 — NOT a NaN KEEP).
  if (baselineScore === null || candidateScore === null) {
    return {
      verdict: "NULL_SCORE",
      reason:
        baselineScore === null && candidateScore === null
          ? "both baseline and candidate guard-metric scores are null"
          : baselineScore === null
            ? "baseline guard-metric score is null"
            : "candidate guard-metric score is null",
    };
  }

  // 5. Null-safe delta and the deterministic KEEP/REVERT decision.
  const delta = candidateScore - baselineScore;
  if (delta >= config.min_delta) {
    return { verdict: "KEEP", baselineScore, candidateScore, delta };
  }
  return { verdict: "REVERT", baselineScore, candidateScore, delta };
}
