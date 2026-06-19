/**
 * Schema contract test for `TrainerPluginSpecSchema` (Wave 0, plan 05-01).
 *
 * Pins the GRPO/PEFT defaults, the absolute-path guard (T-05-03), and the
 * num_generations >= 2 GRPO group-size guard.
 */

import { describe, it, expect } from "vitest";
import { TrainerPluginSpecSchema } from "../../src/l2/schemas/trainer-plugin-spec.js";

/** A minimal valid spec (absolute paths) used as the parse baseline. */
function minimalSpec(): Record<string, unknown> {
  return {
    job_id: "job-0001",
    dataset_path: "/abs/data/dataset.jsonl",
    rewards_path: "/abs/data/rewards.json",
    base_model_ref: "Qwen/Qwen2.5-0.5B",
    output_dir: "/abs/out/job-0001",
  };
}

describe("TrainerPluginSpecSchema", () => {
  it("parses a minimal valid spec and applies all GRPO/PEFT defaults", () => {
    const spec = TrainerPluginSpecSchema.parse(minimalSpec());
    expect(spec.grpo_config.num_train_epochs).toBe(1);
    expect(spec.grpo_config.per_device_train_batch_size).toBe(4);
    expect(spec.grpo_config.num_generations).toBe(8);
    expect(spec.grpo_config.loss_type).toBe("dr_grpo");
    expect(spec.grpo_config.use_vllm).toBe(false);
    expect(spec.grpo_config.max_completion_length).toBe(512);
    expect(spec.grpo_config.beta).toBe(0);
    expect(spec.peft_config.enabled).toBe(true);
    expect(spec.peft_config.lora_r).toBe(16);
    expect(spec.peft_config.lora_alpha).toBe(32);
  });

  it("REJECTS num_generations < 2 (GRPO group size must exceed one)", () => {
    const bad = { ...minimalSpec(), grpo_config: { num_generations: 1 } };
    expect(() => TrainerPluginSpecSchema.parse(bad)).toThrow();
  });

  it("accepts num_generations === 2 (the minimum valid group size)", () => {
    const ok = { ...minimalSpec(), grpo_config: { num_generations: 2 } };
    expect(TrainerPluginSpecSchema.parse(ok).grpo_config.num_generations).toBe(2);
  });

  it("REJECTS a relative dataset_path", () => {
    const bad = { ...minimalSpec(), dataset_path: "data/dataset.jsonl" };
    expect(() => TrainerPluginSpecSchema.parse(bad)).toThrow();
  });

  it("REJECTS a relative rewards_path and a relative output_dir", () => {
    expect(() =>
      TrainerPluginSpecSchema.parse({ ...minimalSpec(), rewards_path: "rewards.json" }),
    ).toThrow();
    expect(() =>
      TrainerPluginSpecSchema.parse({ ...minimalSpec(), output_dir: "out/job" }),
    ).toThrow();
  });

  it("REJECTS an empty job_id and an empty base_model_ref", () => {
    expect(() => TrainerPluginSpecSchema.parse({ ...minimalSpec(), job_id: "" })).toThrow();
    expect(() =>
      TrainerPluginSpecSchema.parse({ ...minimalSpec(), base_model_ref: "" }),
    ).toThrow();
  });

  it("accepts the three GRPO loss types and rejects an unknown one", () => {
    for (const loss_type of ["grpo", "dapo", "dr_grpo"]) {
      const spec = TrainerPluginSpecSchema.parse({ ...minimalSpec(), grpo_config: { loss_type } });
      expect(spec.grpo_config.loss_type).toBe(loss_type);
    }
    expect(() =>
      TrainerPluginSpecSchema.parse({ ...minimalSpec(), grpo_config: { loss_type: "ppo" } }),
    ).toThrow();
  });
});
