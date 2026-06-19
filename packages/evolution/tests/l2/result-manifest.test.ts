/**
 * Schema contract test for `ResultManifestSchema` (Wave 0, plan 05-01).
 *
 * Pins: a full manifest parses; an error-only failed-run manifest parses
 * (T-05-05); the manifest carries no auto-promote field (GATED-PROMOTION).
 */

import { describe, it, expect } from "vitest";
import { ResultManifestSchema } from "../../src/l2/schemas/result-manifest.js";

/** A full successful-run manifest. */
function fullManifest(): Record<string, unknown> {
  return {
    job_id: "job-0001",
    candidate_id: "cand-0001",
    artifact_path: "/abs/out/job-0001/adapter",
    base_model_ref: "Qwen/Qwen2.5-0.5B",
    metrics: {
      reward_mean: 0.71,
      reward_std: 0.12,
      steps: 40,
      epochs: 1,
      frac_reward_zero_std: 0.1,
      training_duration_s: 123.4,
    },
    principle_deltas: { feedback: 0.21, context: 0.04 },
    config_snapshot: { loss_type: "dr_grpo", num_generations: 8 },
    completed_at: "2026-06-18T12:00:00.000Z",
  };
}

describe("ResultManifestSchema", () => {
  it("parses a full successful-run manifest", () => {
    const m = ResultManifestSchema.parse(fullManifest());
    expect(m.candidate_id).toBe("cand-0001");
    expect(m.metrics?.reward_mean).toBe(0.71);
  });

  it("parses an error-only failed-run manifest (metrics omitted)", () => {
    const failed = {
      job_id: "job-0002",
      candidate_id: "cand-0002",
      artifact_path: "",
      base_model_ref: "Qwen/Qwen2.5-0.5B",
      config_snapshot: { loss_type: "dr_grpo" },
      completed_at: "2026-06-18T12:30:00.000Z",
      error: "CUDA out of memory at step 3",
    };
    const m = ResultManifestSchema.parse(failed);
    expect(m.metrics).toBeUndefined();
    expect(m.error).toContain("out of memory");
  });

  it("carries NO auto-promote field (promotion is the gate's verdict)", () => {
    const m = ResultManifestSchema.parse(fullManifest());
    expect("promoted" in m).toBe(false);
    expect("status" in m).toBe(false);
  });

  it("REJECTS a manifest missing job_id / candidate_id", () => {
    const { job_id, ...noJob } = fullManifest();
    expect(() => ResultManifestSchema.parse(noJob)).toThrow();
    const { candidate_id, ...noCand } = fullManifest();
    expect(() => ResultManifestSchema.parse(noCand)).toThrow();
  });

  it("treats principle_deltas and metrics as optional", () => {
    const minimal = {
      job_id: "job-0003",
      candidate_id: "cand-0003",
      artifact_path: "/abs/out/job-0003",
      base_model_ref: "Qwen/Qwen2.5-0.5B",
      config_snapshot: {},
      completed_at: "2026-06-18T13:00:00.000Z",
    };
    const m = ResultManifestSchema.parse(minimal);
    expect(m.metrics).toBeUndefined();
    expect(m.principle_deltas).toBeUndefined();
  });
});
