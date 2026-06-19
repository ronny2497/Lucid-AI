/**
 * `CandidateProvenance` — the model-artifact lineage a promoted (or discarded)
 * candidate must carry (REQ-05, Phase 5 L2, plan 05-03).
 *
 * Every promotion decision is recorded as an `evolve.promote` HSC audit event
 * (see `promotion-gate.ts`). The provenance assembled here is the lineage that
 * event carries: enough to answer "which base model, which training job, which
 * candidate, composed from which reward, and how did it clear which gate?" — so
 * the lineage of the live production model is never lost (threat T-05-12).
 *
 * NO RAW CONTENT (threat T-05-14): the provenance carries IDs, scores, deltas,
 * paths, and the reward composition (principle→weight map) ONLY. There is
 * intentionally NO field for raw holdout prompt text or model output — consistent
 * with the Phase 2/3/4 no-raw-content audit discipline. A test asserts the
 * absence of any `prompt`/`completion`/`output` key.
 *
 * OPAQUE ARTIFACT / NO-PYTHON-CORE-DEP: this module imports no Python, spawns no
 * subprocess, and never loads/merges weights — it only reads scalar fields off
 * the already-validated `ResultManifest` and the gate result. It imports only a
 * TS type.
 */

import type { ResultManifest } from "./schemas/result-manifest.js";

/**
 * The gate sub-record carried in the provenance: how the candidate cleared (or
 * failed) the independent held-out bar. Scores/deltas/paths only — no raw content.
 */
export interface ProvenanceGate {
  /** The operator-chosen, reward-independent metric the gate measured. */
  metric: string;
  /** candidateScore - incumbentScore; `null` when the gate failed closed (error manifest). */
  delta: number | null;
  /** The margin the candidate had to clear. */
  min_improvement: number;
  /** Path to the held-out eval set the gate loaded (a path, not its contents). */
  holdout_path: string;
  /** The gate's verdict. */
  passed: boolean;
}

/**
 * The lineage a candidate artifact carries into the `evolve.promote` audit event.
 * IDs, scores, paths, and the reward composition only — never raw prompt/output.
 */
export interface CandidateProvenance {
  /** The base model the candidate was fine-tuned from. */
  base_model_ref: string;
  /** The training job that produced the candidate. */
  job_id: string;
  /** The candidate artifact's id. */
  candidate_id: string;
  /** Optional harness version range the candidate is compatible with. */
  harness_version_range?: string;
  /** The principle→weight reward composition the trainer optimized (weights, not text). */
  reward_composition: Record<string, number | undefined>;
  /** How the candidate fared against the independent held-out gate. */
  gate: ProvenanceGate;
}

/** The gate-result shape this builder reads (kept structural to avoid a cycle with the gate). */
interface GateResultLike {
  metric: string;
  delta: number | null;
  passed: boolean;
}

/**
 * Assemble the {@link CandidateProvenance} for a candidate from its
 * already-validated manifest, the reward composition the trainer optimized, the
 * holdout path the gate loaded, and the gate verdict.
 *
 * NO RAW CONTENT: only scalar lineage is copied — there is no path by which raw
 * holdout text or model output enters the returned object.
 *
 * @param manifest the trainer-output manifest (provides base_model_ref/job_id/candidate_id).
 * @param rewardComposition the principle→weight map the reward was composed from.
 * @param holdoutPath the held-out eval path the gate loaded.
 * @param gateResult the gate verdict (metric/delta/passed).
 * @param minImprovement the margin the gate required (default 0.02).
 * @param harnessVersionRange optional compatible harness version range.
 */
export function buildCandidateProvenance(
  manifest: ResultManifest,
  rewardComposition: Record<string, number | undefined>,
  holdoutPath: string,
  gateResult: GateResultLike,
  minImprovement = 0.02,
  harnessVersionRange?: string,
): CandidateProvenance {
  return {
    base_model_ref: manifest.base_model_ref,
    job_id: manifest.job_id,
    candidate_id: manifest.candidate_id,
    ...(harnessVersionRange !== undefined ? { harness_version_range: harnessVersionRange } : {}),
    // Copy the composition (weights only) — a shallow copy so callers cannot
    // later mutate the recorded lineage through the original reference.
    reward_composition: { ...rewardComposition },
    gate: {
      metric: gateResult.metric,
      delta: gateResult.delta,
      min_improvement: minImprovement,
      holdout_path: holdoutPath,
      passed: gateResult.passed,
    },
  };
}
