/**
 * `MockTrainerPlugin` — the pure-TS CI path (RESEARCH Pattern 4).
 *
 * This plugin proves the ENTIRE TS orchestration (export → reward → handoff →
 * gate → promote) runs on a CPU CI box with NO Python, NO GPU, and NO subprocess.
 * It performs no training: given a valid `TrainerPluginSpec` it returns a
 * schema-valid `ResultManifest` echoing the spec's identity plus deterministic
 * synthetic metrics, and validates that manifest against `ResultManifestSchema`
 * before returning so the mock can never emit an invalid manifest.
 *
 * NO-PYTHON-CORE-DEP (ADR-0002/0004, threat T-05-02): imports only the TS
 * schemas + interface. No Python, no `child_process`, no subprocess — `node -e
 * "import('@lucid/evolution')"` must succeed with no Python installed.
 */

import {
  ResultManifestSchema,
  type ResultManifest,
} from "./schemas/result-manifest.js";
import type { TrainerPluginSpec } from "./schemas/trainer-plugin-spec.js";
import type { TrainerPlugin } from "./trainer-plugin.js";

export class MockTrainerPlugin implements TrainerPlugin {
  async train(spec: TrainerPluginSpec): Promise<ResultManifest> {
    const manifest: ResultManifest = {
      job_id: spec.job_id,
      candidate_id: `mock-cand-${spec.job_id}`,
      artifact_path: spec.output_dir,
      base_model_ref: spec.base_model_ref,
      metrics: {
        // Deterministic synthetic values — no training is performed.
        reward_mean: 0.6,
        reward_std: 0.1,
        steps: 10,
        epochs: spec.grpo_config.num_train_epochs,
      },
      config_snapshot: { ...spec.grpo_config },
      completed_at: new Date().toISOString(),
    };
    // Defensive: the mock can never emit an invalid manifest.
    return ResultManifestSchema.parse(manifest);
  }
}
