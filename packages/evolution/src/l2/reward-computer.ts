/**
 * Reward computer — Phase 2 `DiagnosticResult` → scalar reward → schema-valid
 * `RewardDataset` (05-02, REQ-05).
 *
 * This is the "what is good" half of the L2 training-signal pipeline, computed
 * ENTIRELY in TypeScript (ADR-0004, threat T-05-04): the GRPO reward is derived from
 * the same per-principle convergence scores that diagnose the harness, and the only
 * thing destined for the language boundary is a prompts+scalars file whose
 * `reward_source` is the literal `"diagnostic"`. No reward field ever instructs
 * Python to derive quality.
 *
 * Three disciplines are enforced (RESEARCH "Reward From Principle/2×2 Scores"):
 *
 *   1. NULL-IS-SIGNAL (HARD, threat T-05-07): a `PrincipleScore` with `score === null`
 *      OR `coverage === 0` is EXCLUDED from the scalar — NEVER coerced to 0. A sparse
 *      trace that never exercised a principle must not be rewarded (or punished) for
 *      it. This mirrors the Phase 2 absence-is-signal discipline.
 *
 *   2. WEIGHT RENORMALIZATION: the configured weights are renormalized over the
 *      COVERED principles so a partially-null and a fully-covered diagnostic both land
 *      in a score-comparable range. Exact rule (see `computeRewards`):
 *
 *        reward = (Σ_covered weight_p · score_p) / (Σ_covered weight_p) · (Σ_all weight_p)
 *
 *      i.e. the covered-weight average of the scores, rescaled by the ORIGINAL total
 *      weight. When every weighted principle is covered this is the plain weighted sum
 *      Σ weight_p · score_p; when some are null the covered ones absorb the missing
 *      weight proportionally rather than the scalar collapsing toward 0.
 *
 *   3. ALL-NULL DROP: when EVERY weighted principle is null/zero-coverage,
 *      `computeRewards` returns `null` and `buildRewardDataset` DROPS the trajectory
 *      (it is uninformative — never added as a phantom 0-reward example).
 *
 * Plus the ZERO-VARIANCE ADVISORY (RESEARCH Pitfall 2, threat T-05-09): when the
 * included `baseline_reward` values have (near-)zero variance, the returned coverage
 * stats flag `frac_low_variance` so the 05-04 orchestrator can avoid the degenerate
 * GRPO gradient (NaN advantage). The dataset is STILL produced — the flag is advisory,
 * never silent data loss.
 *
 * The `principles` field is read as an ARRAY of `PrincipleScore` (find-by-name), never
 * a map — mirroring Phase 2's `diff/index.ts scoresByPrinciple`.
 *
 * NO-PYTHON-CORE-DEP: imports only `node:crypto`, `zod`-validated schemas, and TYPES.
 * No Python dependency, no subprocess spawn, and no model-weight artifact reference.
 */

import { createHash } from "node:crypto";
import type { DiagnosticResult } from "@lucid/diagnostic";
import {
  RewardDatasetSchema,
  type RewardDataset,
  type RewardEntry,
} from "./schemas/reward-dataset.js";
import type { PromptRecord } from "./trajectory-exporter.js";

/**
 * A principle→weight map describing how the scalar reward is composed. Keys are
 * canonical PRINCIPLES names (the schema's `.strict()` reward_composition rejects any
 * non-principle key downstream). A weight on a principle absent / null / zero-coverage
 * in a given diagnostic is simply excluded for that diagnostic.
 */
export type RewardWeights = Partial<Record<string, number>>;

/** Coverage / quality statistics returned alongside a built dataset. */
export interface RewardCoverageStats {
  /** Total prompts considered. */
  total: number;
  /** Prompts that produced a reward and entered the dataset. */
  included: number;
  /** Prompts dropped because no diagnostic matched OR every principle was null. */
  dropped_all_null: number;
  /** Population variance of the included baseline_reward values (0 when <2 entries). */
  reward_variance: number;
  /** Advisory: true when reward_variance < LOW_VARIANCE_EPS (Pitfall 2). */
  frac_low_variance: boolean;
}

/**
 * Variance threshold below which the reward set is flagged degenerate (Pitfall 2).
 * A spread this small yields ~zero GRPO advantage and a NaN-prone gradient. Chosen
 * small enough that genuinely varied rewards never trip it, large enough to catch
 * floating-point-identical sets.
 */
export const LOW_VARIANCE_EPS = 1e-9;

/** The W3 cross-language prompt_hash formula (matches the 05-01 schema header). */
export function canonicalPromptHash(prompt: string): string {
  return "sha256:" + createHash("sha256").update(prompt, "utf8").digest("hex");
}

