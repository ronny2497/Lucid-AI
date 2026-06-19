/**
 * `buildCandidateProvenance` tests (plan 05-03).
 *
 * Imports by RELATIVE path (the barrel re-export is deferred to 05-04).
 *
 * Pins:
 *   - the provenance carries the lineage fields (base_model_ref, job_id,
 *     candidate_id, reward_composition, gate.{metric,delta,min_improvement,
 *     holdout_path,passed})
 *   - NO raw content: no `prompt`/`completion`/`output`/`expected_output` key on
 *     the provenance object OR its gate sub-object (threat T-05-14)
 */

import { describe, it, expect } from "vitest";

import { buildCandidateProvenance } from "../../src/l2/candidate-provenance.js";
import type { GateResult } from "../../src/l2/promotion-gate.js";
import type { ResultManifest } from "../../src/l2/schemas/result-manifest.js";

function okManifest(): ResultManifest {
  return {
    job_id: "job-0001",
    candidate_id: "cand-0001",
    artifact_path: "/abs/out/job-0001/adapter",
    base_model_ref: "Qwen/Qwen2.5-0.5B",
    metrics: { reward_mean: 0.71, reward_std: 0.12, steps: 40, epochs: 1 },
    config_snapshot: { loss_type: "dr_grpo" },
    completed_at: "2026-06-18T12:00:00.000Z",
  };
}

const passedGate: GateResult = {
  passed: true,
  candidateScore: 0.55,
  incumbentScore: 0.5,
  delta: 0.05,
  metric: "success",
};

const RAW_CONTENT_KEYS = ["prompt", "completion", "output", "expected_output", "response"];

describe("buildCandidateProvenance", () => {
  it("carries the model-artifact lineage from the manifest + gate result", () => {
    const prov = buildCandidateProvenance(
      okManifest(),
      { feedback: 0.5, context: 0.3 },
      "/abs/holdout.jsonl",
      passedGate,
      0.02,
    );
    expect(prov.base_model_ref).toBe("Qwen/Qwen2.5-0.5B");
    expect(prov.job_id).toBe("job-0001");
    expect(prov.candidate_id).toBe("cand-0001");
    expect(prov.reward_composition).toEqual({ feedback: 0.5, context: 0.3 });
    expect(prov.gate.metric).toBe("success");
    expect(prov.gate.delta).toBe(0.05);
    expect(prov.gate.min_improvement).toBe(0.02);
    expect(prov.gate.holdout_path).toBe("/abs/holdout.jsonl");
    expect(prov.gate.passed).toBe(true);
  });

  it("carries delta:null when the gate failed closed", () => {
    const failedClosed: GateResult = {
      passed: false,
      candidateScore: null,
      incumbentScore: 0.5,
      delta: null,
      metric: "success",
      reason: "training-error",
    };
    const prov = buildCandidateProvenance(okManifest(), {}, "/abs/holdout.jsonl", failedClosed);
    expect(prov.gate.delta).toBeNull();
    expect(prov.gate.passed).toBe(false);
  });

  it("includes harness_version_range only when supplied", () => {
    const without = buildCandidateProvenance(okManifest(), {}, "/h.jsonl", passedGate);
    expect("harness_version_range" in without).toBe(false);
    const withRange = buildCandidateProvenance(
      okManifest(),
      {},
      "/h.jsonl",
      passedGate,
      0.02,
      ">=37 <38",
    );
    expect(withRange.harness_version_range).toBe(">=37 <38");
  });

  it("carries NO raw content (no prompt/completion/output keys) — T-05-14", () => {
    const prov = buildCandidateProvenance(
      okManifest(),
      { feedback: 0.5 },
      "/abs/holdout.jsonl",
      passedGate,
    );
    for (const key of RAW_CONTENT_KEYS) {
      expect(key in prov).toBe(false);
      expect(key in prov.gate).toBe(false);
    }
  });

  it("does not alias the caller's reward_composition (defensive copy)", () => {
    const composition: Record<string, number | undefined> = { feedback: 0.5 };
    const prov = buildCandidateProvenance(okManifest(), composition, "/h.jsonl", passedGate);
    composition.feedback = 0.9;
    expect(prov.reward_composition.feedback).toBe(0.5);
  });
});
