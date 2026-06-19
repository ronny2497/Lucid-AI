/**
 * Contract test for the pure-TS `MockTrainerPlugin` CI path (Wave 0, plan 05-01).
 *
 * Proves the mock returns a schema-valid `ResultManifest` echoing the spec's
 * identity with deterministic synthetic metrics and no error — exercising the TS
 * handoff with no Python/GPU/subprocess (RESEARCH Pattern 4, threat T-05-02).
 */

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TrainerPluginSpecSchema,
  type TrainerPluginSpec,
} from "../../src/l2/schemas/trainer-plugin-spec.js";
import { ResultManifestSchema } from "../../src/l2/schemas/result-manifest.js";
import { MockTrainerPlugin } from "../../src/l2/mock-trainer-plugin.js";
import type { TrainerPlugin } from "../../src/l2/trainer-plugin.js";

function specFor(jobId: string, epochs = 1): TrainerPluginSpec {
  const root = tmpdir();
  return TrainerPluginSpecSchema.parse({
    job_id: jobId,
    dataset_path: join(root, "dataset.jsonl"),
    rewards_path: join(root, "rewards.json"),
    base_model_ref: "Qwen/Qwen2.5-0.5B",
    output_dir: join(root, jobId),
    grpo_config: { num_train_epochs: epochs },
  });
}

describe("MockTrainerPlugin", () => {
  it("returns a schema-valid ResultManifest with no error (success path)", async () => {
    const spec = specFor("job-0001", 2);
    const manifest = await new MockTrainerPlugin().train(spec);
    expect(() => ResultManifestSchema.parse(manifest)).not.toThrow();
    expect(manifest.error).toBeUndefined();
  });

  it("echoes job_id and base_model_ref and points artifact_path at output_dir", async () => {
    const spec = specFor("job-0002");
    const manifest = await new MockTrainerPlugin().train(spec);
    expect(manifest.job_id).toBe(spec.job_id);
    expect(manifest.base_model_ref).toBe(spec.base_model_ref);
    expect(manifest.artifact_path).toBe(spec.output_dir);
    expect(manifest.candidate_id).toBe(`mock-cand-${spec.job_id}`);
  });

  it("sets metrics.epochs to the spec's num_train_epochs", async () => {
    const spec = specFor("job-0003", 3);
    const manifest = await new MockTrainerPlugin().train(spec);
    expect(manifest.metrics?.epochs).toBe(3);
  });

  it("snapshots the grpo_config into config_snapshot", async () => {
    const spec = specFor("job-0004");
    const manifest = await new MockTrainerPlugin().train(spec);
    expect(manifest.config_snapshot.loss_type).toBe("dr_grpo");
    expect(manifest.config_snapshot.num_generations).toBe(8);
  });

  it("is a class implementing TrainerPlugin (distinct candidate_id per job_id)", async () => {
    const plugin: TrainerPlugin = new MockTrainerPlugin();
    const a = await plugin.train(specFor("job-A"));
    const b = await plugin.train(specFor("job-B"));
    expect(a.candidate_id).not.toBe(b.candidate_id);
    expect(a.candidate_id).toBe("mock-cand-job-A");
    expect(b.candidate_id).toBe("mock-cand-job-B");
  });
});