/**
 * Compute the scalar reward for one diagnostic under a weighting.
 *
 * Reads `diagnostic.principles` as an ARRAY (find-by-name). A principle is COVERED
 * only when its entry exists, `score !== null`, and `coverage > 0`. Excludes
 * uncovered principles (no null→0 coercion) and renormalizes over covered weight.
 *
 * @returns the scalar reward, or `null` when no weighted principle is covered (the
 *   caller DROPS such an all-null trajectory).
 */
export function computeRewards(
  diagnostic: DiagnosticResult,
  weights: RewardWeights,
): number | null {
  let weightedSum = 0;
  let coveredWeight = 0;
  let originalTotal = 0;

  for (const [principle, rawWeight] of Object.entries(weights)) {
    const weight = rawWeight ?? 0;
    if (weight === 0) continue;
    originalTotal += weight;

    const ps = diagnostic.principles.find((p) => p.principle === principle);
    // NULL-IS-SIGNAL: excluded when absent, score null, or coverage 0 (never zeroed).
    if (!ps || ps.score === null || ps.coverage === 0) continue;

    weightedSum += weight * ps.score;
    coveredWeight += weight;
  }

  if (coveredWeight === 0) return null;

  // Covered-weight average rescaled by the original total weight → comparable range.
  return (weightedSum / coveredWeight) * originalTotal;
}

/**
 * The per-principle covered scores that fed the scalar — the dataset's
 * `principle_breakdown`. Only covered principles are included (PRINCIPLES keys only;
 * the schema's `.strict()` rejects any other key).
 */
function coveredBreakdown(
  diagnostic: DiagnosticResult,
  weights: RewardWeights,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [principle, rawWeight] of Object.entries(weights)) {
    if ((rawWeight ?? 0) === 0) continue;
    const ps = diagnostic.principles.find((p) => p.principle === principle);
    if (!ps || ps.score === null || ps.coverage === 0) continue;
    out[principle] = ps.score;
  }
  return out;
}

/** Population variance of a numeric array (0 for <2 elements). */
function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sumSq = values.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  return sumSq / values.length;
}

/** Build a `reward_composition` record from the weights (PRINCIPLES keys, numbers). */
function compositionFromWeights(weights: RewardWeights): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [principle, weight] of Object.entries(weights)) {
    if (weight === undefined) continue;
    out[principle] = weight;
  }
  return out;
}

/**
 * Assemble a schema-valid `RewardDataset` from prompts + their diagnostics.
 *
 * For each prompt: look up its `DiagnosticResult` by `prompt_hash`; compute the scalar
 * via {@link computeRewards}. If absent or null (all-null trajectory), DROP it
 * (counted in `dropped_all_null`). Otherwise emit a `RewardEntry` with
 * `baseline_reward` + the covered `principle_breakdown`.
 *
 * The output is validated against `RewardDatasetSchema` (reward_source "diagnostic")
 * before return, and the included rewards' variance is reported with the advisory
 * `frac_low_variance` flag (Pitfall 2).
 */
export function buildRewardDataset(
  prompts: PromptRecord[],
  diagnosticsByPromptHash: Map<string, DiagnosticResult>,
  weights: RewardWeights,
  jobId: string,
): { dataset: RewardDataset; stats: RewardCoverageStats } {
  const entries: RewardEntry[] = [];
  let dropped = 0;

  for (const prompt of prompts) {
    const diagnostic = diagnosticsByPromptHash.get(prompt.prompt_hash);
    if (!diagnostic) {
      dropped += 1;
      continue;
    }
    const reward = computeRewards(diagnostic, weights);
    if (reward === null) {
      dropped += 1;
      continue;
    }
    entries.push({
      prompt_hash: prompt.prompt_hash,
      prompt: prompt.prompt,
      baseline_reward: reward,
      principle_breakdown: coveredBreakdown(diagnostic, weights) as RewardEntry["principle_breakdown"],
    });
  }

  const rewardVariance = variance(entries.map((e) => e.baseline_reward));

  const dataset: RewardDataset = {
    version: "1",
    job_id: jobId,
    reward_source: "diagnostic",
    reward_composition: compositionFromWeights(weights) as RewardDataset["reward_composition"],
    entries,
  };

  // Validate against the frozen 05-01 contract before handing the dataset back.
  const parsed = RewardDatasetSchema.parse(dataset);

  const stats: RewardCoverageStats = {
    total: prompts.length,
    included: entries.length,
    dropped_all_null: dropped,
    reward_variance: rewardVariance,
    frac_low_variance: entries.length >= 2 && rewardVariance < LOW_VARIANCE_EPS,
  };

  return { dataset: parsed, stats };
}
